#!/usr/bin/env python3
"""
Browser half of the tracking tests (called by scripts/test-tracking.mjs with the three build folders:
off, off-prev, on). Serves each build on 127.0.0.1, blocks every non-local request (the Cloudflare beacon is
answered locally with an empty script), mocks /api/lead and /api/chat, records /api/event. Never contacts a server.

off / off-prev : clicks Book, a Square booking link, a phone link, the gift link, Uni → no /api/event request,
                 no Cloudflare request, no ush-src storage.
on             : the beacon loads once with the token; each click sends one clean event with the campaign and
                 referring host of the visit; the consultation form sends lead_submitted with no name or phone;
                 nothing leaves with Global Privacy Control or Do Not Track on.
"""
import json, sys, threading, functools
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

DIRS = dict(zip(['off', 'off-prev', 'on'], sys.argv[1:4]))
FAKE_TOKEN = '0123456789abcdef0123456789abcdef'
SERVER_EVENTS = []
fails = []

def check(name, ok, detail=''):
    print(('  PASS ' if ok else '  FAIL ') + name + (f'  [{detail}]' if detail and not ok else ''))
    if not ok: fails.append(name)

class Handler(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        body = self.rfile.read(n).decode('utf-8', 'replace')
        if self.path.startswith('/api/event'):
            SERVER_EVENTS.append(body); self.send_response(204); self.end_headers(); return
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers()
        self.wfile.write(b'{"reply":"(mocked)","lead_captured":false}')

def serve(d):
    srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Handler, directory=d))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}'

# Stop off-site and tel:/sms: navigations after the site's own click handlers have run (window bubble phase).
NO_LEAVE = """
window.addEventListener('click', (e) => {
  const a = e.target.closest && e.target.closest('a[href]');
  if (!a) return;
  const h = a.getAttribute('href') || '';
  if (/^(tel:|sms:|mailto:)/.test(h) || (a.origin && a.origin !== location.origin)) e.preventDefault();
});
"""
GPC = "Object.defineProperty(Navigator.prototype, 'globalPrivacyControl', { get: () => true, configurable: true });"
DNT = "Object.defineProperty(Navigator.prototype, 'doNotTrack', { get: () => '1', configurable: true });"

def context(browser, base, extra_init=None):
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_init_script(NO_LEAVE)
    if extra_init: ctx.add_init_script(extra_init)
    log = {'events': [], 'beacon': [], 'external': [], 'cookies_sent': []}
    def route(r):
        url = r.request.url
        if url.startswith(base + '/api/event'):
            log['events'].append(r.request.post_data or '')
            if r.request.headers.get('cookie'): log['cookies_sent'].append(url)
            return r.fulfill(status=204, body='')
        if url.startswith(base + '/api/'):
            return r.fulfill(status=200, content_type='application/json', body='{"reply":"(mocked)","lead_captured":false}')
        if url.startswith('https://static.cloudflareinsights.com/'):
            log['beacon'].append(url)
            return r.fulfill(status=200, content_type='application/javascript', body='/* test stub */')
        if not url.startswith(base):
            log['external'].append(url)
            return r.abort()
        return r.continue_()
    ctx.route('**/*', route)
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    return ctx, pg, log, errors

def click_journey(pg, base, query=''):
    """Home → Book sheet → SD booking row → footer phone → footer Del Mar booking → Uni → menu (router) → price-table Book → gift page tile."""
    pg.goto(base + '/' + query, wait_until='load', referer='https://www.google.com/search?q=spa')
    pg.wait_for_timeout(300)
    pg.locator('.site-header [data-open="book"]').first.click(); pg.wait_for_timeout(200)
    pg.locator('#book-sheet input[name="book-spa"][value="SD"]').check(force=True); pg.wait_for_timeout(150)
    pg.locator('#book-sheet [data-sheet-rows="SD"] a[data-track="book_click"]').first.click(); pg.wait_for_timeout(150)
    pg.keyboard.press('Escape'); pg.wait_for_timeout(150)
    pg.locator('footer a[href^="tel:"]').first.click(); pg.wait_for_timeout(100)
    pg.locator('footer a[data-track="book_click"][href*="LXYVNKXTR50S3"]').first.click(); pg.wait_for_timeout(100)
    pg.locator('[data-open="uni"]:visible').first.click(); pg.wait_for_timeout(400)
    pg.evaluate("() => window.UniChat && window.UniChat.close()"); pg.wait_for_timeout(150)
    pg.locator('a[href="/menu/"]:not([data-open]):visible').first.click(); pg.wait_for_url('**/menu/', wait_until='commit', timeout=8000); pg.wait_for_timeout(400)
    pg.locator('a.btn[data-track="book_click"][href*="/services/"]:visible').first.click(); pg.wait_for_timeout(150)
    pg.goto(base + '/gift-cards/', wait_until='load'); pg.wait_for_timeout(300)
    pg.locator('a[data-track="gift_card_click"]:visible').first.click(); pg.wait_for_timeout(300)

PII = ['jane', 'doe', '858', '2938900', '@', 'mozilla', 'cookie']

with sync_playwright() as p:
    browser = p.chromium.launch()

    for name in ('off', 'off-prev'):
        print(f'[{name}] tracking off')
        srv, base = serve(DIRS[name]); SERVER_EVENTS.clear()
        ctx, pg, log, errors = context(browser, base)
        click_journey(pg, base, '?utm_source=google&utm_medium=cpc&utm_campaign=gift-season')
        check(f'{name}: no /api/event requests', not log['events'] and not SERVER_EVENTS, f"{log['events']} {SERVER_EVENTS}")
        check(f'{name}: no Cloudflare beacon request', not log['beacon'])
        check(f'{name}: nothing stored for campaigns', pg.evaluate("() => { try { return sessionStorage.getItem('ush-src') } catch (e) { return null } }") is None)
        check(f'{name}: window.track is a safe no-op', pg.evaluate("() => { window.track('book_click', {spa:'SD'}); return typeof window.track }") == 'function')
        check(f'{name}: no external requests except Square opens', all('squareup.com' in u for u in log['external']), log['external'][:3])
        check(f'{name}: no page errors', not errors, errors[:2])
        ctx.close(); srv.shutdown()

    print('[on] tracking on (fake token, local endpoint)')
    srv, base = serve(DIRS['on']); SERVER_EVENTS.clear()
    ctx, pg, log, errors = context(browser, base)
    click_journey(pg, base, '?utm_source=google&utm_medium=cpc&utm_campaign=gift-season&utm_term=jane%20doe')
    pg.wait_for_timeout(300)
    raw = log['events'] or SERVER_EVENTS
    evs = [json.loads(b) for b in raw if b]
    names = [e['e'] for e in evs]
    print('   events:', names)
    # Two full page loads in the journey (home, gift cards); the router hop to /menu/ must not load it again.
    check('on: beacon loaded once per full page load, not per router hop', len(log['beacon']) == 2, log['beacon'])
    tag = pg.evaluate("() => document.querySelector('script[data-cf-beacon]')?.getAttribute('data-cf-beacon')")
    check('on: beacon carries the token and SPA mode', tag and json.loads(tag) == {'token': FAKE_TOKEN, 'spa': True}, tag)
    for want in ['book_click', 'call_click', 'chat_open', 'gift_card_click']:
        check(f'on: {want} sent', want in names, names)
    check('on: 4 booking clicks (header Book, sheet, footer, price table)', names.count('book_click') == 4, names)
    sheet = next((e for e in evs if e['e'] == 'book_click' and e['p'].get('placement') == 'sheet'), None)
    check('on: sheet booking names spa SD and a service', bool(sheet) and sheet['p'].get('spa') == 'SD' and bool(sheet['p'].get('service')), sheet)
    foot = next((e for e in evs if e['e'] == 'book_click' and e['p'].get('placement') == 'footer'), None)
    check('on: footer booking names spa DM', bool(foot) and foot['p'].get('spa') == 'DM', foot)
    menu = next((e for e in evs if e['path'] == '/menu/'), None)
    check('on: path follows the router to /menu/', bool(menu), [e['path'] for e in evs])
    check('on: campaign kept across pages', all(e.get('utm') == {'utm_source': 'google', 'utm_medium': 'cpc', 'utm_campaign': 'gift-season'} for e in evs), [e.get('utm') for e in evs])
    check('on: referring host kept as host only', all(e.get('ref') == 'google.com' for e in evs), [e.get('ref') for e in evs])
    check('on: payloads carry only allowed keys', all(set(e) <= {'e', 'p', 'path', 'ref', 'utm'} for e in evs))
    check('on: no personal data in any payload', not any(x in b.lower() for b in raw for x in PII), [b for b in raw if any(x in b.lower() for x in PII)][:2])
    check('on: no cookies sent with events', not log['cookies_sent'])
    check('on: no page errors', not errors, errors[:2])

    # Consultation form: name and phone go to /api/lead only; the event carries source and spa
    log['events'].clear(); SERVER_EVENTS.clear()
    pg.goto(base + '/consultations/', wait_until='load'); pg.wait_for_timeout(300)
    form = pg.locator('form[data-consult-form]').first
    form.locator('#cf-name').fill('Jane Doe')
    form.locator('#cf-phone').fill('(858) 293-8900')
    form.locator('input[name="spa"][value="SD"]').check(force=True)
    form.locator('[data-consult-send]').click(); pg.wait_for_timeout(500)
    raw = log['events'] or SERVER_EVENTS
    lead = [json.loads(b) for b in raw if b and json.loads(b)['e'] == 'lead_submitted']
    check('on: form lead counted', len(lead) == 1, raw)
    check('on: form lead = source and spa only', bool(lead) and lead[0]['p'] == {'spa': 'SD', 'source': 'consultation-form'}, lead)
    check('on: form lead has no name or phone', not any(x in b.lower() for b in raw for x in PII), raw)
    ctx.close()

    for label, init in (('GPC', GPC), ('DNT', DNT)):
        SERVER_EVENTS.clear()
        ctx, pg, log, errors = context(browser, base, init)
        click_journey(pg, base, '?utm_source=google&utm_medium=cpc&utm_campaign=gift-season')
        check(f'on + {label}: no events sent', not log['events'] and not SERVER_EVENTS, log['events'][:2])
        check(f'on + {label}: no beacon loaded', not log['beacon'], log['beacon'])
        check(f'on + {label}: nothing stored', pg.evaluate("() => { try { return sessionStorage.getItem('ush-src') } catch (e) { return null } }") is None)
        ctx.close()
    srv.shutdown()
    browser.close()

print(f"browser tracking: {'FAIL ' + str(len(fails)) if fails else 'all passed'}")
sys.exit(1 if fails else 0)
