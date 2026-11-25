#!/usr/bin/env python3
"""Uni booking card form under the site's real Content-Security-Policy. Offline: no Square, no Worker, no ElevenLabs.

Serves dist/ with the headers the build wrote to dist/_headers (CSP included). The chat Worker routes (/api/chat,
/api/book/intent, /api/book, /api/book/config) are answered by mocks in this file. Square's SDK URL
(https://web.squarecdn.com/v1/square.js) and its card iframe are answered by a MOCK SDK served from that same origin,
so the browser applies the real CSP to them. No real card, no real token.
Checks: the card form opens from a chat reply and from the voice client tool show_card_form, shows the policy (and
the "pending" marker), Book stays off until consent, the POST carries only the intent + Square's token + consent,
a declined card is never retried automatically, Uni is told only "Booked: ..." / "Not booked: ...", card digits typed
in the chat are removed before they are stored, shown or sent, and the browser reports no CSP violation.
"""
import functools, json, os, re, sys, threading
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.environ.get('DIST') or os.path.join(ROOT, 'dist')
REF = 'ABCDEFGHJKMN'
TEST_AGENT = 'agent_3601m7bpehw8eevaynqn1hx2br50'
POLICY = "[Katy's cancellation and no-show policy — pending]"
CARD_DIGITS = re.compile(r'(?:\d[\s.\-]?){13,19}')


def site_headers():
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
HEADERS.pop('Strict-Transport-Security', None)
HEADERS['Content-Security-Policy'] = '; '.join(d for d in HEADERS['Content-Security-Policy'].split('; ') if d.strip() != 'upgrade-insecure-requests')


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        for k, v in HEADERS.items():
            self.send_header(k, v)
        super().end_headers()

    def log_message(self, *a):
        pass


# The mock Square Web Payments SDK. card.attach() puts an iframe from web.squarecdn.com in the container (frame-src),
# tokenize() records what it was asked and returns a fake token. window.__sq lets the test read what happened.
MOCK_SDK = r"""
window.__sq = { payments: [], tokenize: [], attached: 0, destroyed: 0, verify: 0 };
window.Square = { payments: function (appId, locationId) {
  window.__sq.payments.push([appId, locationId]);
  return {
    card: function () { return Promise.resolve({
      attach: function (sel) { var f = document.createElement('iframe'); f.src = 'https://web.squarecdn.com/mock-card-frame';
        f.title = 'Secure card input frame'; f.style.width = '100%'; f.style.height = '90px'; f.style.border = '0';
        document.querySelector(sel).appendChild(f); window.__sq.attached++; return Promise.resolve(); },
      tokenize: function (details) { window.__sq.tokenize.push(details);
        return Promise.resolve({ status: 'OK', token: 'cnon:mock-token-' + window.__sq.tokenize.length, details: { verification: true } }); },
      destroy: function () { window.__sq.destroyed++; return Promise.resolve(true); }
    }); },
    verifyBuyer: function () { window.__sq.verify++; return Promise.resolve({ token: 'verf:mock' }); }
  };
} };
"""
CARD_FRAME = '<!doctype html><title>card</title><input aria-label="Card number" placeholder="Card number">'

INTENT_VIEW = {'ok': True, 'intent': 'v1.TESTPAYLOAD.TESTSIGNATUREabcdefghijklmnopqrstuvwxyzABCD', 'service': 'Swedish massage, 60 min',
               'spa': 'San Diego', 'time': 'Sat 14 Nov, 9:00 AM', 'minutes': 60, 'guest': 'Dana T.', 'given_name': 'Dana',
               'family_name': 'Test', 'email': 'dana@example.com', 'policy': POLICY, 'policy_ready': False,
               'app_id': 'sq0idp-_bH-RP0yVEoGNbGlf9wIlg', 'location_id': 'LWTMBRFFB1D7G',
               'sdk_url': 'https://web.squarecdn.com/v1/square.js', 'live': False, 'expires_in': 600}
BOOKED = {'ok': True, 'dry_run': True, 'booked': {'service': 'Swedish massage, 60 min', 'spa': 'San Diego', 'time': 'Sat 14 Nov, 9:00 AM'}, 'booking_id': None}
BOOKED_NOTICE = dict(BOOKED, notice="You'll get a short service agreement to sign before your first visit.")
DECLINED = {'ok': False, 'reason': 'card_declined', 'message': "Your card wasn't accepted. Please check it or try another card. Nothing was booked."}

passed = failed = 0


def check(name, ok, detail=''):
    global passed, failed
    if ok:
        passed += 1
        print(f'  PASS {name}')
    else:
        failed += 1
        print(f'  FAIL {name}  {str(detail)[:300]}')


def wait_for(page, js, timeout_ms=10000):
    for _ in range(timeout_ms // 100):
        if page.evaluate(js):
            return True
        page.wait_for_timeout(100)
    return False


WATCH = """(() => { window.__csp = []; document.addEventListener('securitypolicyviolation', (e) => {
  window.__csp.push(e.violatedDirective + ' ' + e.blockedURI); }); })();"""


def new_page(browser, base, book_replies, chat_bodies, book_bodies, config=None):
    ctx = browser.new_context(permissions=['microphone'])
    ctx.add_init_script(WATCH)
    page = ctx.new_page()
    console = []
    page.on('console', lambda m: console.append(m.text))
    replies = list(book_replies)

    def handle(route):
        url = route.request.url
        if url.startswith('https://web.squarecdn.com/v1/square.js'):
            return route.fulfill(status=200, content_type='application/javascript', body=MOCK_SDK)
        if url.startswith('https://web.squarecdn.com/mock-card-frame'):
            return route.fulfill(status=200, content_type='text/html', body=CARD_FRAME)
        if not url.startswith(base):
            return route.abort()
        path = url[len(base):].split('?')[0]
        if path == '/api/chat':
            body = json.loads(route.request.post_data or '{}')
            chat_bodies.append(body)
            last = body['messages'][-1]['content']
            if 'BOOKME' in last:
                return route.fulfill(status=200, content_type='application/json', body=json.dumps({'reply': 'The secure card form is now showing. Enter your card there and press Book.', 'lead_captured': False, 'booking': {'ref': REF}}))
            return route.fulfill(status=200, content_type='application/json', body=json.dumps({'reply': "Please don't share card details here.", 'lead_captured': False}))
        if path == '/api/book/intent':
            ok = json.loads(route.request.post_data or '{}').get('ref') == REF
            return route.fulfill(status=200 if ok else 404, content_type='application/json', body=json.dumps(INTENT_VIEW if ok else {'ok': False, 'reason': 'expired'}))
        if path == '/api/book':
            book_bodies.append(route.request.post_data or '')
            r = replies.pop(0) if replies else BOOKED
            return route.fulfill(status=200 if r.get('ok') else 402, content_type='application/json', body=json.dumps(r))
        if path == '/api/book/config':
            return route.fulfill(status=200, content_type='application/json', body=json.dumps(config or {'booking': False, 'voice_agent_id': None}))
        return route.continue_()
    page.route('**/*', handle)
    return ctx, page, console


def open_chat(page, base):
    page.goto(base + '/', wait_until='load')
    page.evaluate("document.querySelector('[data-open=\"uni\"]').click()")
    # No "Start chat" step any more (owner request, 14 Nov 2026): Ask Uni opens straight on the live chat.
    wait_for(page, '() => !!(window.UniChat && window.UniChat.isOpen() && document.querySelector(".usc-input"))')


def csp_errors(page, console):
    return page.evaluate('window.__csp') + [c for c in console if 'Content Security Policy' in c or 'Refused to' in c]


def run_chat(browser, base):
    print('chat: booking ref -> card form -> book (dry run)')
    chat_bodies, book_bodies = [], []
    ctx, page, console = new_page(browser, base, [], chat_bodies, book_bodies)
    open_chat(page, base)
    page.fill('.usc-input', 'BOOKME 9 AM please')
    page.keyboard.press('Enter')
    check('chat: card form opens from the chat reply', wait_for(page, "() => !!document.querySelector('.usc-book .usc-sqcard iframe')"), page.evaluate("(document.querySelector('.usc-book')||{}).innerText"))
    text = page.evaluate("document.querySelector('.usc-book').innerText")
    check('chat: summary shows service, time and spa', 'Swedish massage, 60 min' in text and 'Sat 14 Nov, 9:00 AM' in text and 'San Diego' in text, text)
    check('chat: policy text shown, marked pending', POLICY in text and 'Wording pending' in text, text)
    check('chat: TEST ONLY banner when the Worker cannot write', 'TEST ONLY' in text, text)
    check('chat: no agreement line unless the Worker sends one', 'service agreement' not in text, text)
    sq = page.evaluate('window.__sq')
    check('chat: Square SDK started with the app + location from the Worker', sq['payments'] == [['sq0idp-_bH-RP0yVEoGNbGlf9wIlg', 'LWTMBRFFB1D7G']], sq)
    check('chat: card iframe comes from web.squarecdn.com', page.evaluate("document.querySelector('.usc-sqcard iframe').src").startswith('https://web.squarecdn.com/'))
    check('chat: Book is off until the consent box is ticked', page.evaluate("document.querySelector('.usc-book-go').disabled") is True)
    page.click('.usc-consent input')
    check('chat: Book turns on after consent', page.evaluate("document.querySelector('.usc-book-go').disabled") is False)
    page.click('.usc-book-go')
    check('chat: confirmation shown', wait_for(page, "() => /Test complete/.test((document.querySelector('.usc-book')||{}).innerText || '')"), page.evaluate("document.querySelector('.usc-book').innerText"))
    check('chat: exactly one POST /api/book', len(book_bodies) == 1, book_bodies)
    body = json.loads(book_bodies[0]) if book_bodies else {}
    check('chat: POST carries only intent, Square token and consent', set(body) <= {'intent', 'card_token', 'consent', 'verification_token'} and body.get('card_token') == 'cnon:mock-token-1' and body.get('consent') is True and body.get('intent') == INTENT_VIEW['intent'], body)
    check('chat: no card-number digits in the POST', not CARD_DIGITS.search(book_bodies[0] if book_bodies else ''), book_bodies)
    tok = page.evaluate('window.__sq.tokenize')
    check('chat: tokenize asked for a STORE (card on file) verification with the billing contact', bool(tok) and tok[0].get('intent') == 'STORE' and tok[0]['billingContact'].get('familyName') == 'Test', tok)
    check('chat: verifyBuyer not called twice when tokenize already verified', page.evaluate('window.__sq.verify') == 0)
    stored = page.evaluate("sessionStorage.getItem('usc-chat-v2')") or ''
    check('chat: Uni is told "Booked: ..." (stored for the next turn)', 'Booked: Swedish massage, 60 min, Sat 14 Nov, 9:00 AM at San Diego. (Test only: nothing was really booked.)' in stored, stored[-300:])
    check('chat: the card form is torn down after booking', page.evaluate('window.__sq.destroyed') >= 1 and not page.evaluate("!!document.querySelector('.usc-sqcard')"))
    # card digits typed in the chat: removed before stored, shown or sent
    page.fill('.usc-input', 'my card is 4111 1111 1111 1111 exp 12/28')
    page.keyboard.press('Enter')
    wait_for(page, f"() => document.querySelectorAll('.usc-user').length >= 2")
    page.wait_for_timeout(300)
    sent = json.dumps(chat_bodies[-1])
    shown = page.evaluate("Array.from(document.querySelectorAll('.usc-user')).map(e => e.textContent).join(' | ')")
    stored = page.evaluate("sessionStorage.getItem('usc-chat-v2')") or ''
    check('chat: typed card digits never sent', '4111' not in sent and '[card number removed]' in sent, sent[-200:])
    check('chat: typed card digits never shown or stored', '4111' not in shown and '4111' not in stored, shown)
    errs = csp_errors(page, console)
    check('chat: no CSP violation (Square SDK, card iframe)', not errs, errs)
    ctx.close()


def run_decline(browser, base):
    print('chat: declined card -> message, no automatic retry, guest retries by hand')
    chat_bodies, book_bodies = [], []
    ctx, page, console = new_page(browser, base, [DECLINED, BOOKED_NOTICE], chat_bodies, book_bodies)
    open_chat(page, base)
    page.fill('.usc-input', 'BOOKME')
    page.keyboard.press('Enter')
    wait_for(page, "() => !!document.querySelector('.usc-book .usc-sqcard iframe')")
    page.click('.usc-consent input')
    page.click('.usc-book-go')
    check('decline: message shown', wait_for(page, "() => /wasn't accepted/.test((document.querySelector('.usc-book-st')||{}).textContent || '')"))
    page.wait_for_timeout(1500)
    check('decline: no automatic retry (one POST)', len(book_bodies) == 1, len(book_bodies))
    check('decline: Book is available again for the guest', page.evaluate("document.querySelector('.usc-book-go').disabled") is False)
    stored = page.evaluate("sessionStorage.getItem('usc-chat-v2')") or ''
    check('decline: Uni not told "Booked"', 'Booked:' not in stored)
    page.click('.usc-book-go')
    check('decline: second press (by the guest) books', wait_for(page, "() => /Test complete/.test((document.querySelector('.usc-book')||{}).innerText || '')"))
    stored = page.evaluate("sessionStorage.getItem('usc-chat-v2')") or ''
    check('notice: AGREEMENT_NOTICE line shown and passed to Uni when the Worker sends it', "short service agreement to sign" in stored and "short service agreement" in page.evaluate("document.querySelector('.usc-book').innerText"), stored[-200:])
    check('decline: each try used a fresh Square token', [json.loads(b)['card_token'] for b in book_bodies] == ['cnon:mock-token-1', 'cnon:mock-token-2'], book_bodies)
    errs = csp_errors(page, console)
    check('decline: no CSP violation', not errs, errs)
    ctx.close()


INIT = {"type": "conversation_initiation_metadata", "conversation_initiation_metadata_event": {
    "conversation_id": "conv_test", "agent_output_audio_format": "pcm_16000", "user_input_audio_format": "pcm_16000"}}


def run_voice(browser, base):
    print('voice: config names the test agent; show_card_form client tool; result sent back as a contextual update')
    chat_bodies, book_bodies = [], []
    ctx, page, console = new_page(browser, base, [], chat_bodies, book_bodies, config={'booking': True, 'voice_agent_id': TEST_AGENT})
    sockets, received = [], []
    holder = {}

    def on_ws(ws):
        sockets.append(ws.url)
        holder['ws'] = ws
        ws.on_message(lambda m: received.append(m if isinstance(m, str) else ''))
        ws.send(json.dumps(INIT))
    page.route_web_socket('wss://api.elevenlabs.io/**', on_ws)
    open_chat(page, base)
    page.click('.usc-mic')
    page.click('.usc-vconfirm .usc-vend')
    listening = wait_for(page, "() => (document.querySelector('.usc-vtext')||{}).textContent === 'Listening…'", 20000)
    check('voice: call starts', listening, console[-5:])
    check('voice: the agent named by /api/book/config is used (test copy, not live)', bool(sockets) and ('agent_id=' + TEST_AGENT) in sockets[0], sockets)
    holder['ws'].send(json.dumps({'type': 'client_tool_call', 'client_tool_call': {'tool_name': 'show_card_form', 'tool_call_id': 'call_1', 'parameters': {'booking_ref': REF}}}))
    check('voice: show_card_form opens the card form', wait_for(page, "() => !!document.querySelector('.usc-book .usc-sqcard iframe')"))
    page.wait_for_timeout(300)
    results = [json.loads(m) for m in received if m and '"client_tool_result"' in m]
    check('voice: tool result tells the agent it is NOT booked yet', bool(results) and 'Not booked yet' in json.dumps(results[0]), results)
    page.click('.usc-consent input')
    page.click('.usc-book-go')
    ok = wait_for(page, "() => /Test complete/.test((document.querySelector('.usc-book')||{}).innerText || '')")
    check('voice: booking completes in the form', ok)
    page.wait_for_timeout(500)
    ups = [json.loads(m) for m in received if m and '"contextual_update"' in m]
    check('voice: agent gets "booking_result: Booked: ..." as a contextual update', any(u.get('text', '').startswith('booking_result: Booked: Swedish massage, 60 min') for u in ups), ups)
    check('voice: nothing sent to the agent has card digits or the Square token', not any(CARD_DIGITS.search(m) or 'cnon:' in m for m in received if m), [m[:80] for m in received if m][:5])
    # a transcript line with card digits is redacted before it is shown or stored
    holder['ws'].send(json.dumps({'type': 'user_transcript', 'user_transcription_event': {'user_transcript': 'my card is 4111 1111 1111 1111'}}))
    page.wait_for_timeout(600)
    shown = page.evaluate("document.querySelector('.usc-log').innerText")
    stored = page.evaluate("sessionStorage.getItem('usc-chat-v2')") or ''
    check('voice: spoken card digits are not shown or stored', '4111' not in shown and '4111' not in stored, shown[-200:])
    errs = csp_errors(page, console)
    check('voice: no CSP violation', not errs, errs)
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
    print('booking card form + CSP (Chromium, mocked Worker routes, mocked Square SDK on web.squarecdn.com)')
    d = {x.split(' ')[0]: x.split(' ')[1:] for x in csp.split('; ') if x.strip()}
    check('CSP: Square SDK script host allowed', 'https://web.squarecdn.com' in d.get('script-src', []))
    check('CSP: Square card iframe allowed', 'https://web.squarecdn.com' in d.get('frame-src', []))
    check('CSP: Square card-token API allowed', 'https://pci-connect.squareup.com' in d.get('connect-src', []))
    srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=DIST))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    base = f'http://127.0.0.1:{srv.server_address[1]}'
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'])
        try:
            run_chat(browser, base)
            run_decline(browser, base)
            run_voice(browser, base)
        finally:
            browser.close()
    srv.shutdown()
    print(f'\n{passed} passed, {failed} failed')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
