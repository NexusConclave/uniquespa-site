#!/usr/bin/env python3
"""
Dev C page tests (offers, company and legal pages). Run after `PREVIEW=1 npm run build`:
    python3 scripts/test-c.py              # serves dist/
    DIST=../c-dist python3 scripts/test-c.py
Serves the build on a local port and blocks every non-local request. /api/* is MOCKED (route interception):
nothing is ever posted to a real server, Square is never opened, no gift card is ever ordered.

Checks
  1. Screenshots (full page) at 390x664 and 1440x900 -> shots/C-<page>-390.png / -1440.png
  2. axe-core: 0 serious/critical on every dev-C page (+ Home as a regression check), desktop and mobile
  3. /specials: Book links are Square special-item deep links (no codes), no gift link, terms under each card;
     after the end date (fake clock) the cards hide and the empty state shows; next month's card reveals itself
  4. /gift-cards: tiles open the Square eGift page; holiday block + §17509 line; draft note in PREVIEW
  5. /contact: validation (focus + aria-invalid, nothing sent), general lead payload, thank-you deep link at the
     chosen spa (open hours vs after hours via a fake clock), consultation switch (3 fields, no link), honeypot
     (nothing sent), server failure (Try again)
  6. /refer: share box builds the message; copy works; /rewards shows "coming soon" unless loyalty is live
"""
import json, os, sys, threading, functools, datetime
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.abspath(os.path.join(ROOT, os.environ.get('DIST', 'dist')))
SHOTS = os.path.join(ROOT, 'shots')
AXE = os.path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js')
LOCK = json.load(open(os.path.join(ROOT, 'src', 'data', 'square-lock.json')))
SERVICES = json.load(open(os.path.join(ROOT, 'src', 'data', 'services.json')))['services']
os.makedirs(SHOTS, exist_ok=True)

PAGES = {'specials': '/specials/', 'gift-cards': '/gift-cards/', 'rewards': '/rewards/', 'refer': '/refer/', 'about': '/about/',
         'contact': '/contact/', 'policies': '/policies/', 'privacy': '/privacy/', 'accessibility': '/accessibility/',
         'terms': '/terms/', '404': '/404.html'}
SHOT_ONLY = os.environ.get('SHOTS', '1') == '1'
LA = datetime.timezone(datetime.timedelta(hours=-7))  # PDT (late Oct 2026)

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def serve():
    srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=DIST))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}'

results = {'pass': [], 'fail': []}
def check(name, ok, detail=''):
    (results['pass'] if ok else results['fail']).append(f'{name}{": " + str(detail) if detail else ""}')
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))

def new_page(browser, base, w, h, posts=None, lead_status=200, clock=None, reduced=True):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, reduced_motion='reduce' if reduced else 'no-preference')
    pg = ctx.new_page()
    if clock: pg.clock.set_fixed_time(clock)
    def route(r):
        url = r.request.url
        if '/api/' in url:
            if posts is not None: posts.append({'url': url, 'method': r.request.method, 'body': r.request.post_data})
            return r.fulfill(status=lead_status, content_type='application/json', body='{"ok":true}' if lead_status == 200 else '{"error":"x"}')
        if not url.startswith(base): return r.abort()
        return r.continue_()
    pg.route('**/*', route)
    errs = []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg._errs = errs
    return ctx, pg

def sq_id(service, minutes=None, label=None):
    s = next(x for x in SERVICES if x['id'] == service)
    for o in s['options']:
        if (label and o['label'] == label) or (minutes and o['minutes'] == minutes): return o['square_id']
    return s['options'][0]['square_id']

# ---------------------------------------------------------------- screenshots + axe
def screenshots_and_axe(browser, base):
    src = open(AXE).read()
    bad = {}
    for (w, h) in ((390, 664), (1440, 900)):
        ctx, pg = new_page(browser, base, w, h)
        for name, path in list(PAGES.items()) + [('home', '/')]:
            resp = pg.goto(base + path, wait_until='networkidle')
            if name != 'home' and SHOT_ONLY:
                pg.screenshot(path=os.path.join(SHOTS, f'C-{name}-{w}.png'), full_page=True)
            pg.add_script_tag(content=src)
            res = pg.evaluate("""async () => { const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice'] } });
              return r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes.slice(0,3).map(n => n.target.join(' ')) })); }""")
            serious = [v for v in res if v['impact'] in ('serious', 'critical')]
            minor = [v['id'] for v in res if v['impact'] not in ('serious', 'critical')]
            if serious: bad[f'{w} {path}'] = serious
            if minor: print(f'   axe minor {w} {path}: {minor}')
            # One H1, title <= 60, noindex
            meta = pg.evaluate("""() => ({ h1: document.querySelectorAll('main h1').length, title: document.title,
              robots: document.querySelector('meta[name=robots]')?.content, overflow: document.documentElement.scrollWidth > innerWidth + 1 })""")
            if meta['h1'] != 1 or len(meta['title']) > 60 or meta['robots'] != 'noindex, nofollow' or meta['overflow']:
                bad[f'{w} {path} meta'] = meta
        if pg._errs: bad['pageerrors'] = pg._errs
        ctx.close()
    check('axe 0 serious/critical, one H1, title <= 60, noindex, no horizontal scroll (C pages + Home, 390 + 1440)', not bad, bad or '')

# ---------------------------------------------------------------- /specials
def specials(browser, base):
    ctx, pg = new_page(browser, base, 1440, 900, clock=datetime.datetime(2026, 10, 24, 12, tzinfo=LA))
    pg.goto(base + '/specials/', wait_until='networkidle')
    info = pg.evaluate("""() => ({
      cards: [...document.querySelectorAll('.sp__item:not([hidden]) .special')].map(c => ({
        title: c.querySelector('.special__title').textContent.trim(),
        links: [...c.querySelectorAll('a[data-track=book_click]')].map(a => ({ href: a.href, target: a.target })),
        gift: !!c.querySelector('.special__gift'),
        terms: !!c.querySelector('.sp__terms'),
        draft: !!c.querySelector('.draft-note'),
        ends: c.dataset.ends })),
      emptyVisible: getComputedStyle(document.querySelector('.sp__empty')).display !== 'none',
      text: document.querySelector('main').innerText })""")
    lux = sq_id('lymphatic-luxe'); foot = sq_id('foot-glow')
    hrefs = [l['href'] for c in info['cards'] for l in c['links']]
    expected = {f"{LOCK['booking_base'][sp]}/{i}" for i in (lux, foot) for sp in ('SD', 'DM')}
    check('specials: October cards render with draft notes, terms and Ends date', len(info['cards']) == 2 and all(c['terms'] and c['draft'] and c['ends'] == '2026-10-31' for c in info['cards']), [c['title'] for c in info['cards']])
    check('specials: Book links = Square special-item deep links per spa, new tab, no codes', set(hrefs) == expected and all(l['target'] == '_blank' for c in info['cards'] for l in c['links']), hrefs)
    check('specials: no "Give it as a gift" on specials (gift cards not valid on specials)', not any(c['gift'] for c in info['cards']))
    check('specials: empty state hidden while cards show', not info['emptyVisible'])
    low = info['text'].lower()
    check('specials: no "reg.", "valued at", "free", former prices', not any(t in low for t in ('reg.', 'valued at', ' free', 'was $', 'regular price')))
    ctx.close()
    # After Oct 31: October cards hide client-side; November's (upcoming, rendered hidden) reveals itself
    ctx, pg = new_page(browser, base, 1440, 900, clock=datetime.datetime(2026, 11, 2, 10, tzinfo=LA))
    pg.goto(base + '/specials/', wait_until='networkidle')
    after = pg.evaluate("""() => ({ visible: [...document.querySelectorAll('.sp__item:not([hidden])')].map(li => li.dataset.ends),
      emptyVisible: getComputedStyle(document.querySelector('.sp__empty')).display !== 'none' })""")
    check('specials: after Oct 31 the October cards hide; November card reveals on its start date', after['visible'] == ['2026-12-31'], after)
    ctx.close()
    ctx, pg = new_page(browser, base, 1440, 900, clock=datetime.datetime(2027, 1, 15, 10, tzinfo=LA))
    pg.goto(base + '/specials/', wait_until='networkidle')
    late = pg.evaluate("""() => ({ visible: document.querySelectorAll('.sp__item:not([hidden])').length,
      emptyVisible: getComputedStyle(document.querySelector('.sp__empty')).display !== 'none' })""")
    check('specials: with every card expired (stale build) the empty state + gift cards show', late['visible'] == 0 and late['emptyVisible'], late)
    pg.screenshot(path=os.path.join(SHOTS, 'C-specials-empty-1440.png'), full_page=False)
    ctx.close()

# ---------------------------------------------------------------- /gift-cards
def gift_cards(browser, base):
    ctx, pg = new_page(browser, base, 1440, 900, clock=datetime.datetime(2026, 10, 24, 12, tzinfo=LA))
    pg.goto(base + '/gift-cards/', wait_until='networkidle')
    g = pg.evaluate("""() => ({
      tiles: [...document.querySelectorAll('.gc-tile__link')].map(a => ({ amt: a.querySelector('.gc-tile__amt').textContent.trim(), covers: a.querySelector('.gc-tile__covers').textContent.trim(), where: a.querySelector('.gc-tile__where').textContent.trim(), href: a.href, target: a.target })),
      holiday: (() => { const w = document.querySelector('.gc-holiday-wrap'); return w && !w.hidden ? w.innerText : null; })(),
      text: document.querySelector('main').innerText })""")
    amts = [t['amt'] for t in g['tiles']]
    check('gift-cards: tiles $100/$150/$200/$225/$250/$336–$436 + own amount', amts == ['$100', '$150', '$200', '$225', '$250', '$336 or $436', 'Your amount'], amts)
    check('gift-cards: every tile opens the Square eGift page in a new tab', all(t['href'] == LOCK['gift_card_url'] and t['target'] == '_blank' for t in g['tiles']))
    check('gift-cards: Couples tile is San Diego only; others both spas', g['tiles'][5]['where'] == 'Offered in San Diego only' and all(t['where'] == 'Offered at both spas' for t in g['tiles'][:5]), [t['where'] for t in g['tiles']])
    h = g['holiday'] or ''
    check('gift-cards: holiday block (PREVIEW) with §17509 line and draft note', 'Pay $200, they get a $225 eGift card.' in h and '$25 off eGift cards of $225 or more.' in h and 'Draft offer' in h, h[:200])
    check('gift-cards: terms line', 'eGift cards never expire and carry no fees. Balances under $15 can be cashed out.' in g['text'])
    check('gift-cards: no "bonus"/"free"', not any(t in g['text'].lower() for t in (' bonus', ' free')))
    ctx.close()
    ctx, pg = new_page(browser, base, 1440, 900, clock=datetime.datetime(2027, 1, 2, 12, tzinfo=LA))
    pg.goto(base + '/gift-cards/', wait_until='networkidle')
    gone = pg.evaluate("() => ({ block: document.querySelector('.gc-holiday-wrap')?.hidden, deal: [...document.querySelectorAll('.gc-tile__deal')].every(d => d.hidden) })")
    check('gift-cards: holiday block and $225 tile note hide after Dec 31', gone['block'] is True and gone['deal'], gone)
    ctx.close()

# ---------------------------------------------------------------- /contact
def contact(browser, base):
    sd_swedish = f"{LOCK['booking_base']['SD']}/{sq_id('swedish', 60)}"
    couples_sd = f"{LOCK['booking_base']['SD']}/{sq_id('couples', label='60 min, for two')}"

    # Interest list: generated from live services; nothing gated
    posts = []
    ctx, pg = new_page(browser, base, 1440, 900, posts=posts, clock=datetime.datetime(2026, 10, 24, 12, tzinfo=LA))
    pg.goto(base + '/contact/', wait_until='networkidle')
    opts = pg.eval_on_selector_all('#lf-interest option', 'els => els.map(e => [e.value, e.textContent.trim()])')
    live = {s['id'] for s in SERVICES if s['status'] == 'live' and s['medical'] == 'no'}
    ids = [v for v, _ in opts if v and v not in ('gift', 'consultation', 'other')]
    check('contact: interest list = live services + Gift cards + A consultation + Something else', set(ids) <= live and len(ids) >= 15 and {'gift', 'consultation', 'other'} <= {v for v, _ in opts}, len(ids))

    # 1. Empty submit: errors, focus on name, nothing sent
    pg.click('form[data-lead-form=general] [data-lead-send]')
    st = pg.evaluate("""() => ({ focus: document.activeElement.id, invalid: [...document.querySelectorAll('[data-lead-form=general] [aria-invalid=true]')].map(e => e.id),
      errs: [...document.querySelectorAll('[data-lead-form=general] .lf-err:not([hidden])')].map(e => e.textContent.trim()),
      described: document.getElementById('lf-name').getAttribute('aria-describedby') })""")
    check('contact: empty submit shows errors with icon+text, focuses the first, sends nothing', st['focus'] == 'lf-name' and set(st['invalid']) == {'lf-name', 'lf-contact', 'lf-interest'} and 'lf-name-err' in (st['described'] or '') and not posts, st)
    # Bad email
    pg.fill('#lf-name', 'Anna Kowalski'); pg.fill('#lf-contact', 'anna@'); pg.select_option('#lf-interest', 'swedish')
    pg.click('form[data-lead-form=general] [data-lead-send]')
    e = pg.evaluate("() => document.querySelector('#lf-contact-err:not([hidden])')?.textContent.trim()")
    if os.environ.get('DEBUG'): print('DEBUG', e, pg.evaluate("() => [document.getElementById('lf-contact').value, document.activeElement.id]"))
    check('contact: bad email message', e and 'name@example.com' in e and not posts, e)

    # 2. Valid general lead (open hours: Sat 12:00 PT) -> payload + thank-you with the SD Swedish deep link + call
    pg.fill('#lf-contact', 'anna@example.com')
    pg.check('form[data-lead-form=general] input[name=spa][value=SD]')
    pg.fill('#lf-when', 'Saturday morning'); pg.fill('#lf-notes', 'First time, any tips?')
    pg.click('form[data-lead-form=general] [data-lead-send]')
    pg.wait_for_selector('[data-lead-done]:not([hidden])')
    body = json.loads(posts[0]['body']) if posts else {}
    want = {'name': 'Anna Kowalski', 'contact': 'anna@example.com', 'interest': 'Swedish massage', 'location': 'San Diego',
            'preferred_datetime': 'Saturday morning', 'notes': 'First time, any tips?', 'source': 'website form', 'website': ''}
    check('contact: POST /api/lead JSON payload (general form)', len(posts) == 1 and posts[0]['method'] == 'POST' and body == want, body)
    done = pg.evaluate("""() => { const d = document.querySelector('[data-lead-done]'); return { focus: document.activeElement === d, text: d.innerText,
      href: d.querySelector('[data-done-link]').href, call: !d.querySelector('[data-done-call]').hidden }; }""")
    check('contact: thank-you (open hours) names, no time promise, deep link Swedish at San Diego + call', done['focus'] and 'Thanks, Anna.' in done['text'] and 'between appointments' in done['text']
          and done['href'] == sd_swedish and done['call'] and 'within' not in done['text'].lower() and 'First time' not in done['text'], done)
    pg.wait_for_timeout(400)
    check('contact: submit never navigates (no name/phone in the URL; ClientRouter kept out)', pg.url == base + '/contact/' and not pg.evaluate("location.search"), pg.url)
    pg.screenshot(path=os.path.join(SHOTS, 'C-contact-thanks-1440.png'))
    ctx.close()

    # 3. After hours (22:00 PT), Couples chosen at Del Mar -> link falls back to San Diego (Couples is SD-only), no call line
    posts = []
    ctx, pg = new_page(browser, base, 390, 664, posts=posts, clock=datetime.datetime(2026, 10, 24, 22, tzinfo=LA))
    pg.goto(base + '/contact/', wait_until='networkidle')
    pg.fill('#lf-name', 'Bahar Z'); pg.fill('#lf-contact', '(858) 555-0123'); pg.select_option('#lf-interest', 'couples')
    pg.check('form[data-lead-form=general] input[name=spa][value=DM]')
    pg.click('form[data-lead-form=general] [data-lead-send]')
    pg.wait_for_selector('[data-lead-done]:not([hidden])')
    done = pg.evaluate("""() => { const d = document.querySelector('[data-lead-done]'); return { text: d.innerText, href: d.querySelector('[data-done-link]').href, call: !d.querySelector('[data-done-call]').hidden }; }""")
    check('contact: after hours → "when we open", never a Del Mar link for a San Diego-only item', 'when we open' in done['text'] and done['href'] == couples_sd and not done['call'] and 'Couples massage at San Diego' in done['text'], done)
    pg.screenshot(path=os.path.join(SHOTS, 'C-contact-thanks-390.png'))
    ctx.close()

    # 4. Consultation: switches to the 3-field form, carries name + spa, sends source "consultation form", no link
    posts = []
    ctx, pg = new_page(browser, base, 1440, 900, posts=posts, clock=datetime.datetime(2026, 10, 24, 12, tzinfo=LA))
    pg.goto(base + '/contact/', wait_until='networkidle')
    pg.fill('#lf-name', 'Terry Hale'); pg.check('form[data-lead-form=general] input[name=spa][value=DM]')
    pg.select_option('#lf-interest', 'consultation')
    c = pg.evaluate("""() => { const f = document.querySelector('form[data-lead-form=consult]'); return { shown: !f.hidden, general: document.querySelector('form[data-lead-form=general]').hidden,
      fields: [...f.querySelectorAll('input:not([name=website]), select, textarea')].map(e => e.name).filter((v, i, a) => a.indexOf(v) === i),
      name: f.querySelector('#lf-c-name').value, spa: f.querySelector('input[name=spa]:checked')?.value, focus: document.activeElement.id }; }""")
    check('contact: "A consultation" swaps to the 3-field form (name, phone, spa), focus on its heading', c['shown'] and c['general'] and c['fields'] == ['name', 'phone', 'spa'] and c['name'] == 'Terry Hale' and c['spa'] == 'DM' and c['focus'] == 'lf-c-title', c)
    pg.screenshot(path=os.path.join(SHOTS, 'C-contact-consult-1440.png'))
    pg.click('form[data-lead-form=consult] [data-lead-send]')
    ph = pg.evaluate("() => ({ focus: document.activeElement.id, err: !document.getElementById('lf-c-phone-err').hidden })")
    check('contact: consultation phone required', ph['focus'] == 'lf-c-phone' and ph['err'] and not posts, ph)
    pg.fill('#lf-c-phone', '858-555-0199')
    pg.click('form[data-lead-form=consult] [data-lead-send]')
    pg.wait_for_selector('[data-lead-done]:not([hidden])')
    body = json.loads(posts[0]['body']) if posts else {}
    check('contact: consultation payload has 3 fields only (+ interest/source/honeypot)', body == {'name': 'Terry Hale', 'contact': '858-555-0199', 'location': 'Del Mar', 'interest': 'Consultation', 'source': 'consultation form', 'website': ''}, body)
    d = pg.evaluate("() => { const d = document.querySelector('[data-lead-done]'); return { text: d.innerText, book: !d.querySelector('[data-done-book]').hidden }; }")
    check('contact: consultation thank-you, no booking link', "We'll call or text you to arrange a consultation." in d['text'] and not d['book'], d)
    # Back to the general form via "Send another message"
    pg.click('[data-lead-again]')
    back = pg.evaluate("() => ({ general: !document.querySelector('form[data-lead-form=general]').hidden, focus: document.activeElement.id })")
    check('contact: "Send another message" restores the general form', back['general'] and back['focus'] == 'lf-name', back)
    ctx.close()

    # 5. Honeypot: looks done, sends nothing
    posts = []
    ctx, pg = new_page(browser, base, 1440, 900, posts=posts)
    pg.goto(base + '/contact/', wait_until='networkidle')
    pg.fill('#lf-name', 'Bot'); pg.fill('#lf-contact', 'bot@example.com'); pg.select_option('#lf-interest', 'other')
    pg.evaluate("document.getElementById('lf-website').value = 'http://spam.example'")
    pg.click('form[data-lead-form=general] [data-lead-send]')
    pg.wait_for_selector('[data-lead-done]:not([hidden])')
    hp = pg.evaluate("() => ({ hidden: getComputedStyle(document.querySelector('.lf-hp')).position, tab: document.getElementById('lf-website').tabIndex })")
    check('contact: honeypot "website" is off-screen, untabbable; filled → nothing sent', not posts and hp['hidden'] == 'absolute' and hp['tab'] == -1, hp)
    ctx.close()

    # 6. Server failure: message + Try again, form kept
    posts = []
    ctx, pg = new_page(browser, base, 1440, 900, posts=posts, lead_status=500)
    pg.goto(base + '/contact/', wait_until='networkidle')
    pg.fill('#lf-name', 'Irina'); pg.fill('#lf-contact', 'irina@example.com'); pg.select_option('#lf-interest', 'gift')
    pg.click('form[data-lead-form=general] [data-lead-send]')
    pg.wait_for_function("document.querySelector('form[data-lead-form=general] [data-lead-status]').textContent.includes('didn')")
    f = pg.evaluate("() => ({ status: document.querySelector('form[data-lead-form=general] [data-lead-status]').textContent, btn: document.querySelector('form[data-lead-form=general] [data-lead-send]').textContent.trim(), form: !document.querySelector('form[data-lead-form=general]').hidden })")
    check('contact: failure keeps the form, says so, offers Try again + phone', f['form'] and f['btn'] == 'Try again' and '(858) 293-8900' in f['status'] and len(posts) == 1, f)
    ctx.close()

    # 7. Keyboard: the form is reachable and the spa chips are one radio group
    ctx, pg = new_page(browser, base, 1440, 900)
    pg.goto(base + '/contact/', wait_until='networkidle')
    pg.focus('#lf-contact'); pg.keyboard.press('Tab')
    k1 = pg.evaluate("() => document.activeElement.name + ':' + document.activeElement.value")
    pg.keyboard.press('Tab')
    k2 = pg.evaluate("() => document.activeElement.id")
    check('contact: keyboard — spa chips are one tab stop, then the interest select', k1 == 'spa:' and k2 == 'lf-interest', [k1, k2])
    ctx.close()

# ---------------------------------------------------------------- /refer and /rewards
def refer_rewards(browser, base):
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, permissions=['clipboard-read', 'clipboard-write'])
    pg = ctx.new_page()
    pg.route('**/*', lambda r: r.continue_() if r.request.url.startswith(base) else r.abort())
    pg.goto(base + '/refer/', wait_until='networkidle')
    pg.fill('#rf-name', 'Kristina')
    msg = pg.input_value('#rf-msg')
    check('refer: share box writes the message with the name and link', 'Referred by Kristina' in msg and 'utm_source=referral' in msg, msg)
    pg.click('[data-refer-copy]')
    pg.wait_for_function("document.querySelector('[data-refer-status]').textContent.length > 0")
    clip = pg.evaluate('navigator.clipboard.readText()')
    check('refer: copy puts the message on the clipboard', clip == msg)
    linked = []
    for path in ['/', '/specials/', '/gift-cards/', '/rewards/', '/about/', '/contact/', '/menu/']:
        pg.goto(base + path, wait_until='domcontentloaded')
        if pg.evaluate("() => !!document.querySelector('a[href=\"/refer\"], a[href=\"/refer/\"]')"): linked.append(path)
    check('refer: not linked from any page while refer_live is off', not linked, linked)
    pg.goto(base + '/rewards/', wait_until='networkidle')
    t = pg.inner_text('main')
    check('rewards: "coming soon / ask at the desk" while loyalty is off; draft details in PREVIEW', 'Coming soon' in t and 'Ask at the desk' in t and 'Draft' in t, t[:160])
    ctx.close()

def main():
    srv, base = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        only = os.environ.get('ONLY')
        for fn in (screenshots_and_axe, specials, gift_cards, contact, refer_rewards):
            if only and fn.__name__ not in only.split(','): continue
            try: fn(browser, base)
            except Exception as e: check(f'{fn.__name__} crashed', False, repr(e)[:300])
        browser.close()
    srv.shutdown()
    json.dump(results, open(os.path.join(SHOTS, 'test-c-report.json'), 'w'), indent=1)
    print(f"\n{len(results['pass'])} passed, {len(results['fail'])} failed")
    sys.exit(1 if results['fail'] else 0)

if __name__ == '__main__':
    main()
