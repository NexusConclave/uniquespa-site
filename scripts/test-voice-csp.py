#!/usr/bin/env python3
"""Uni voice under the site's real Content-Security-Policy (review finding 18). Offline: no ElevenLabs contact.

Serves dist/ with the headers the build wrote to dist/_headers (the "/*" rule, CSP included), opens Uni in Chromium
with a fake microphone, and answers the ElevenLabs websocket with a local mock (Playwright route_web_socket), so the
SDK runs its real start-up: it loads its AudioWorklets and starts the call. Two runs:
  1. normal Chromium (the microphone supports the sampleRate constraint): raw + concat worklets;
  2. sampleRate constraint reported unsupported (as on some browsers): the resampler worklet is loaded too.
Passes when the call reaches "Listening", every worklet came from /chat/worklets/ on this site, nothing was loaded
from blob:, data: or a CDN, and the browser reported no CSP violation.
"""
import functools, json, os, sys, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.environ.get('DIST') or os.path.join(ROOT, 'dist')


def site_headers():
    """Headers of the "/*" rule in dist/_headers (what Cloudflare Pages sends on every response)."""
    out, cur = {}, None
    for line in open(os.path.join(DIST, '_headers'), encoding='utf-8'):
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        if not line[0].isspace():
            cur = line.strip()
            continue
        if cur == '/*' and ':' in line:
            k, v = line.strip().split(':', 1)
            out[k.strip()] = v.strip()
    return out


HEADERS = site_headers()
# HSTS and upgrade-insecure-requests would push the local http server to https: drop them for the test only.
HEADERS.pop('Strict-Transport-Security', None)
HEADERS['Content-Security-Policy'] = '; '.join(d for d in HEADERS['Content-Security-Policy'].split('; ') if d.strip() != 'upgrade-insecure-requests')


SERVED = []  # every path the local server answered (worklet fetches don't show up as page requests)


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        SERVED.append(self.path)
        super().do_GET()

    def end_headers(self):
        for k, v in HEADERS.items():
            self.send_header(k, v)
        super().end_headers()

    def log_message(self, *a):
        pass


def serve():
    srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=DIST))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


INIT = {"type": "conversation_initiation_metadata", "conversation_initiation_metadata_event": {
    "conversation_id": "conv_test", "agent_output_audio_format": "pcm_16000", "user_input_audio_format": "pcm_16000"}}

# Collects CSP violations from the page and any worklet realm that reports to it.
WATCH = """(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => {
  window.__csp.push(e.violatedDirective + ' ' + e.blockedURI); }); })();"""
NO_SAMPLERATE = """(() => { const md = navigator.mediaDevices; const f = md.getSupportedConstraints.bind(md);
  md.getSupportedConstraints = () => Object.assign({}, f(), { sampleRate: false }); })();"""

passed = failed = 0


def check(name, ok, detail=''):
    global passed, failed
    if ok:
        passed += 1
        print(f'  PASS {name}')
    else:
        failed += 1
        print(f'  FAIL {name}  {str(detail)[:300]}')


def wait_for(page, js, timeout_ms):
    """Poll a page expression. (Playwright's wait_for_function uses eval, which this CSP rightly refuses.)"""
    for _ in range(timeout_ms // 100):
        if page.evaluate(js):
            return True
        page.wait_for_timeout(100)
    return False


def run(browser, base, label, force_resampler):
    SERVED.clear()
    ctx = browser.new_context(permissions=['microphone'])
    ctx.add_init_script(WATCH)
    if force_resampler:
        ctx.add_init_script(NO_SAMPLERATE)
    page = ctx.new_page()
    requests, console = [], []
    page.on('request', lambda r: requests.append(r.url))
    page.on('console', lambda m: console.append(m.text))
    sockets = []

    def on_ws(ws):
        sockets.append(ws.url)
        ws.on_message(lambda m: None)  # swallow the SDK's overrides/audio messages
        ws.send(json.dumps(INIT))
    page.route_web_socket('wss://api.elevenlabs.io/**', on_ws)
    # Anything else that would leave this machine is refused (analytics, fonts, other hosts).
    page.route('**/*', lambda r: r.continue_() if r.request.url.startswith(base) else r.abort())

    page.goto(base + '/', wait_until='load')
    page.evaluate("document.querySelector('[data-open=\"uni\"]').click()")
    check(f'{label}: Uni opens', wait_for(page, '() => !!(window.UniChat && document.querySelector(".usc-start"))', 10000))
    page.click('.usc-start')
    page.click('.usc-mic')
    page.click('.usc-vconfirm .usc-vend')
    listening = wait_for(page, "() => (document.querySelector('.usc-vtext')||{}).textContent === 'Listening…'", 20000)
    page.wait_for_timeout(500)
    text = page.evaluate("(document.querySelector('.usc-vtext')||{}).textContent")
    csp = page.evaluate('window.__csp')
    csp += [c for c in console if 'Content Security Policy' in c or 'Refused to' in c]
    worklets = [u for u in SERVED if u.startswith('/chat/worklets/')]
    check(f'{label}: voice call starts and reaches "Listening…"', listening, f'{text}; console: {console[-5:]}')
    check(f'{label}: the ElevenLabs socket was the (mocked) api.elevenlabs.io one', bool(sockets) and sockets[0].startswith('wss://api.elevenlabs.io/'), sockets)
    check(f'{label}: raw-audio worklet loaded from this site', any(u.endswith('/chat/worklets/rawAudioProcessor.js') for u in worklets), worklets)
    check(f'{label}: playback worklet loaded from this site', any(u.endswith('/chat/worklets/audioConcatProcessor.js') for u in worklets), worklets)
    if force_resampler:
        check(f'{label}: resampler worklet loaded from this site', any(u.endswith('/chat/worklets/libsamplerate.worklet.js') for u in worklets), worklets)
    check(f'{label}: nothing loaded from blob:, data: or a CDN', not [u for u in requests if u.startswith(('blob:', 'data:')) or 'jsdelivr' in u], [u for u in requests if not u.startswith(base)][:5])
    check(f'{label}: no CSP violation', not csp, csp)
    try:
        page.evaluate("document.querySelector('.usc-vbar .usc-vend') && document.querySelector('.usc-vbar .usc-vend').click()")
    except Exception:
        pass
    ctx.close()


def main():
    if not os.path.exists(os.path.join(DIST, '_headers')):
        print('dist/_headers missing: run npm run build first')
        sys.exit(1)
    csp = HEADERS.get('Content-Security-Policy', '')
    print('voice + CSP (Chromium, fake microphone, mocked ElevenLabs socket)')
    script_src = next((d for d in csp.split('; ') if d.startswith('script-src ')), '')
    check('CSP script-src has no blob: and no CDN host', 'blob:' not in script_src and 'jsdelivr' not in script_src, script_src[:200])
    srv = serve()
    base = f'http://127.0.0.1:{srv.server_address[1]}'
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        try:
            run(browser, base, 'normal', False)
            run(browser, base, 'resampler', True)
        finally:
            browser.close()
    srv.shutdown()
    print(f'\n{passed} passed, {failed} failed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
