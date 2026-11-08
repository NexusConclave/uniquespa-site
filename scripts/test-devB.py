#!/usr/bin/env python3
"""
Dev B page tests: /menu, /massage (+3 flagships), /facials, /body, /locations/*, /consultations.
Run after a PREVIEW build:  python3 scripts/test-devB.py [dist-dir]   (default: dist)
Serves the build locally, blocks every non-local request, mocks /api/* (never posts to the real API,
never opens Square). Screenshots → shots/B-*.png; report → shots/B-report.json.

Checks: one H1, title <= 60 chars without "med spa"; every Square link (rendered or in chip data) matches
square-lock.json (spa base, id, offered at that spa, live service); JSON-LD parses, FAQPage only where an FAQ
is visible, Offer prices match the lockfile, no AggregateRating; axe 0 serious/critical (desktop + mobile);
duration chips announce the price; the consultation form (3 fields + honeypot) posts the right JSON.
"""
import json, os, re, sys, threading, functools
from urllib.parse import urlparse
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, sys.argv[1] if len(sys.argv) > 1 else 'dist')
SHOTS = os.path.join(ROOT, 'shots')
AXE = os.path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js')
LOCK = json.load(open(os.path.join(ROOT, 'src/data/square-lock.json')))
SERVICES = json.load(open(os.path.join(ROOT, 'src/data/services.json')))['services']
os.makedirs(SHOTS, exist_ok=True)

PAGES = ['/menu/', '/massage/', '/massage/lymphatic-drainage/', '/massage/couples/', '/massage/with-katy/', '/facials/', '/body/',
         '/locations/san-diego/', '/locations/del-mar/', '/consultations/']

def _guide_pages():
    """Service guides (site.json flags.guides_live; env GUIDES=1/0 overrides): checked only while built."""
    v = os.environ.get('GUIDES', '').strip().lower()
    live = v in ('1', 'true') or (v not in ('0', 'false') and json.load(open(os.path.join(ROOT, 'src/data/site.json')))['flags'].get('guides_live') is True)
    if not live:
        return []
    return ['/guides/'] + ['/guides/%s/' % g['slug'] for g in json.load(open(os.path.join(ROOT, 'src/data/guides.json')))['guides']]
PAGES = PAGES + _guide_pages()
BASES = {v: k for k, v in LOCK['booking_base'].items()}
LOCK_BY_ID = {s['id']: s for s in LOCK['services']}
OWNER = {o['square_id']: s for s in SERVICES for o in s.get('options', []) if 'square_id' in o}

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def serve():
    srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=DIST))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}'

results = {'pass': [], 'fail': [], 'info': {}}
def check(name, ok, detail=''):
    (results['pass'] if ok else results['fail']).append(f'{name}{": " + str(detail) if detail else ""}')
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{str(detail)[:400]}]' if detail else ''))

posted = []
def guard(page, base, lead_status=200):
    def route(r):
        url = r.request.url
        if '/api/' in url:
            if '/api/lead' in url:
                posted.append(r.request.post_data)
            return r.fulfill(status=lead_status if '/api/lead' in url else 200, content_type='application/json', body='{"ok":true}')
        if not url.startswith(base):
            return r.abort()
        return r.continue_()
    page.route('**/*', route)
    page.on('pageerror', lambda e: results['fail'].append(f'pageerror {page.url}: {e}'))

def new_page(browser, base, w, h, reduced=True):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, reduced_motion='reduce' if reduced else 'no-preference')
    pg = ctx.new_page(); guard(pg, base)
    return ctx, pg

def slug(path):
    return path.strip('/').replace('/', '-') or 'home'

def check_link(href, spa_claim=None):
    """Return a problem string or None for one Square booking URL (a service deep link or a spa's service list)."""
    if href in BASES:   # the spa's own booking page (service list)
        return None if not spa_claim or spa_claim == BASES[href] else f'{href}: tracked as {spa_claim} but is {BASES[href]}'
    u = href.rsplit('/', 1)
    base, sq = u[0], u[1]
    spa = BASES.get(base)
    if not spa:
        return f'unknown booking base {base}'
    if spa_claim and spa_claim != spa:
        return f'{sq}: tracked as {spa_claim} but links to {spa}'
    lk = LOCK_BY_ID.get(sq)
    if not lk:
        return f'{sq}: not in square-lock'
    if spa not in lk['locations']:
        return f'{sq} ({lk["name"]}): not offered at {spa}'
    owner = OWNER.get(sq)
    if not owner or owner.get('status') != 'live':
        return f'{sq} ({lk["name"]}): service not live'
    return None

def page_checks(pg, path):
    info = pg.evaluate("""() => {
      const links = [...document.querySelectorAll('a[href^="https://book.squareup.com"]')].map(a => {
        let p = {}; try { p = JSON.parse(a.dataset.trackProps || '{}'); } catch (e) {}
        return { href: a.href, spa: p.spa || a.dataset.book || null, hidden: !!a.closest('[hidden]') || a.hidden, inFooter: !!a.closest('.site-footer, #book-sheet') };
      });
      const chipLinks = [...document.querySelectorAll('[data-svc][data-options]')].flatMap(c => {
        try { return JSON.parse(c.dataset.options).flatMap(o => Object.entries(o.links).map(([spa, href]) => ({ spa, href }))); } catch (e) { return []; }
      });
      const ld = [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent);
      return { h1: document.querySelectorAll('h1').length, h1text: document.querySelector('h1')?.textContent.trim(), title: document.title,
               links, chipLinks, ld, faqVisible: !!document.querySelector('.faq .faq__item'),
               words: (document.querySelector('main')?.innerText || '').split(/\\s+/).filter(Boolean).length };
    }""")
    problems = []
    for l in info['links'] + info['chipLinks']:
        p = check_link(l['href'], l.get('spa'))
        if p: problems.append(p)
    check(f'{path}: every Square link matches square-lock (spa, id, offered there, live)', not problems, problems or f"{len(info['links'])} links + {len(info['chipLinks'])} chip links")
    check(f'{path}: exactly one H1', info['h1'] == 1, info['h1text'])
    t = info['title']
    check(f'{path}: title <= 60 chars, no "med spa"', len(t) <= 60 and not re.search(r'med ?spa', t, re.I), f'{len(t)}: {t}')
    # JSON-LD
    ok, notes = True, []
    types = []
    for raw in info['ld']:
        try:
            data = json.loads(raw)
        except Exception as e:
            ok = False; notes.append(f'bad JSON: {e}'); continue
        nodes = data.get('@graph', [data])
        for n in nodes:
            types.append(n.get('@type'))
            if n.get('@type') == 'Service':
                for off in n.get('offers', []):
                    sq = off['url'].rsplit('/', 1)[1]
                    lk = LOCK_BY_ID.get(sq)
                    if not lk or lk['price_type'] != 'fixed' or abs(lk['price_cents'] / 100 - float(off['price'])) > 0.001:
                        if 'validThrough' not in off:
                            ok = False; notes.append(f'offer price mismatch {sq} {off["price"]}')
                    p = check_link(off['url'])
                    if p: ok = False; notes.append('offer url: ' + p)
        if 'AggregateRating' in raw: ok = False; notes.append('AggregateRating')
    if ('FAQPage' in types) != info['faqVisible']:
        ok = False; notes.append(f"FAQPage in schema={('FAQPage' in types)} but visible FAQ={info['faqVisible']}")
    if 'BreadcrumbList' not in types: ok = False; notes.append('no BreadcrumbList')
    check(f'{path}: JSON-LD valid (Offers = lock prices, FAQPage only with a visible FAQ, breadcrumb, no rating)', ok, notes or types)
    results['info'][f'{path} words'] = info['words']
    return info

def screenshots_and_axe(browser, base):
    src = open(AXE).read()
    bad = {}
    for (w, h, tag) in ((390, 664, '390'), (1440, 900, '1440')):
        ctx, pg = new_page(browser, base, w, h)
        for path in PAGES:
            pg.goto(base + path, wait_until='networkidle')
            H = pg.evaluate('document.documentElement.scrollHeight')
            for y in range(0, H, h // 2):
                pg.evaluate(f'window.scrollTo(0,{y})'); pg.wait_for_timeout(40)
            pg.evaluate('window.scrollTo(0,0)'); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(200)
            pg.screenshot(path=os.path.join(SHOTS, f'B-{slug(path)}-{tag}.png'), full_page=True)
            pg.screenshot(path=os.path.join(SHOTS, f'B-{slug(path)}-{tag}-first.png'))
            if tag == '1440':
                page_checks(pg, path)
            # no horizontal overflow
            ov = pg.evaluate('document.documentElement.scrollWidth - innerWidth')
            check(f'{path} @{w}: no horizontal scroll', ov <= 0, ov)
            pg.add_script_tag(content=src)
            res = pg.evaluate("""async () => { const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice'] } });
              return r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes.slice(0,3).map(n => n.target.join(' ')) })); }""")
            serious = [v for v in res if v['impact'] in ('serious', 'critical')]
            results['info'][f'axe {tag} {path}'] = res
            if serious: bad[f'{tag} {path}'] = serious
        ctx.close()
    check(f'axe: 0 serious/critical on {len(PAGES)} dev B pages (390 + 1440)', not bad, bad or '')

def chips(browser, base):
    ctx, pg = new_page(browser, base, 1440, 900)
    pg.goto(base + '/massage/lymphatic-drainage/', wait_until='networkidle')
    pg.click('.b-box .chip:nth-child(2)'); pg.wait_for_timeout(100)
    live = pg.evaluate("document.querySelector('.b-box [aria-live] [data-svc-spoken]').textContent")
    num = pg.evaluate("document.querySelector('.b-box [data-svc-num]').textContent")
    lk = LOCK_BY_ID['SUA4OVPO4ULNIEGP2OO7HTXU']
    want = f"${lk['price_cents'] // 100}"
    check('lymphatic: 90 min chip updates the aria-live price (serif price too)', f'90 minutes, {want}' in live and num == want, (live, num))
    # Couples: San Diego only, one Book button
    pg.goto(base + '/massage/couples/', wait_until='networkidle')
    c = pg.evaluate("""() => ({ chip: document.querySelector('.b-box .where__chip--single')?.textContent.trim(),
      books: [...document.querySelectorAll('.b-box [data-book]')].filter(a => !a.hidden).map(a => a.dataset.book) })""")
    check('couples: "San Diego only" chip and only a San Diego Book button', c['chip'] == 'San Diego only' and c['books'] == ['SD'], c)
    # Del Mar page: its service lists and buttons only link to Del Mar (offer cards for both-spa specials may show both)
    pg.goto(base + '/locations/del-mar/', wait_until='networkidle')
    d = pg.evaluate("""() => [...document.querySelectorAll('main a[href^="https://book.squareup.com"]')].filter(a => !a.closest('.special')).map(a => a.href)""")
    chip = pg.evaluate("""() => [...document.querySelectorAll('main [data-svc][data-options]')].flatMap(c => JSON.parse(c.dataset.options).flatMap(o => Object.values(o.links)))""")
    sd_base = LOCK['booking_base']['SD']
    bad = [x for x in d + chip if x.startswith(sd_base)]
    check('del mar page: no San Diego booking link in its services or buttons', not bad, bad)
    ctx.close()

def consult_form(browser, base):
    posted.clear()
    ctx, pg = new_page(browser, base, 390, 664)
    pg.goto(base + '/consultations/', wait_until='networkidle')
    f = pg.evaluate("""() => { const f = document.querySelector('form[data-consult-form]');
      return { visible: !f.hidden, fields: [...f.querySelectorAll('input')].map(i => i.name + ':' + i.type),
               call: !!document.querySelector('main a[href^="tel:"]'), text: !!document.querySelector('main a[href^="sms:"]'),
               booking: document.querySelectorAll('main a[href*="squareup.com"]').length }; }""")
    names = sorted({x.split(':')[0] for x in f['fields']})
    check('consultations: form = name, phone, spa + honeypot "website" only', f['visible'] and names == ['name', 'phone', 'spa', 'website'], f['fields'])
    check('consultations: Call and Text us shown, no booking link in the page', f['call'] and f['text'] and f['booking'] == 0, f)
    navs = []
    pg.on('framenavigated', lambda fr: navs.append(fr.url) if fr == pg.main_frame else None)
    pg.click('[data-consult-send]'); pg.wait_for_timeout(150)
    errs = pg.evaluate("[...document.querySelectorAll('.field__err:not([hidden])')].map(e => e.textContent.trim())")
    foc = pg.evaluate("document.activeElement.id")
    check('consultations: empty submit shows 3 errors and focuses the first field; nothing sent', len(errs) == 3 and foc == 'cf-name' and not posted, (errs, foc, posted))
    pg.keyboard.press('Enter'); pg.wait_for_timeout(200)   # Enter in a field submits too
    # (same-URL history.replaceState updates from ClientRouter's scroll bookkeeping are fine; a query string or another URL is not)
    away = lambda: [u for u in navs if '?' in u or not u.endswith('/consultations/')]
    check('consultations: invalid submits never navigate (URL has no query string)', '?' not in pg.url and not away(), (pg.url, navs))
    pg.fill('#cf-name', 'Anna Smith'); pg.fill('#cf-phone', '(619) 555-0134'); pg.check('input[name=spa][value=DM]')
    pg.click('[data-consult-send]'); pg.wait_for_timeout(500)
    check('consultations: a valid submit stays on the page with no query string (no GET of name/phone)', '?' not in pg.url and not away() and pg.url.endswith('/consultations/'), (pg.url, navs))
    body = json.loads(posted[-1]) if posted else {}
    done = pg.evaluate("({ text: document.querySelector('[data-consult-done]').innerText.replace(/\\s+/g,' ').trim(), focus: document.activeElement.matches('[data-consult-done]'), formHidden: document.querySelector('form[data-consult-form]').hidden })")
    check('consultations: posts JSON {name, contact, location, source: "consultation form"} to /api/lead',
          body.get('name') == 'Anna Smith' and body.get('contact') == '(619) 555-0134' and body.get('location') == 'Del Mar' and body.get('source') == 'consultation form' and not body.get('website'), body)
    check('consultations: thank-you "Thanks, Anna. We\'ll call or text you to arrange a consultation." with focus, no booking link',
          done['text'].startswith("Thanks, Anna. We'll call or text you to arrange a consultation.") and done['focus'] and done['formHidden'] and 'squareup' not in pg.inner_html('[data-consult-done]'), done)
    pg.screenshot(path=os.path.join(SHOTS, 'B-consultations-390-thanks.png'), full_page=False)
    ctx.close()
    # Honeypot: filled → nothing is sent
    posted.clear()
    ctx, pg = new_page(browser, base, 1440, 900)
    pg.goto(base + '/consultations/', wait_until='networkidle')
    pg.fill('#cf-name', 'Bot'); pg.fill('#cf-phone', '6195550134'); pg.check('input[name=spa][value=SD]')
    pg.evaluate("document.getElementById('cf-website').value = 'http://spam.example'")
    pg.click('[data-consult-send]'); pg.wait_for_timeout(300)
    check('consultations: honeypot filled → nothing posted', not posted, posted)
    ctx.close()
    # Arriving by a client-side (ClientRouter) navigation: the form still appears and a submit never navigates
    posted.clear()
    ctx, pg = new_page(browser, base, 1440, 900)
    pg.goto(base + '/menu/', wait_until='networkidle')
    pg.evaluate("const a = document.createElement('a'); a.href = '/consultations/'; a.id = 'go'; a.textContent = 'go'; document.querySelector('main').prepend(a)")
    pg.click('#go'); pg.wait_for_selector('form[data-consult-form]:not([hidden])', timeout=5000)
    pg.fill('#cf-name', 'Ben'); pg.fill('#cf-phone', '6195550134'); pg.check('input[name=spa][value=SD]')
    pg.click('[data-consult-send]'); pg.wait_for_timeout(500)
    ok = '?' not in pg.url and bool(posted) and pg.evaluate("!document.querySelector('[data-consult-done]').hidden")
    check('consultations: after a ClientRouter navigation the form posts JSON and the URL stays clean', ok, (pg.url, posted))
    ctx.close()
    # Failure state
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce'); pg = ctx.new_page(); guard(pg, base, lead_status=500)
    pg.goto(base + '/consultations/', wait_until='networkidle')
    pg.fill('#cf-name', 'Anna'); pg.fill('#cf-phone', '6195550134'); pg.check('input[name=spa][value=SD]')
    pg.click('[data-consult-send]'); pg.wait_for_timeout(400)
    st = pg.evaluate("document.querySelector('[data-consult-status]').textContent")
    check('consultations: a failed send says so and offers the phone', "didn't send" in st and '293-8900' in st, st)
    ctx.close()

def main():
    srv, base = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        screenshots_and_axe(browser, base)
        chips(browser, base)
        consult_form(browser, base)
        browser.close()
    srv.shutdown()
    with open(os.path.join(SHOTS, 'B-report.json'), 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\n{len(results['pass'])} passed, {len(results['fail'])} failed")
    sys.exit(1 if results['fail'] else 0)

if __name__ == '__main__':
    main()
