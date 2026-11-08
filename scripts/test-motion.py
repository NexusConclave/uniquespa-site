#!/usr/bin/env python3
"""Motion checks (client request, 24 Oct 2026). Serves dist/ itself on a free port.

  python3 scripts/test-motion.py [dist]

- Every page, 390 and 1440: things below the fold are armed, and after scrolling the whole page nothing is left hidden.
- Same with scroll-driven animations unavailable (Safari < 26 / Firefox simulation): reveals and parallax still run.
- Reduced motion, Pause motion and JS off: nothing armed, no word split, no load animation, ticker static, all visible.
- Word-split headings keep their accessible name; the ticker lists live treatments only and has a working Pause.
- Header lotus draws on the first page of a visit only. Chip price cross-fade fires. Menu items cascade.
- CLS < 0.1 on Home while scrolling (390, 1440); Home LCP < 2.5 s on throttled mobile (4x CPU, ~1.6 Mbps, 150 ms RTT).
"""
import functools, http.server, json, os, re, socketserver, sys, threading
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist')
PAGES = ['/', '/menu/', '/massage/', '/massage/lymphatic-drainage/', '/massage/couples/', '/massage/with-katy/', '/facials/', '/body/',
         '/locations/san-diego/', '/locations/del-mar/', '/consultations/', '/specials/', '/gift-cards/', '/about/', '/contact/',
         '/policies/', '/privacy/', '/accessibility/', '/terms/']

def _guide_pages():
    """Service guides (site.json flags.guides_live; env GUIDES=1/0 overrides): checked only while built."""
    v = os.environ.get('GUIDES', '').strip().lower()
    live = v in ('1', 'true') or (v not in ('0', 'false') and json.load(open(os.path.join(ROOT, 'src/data/site.json')))['flags'].get('guides_live') is True)
    if not live:
        return []
    return ['/guides/'] + ['/guides/%s/' % g['slug'] for g in json.load(open(os.path.join(ROOT, 'src/data/guides.json')))['guides']]
PAGES = PAGES + _guide_pages()
LIVE = {s['id']: s for s in json.load(open(os.path.join(ROOT, 'src/data/services.json')))['services'] if s.get('status') == 'live'}
results = []

def check(name, ok, detail=''):
    results.append((name, ok))
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail != '' else ''))

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def serve():
    httpd = socketserver.TCPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=DIST))
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f'http://127.0.0.1:{httpd.server_address[1]}'

NOSDA_INIT = """(() => { const o = CSS.supports.bind(CSS); CSS.supports = function (a, b) { const s = String(b === undefined ? a : a + ':' + b);
  if (/animation-timeline|timeline-scope|view-timeline/.test(s)) return false; return b === undefined ? o(a) : o(a, b); }; })();"""
def nosda_css(route):
    r = route.fetch(); body = r.text()
    body = body.replace('(animation-timeline:view())', '(animation-timeline-x:view())').replace('(animation-timeline: view())', '(animation-timeline-x: view())')
    body = body.replace('(timeline-scope:--door)', '(timeline-scope-x:--door)')
    route.fulfill(response=r, body=body)

def walk(pg, step=None):
    h = pg.evaluate('innerHeight'); H = pg.evaluate('document.documentElement.scrollHeight')
    y = 0
    while y < H:
        y += step or int(h * 0.6); pg.evaluate(f'window.scrollTo(0,{y})'); pg.wait_for_timeout(70)
        H = pg.evaluate('document.documentElement.scrollHeight')
    pg.wait_for_timeout(1600)

STATE = """() => ({
  armed: document.querySelectorAll('[data-rv]').length,
  left: [...document.querySelectorAll('[data-rv]:not(.is-in)')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 || r.height > 0; })
    .map(e => e.getAttribute('data-rv') + ':' + String(e.className || e.tagName).slice(0, 30)),   // date-gated (display:none) items wait for their day
  split: document.querySelectorAll('.fx-words').length,
  hidden: [...document.querySelectorAll('main *:not(input)')].filter(e => { const cs = getComputedStyle(e); const r = e.getBoundingClientRect();   // chip radios are opacity 0 by design
      return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && parseFloat(cs.opacity) < 0.99 && !e.closest('[aria-hidden="true"], .sr-only, .fx-sr'); })
    .map(e => String(e.className || e.tagName).slice(0, 30)).slice(0, 6),
})"""

def run():
    httpd, base = serve()
    with sync_playwright() as p:
        b = p.chromium.launch()

        # 1 · every page, both widths: armed below the fold, nothing left hidden after a full scroll
        for sda in (True, False):
            for (w, h) in ((390, 664), (1440, 900)):
                ctx = b.new_context(viewport={'width': w, 'height': h})
                if not sda:
                    ctx.add_init_script(NOSDA_INIT); ctx.route(re.compile(r'.*\.css(\?.*)?$'), nosda_css)
                pg = ctx.new_page(); errors = []
                pg.on('pageerror', lambda e: errors.append(str(e)))
                armed_total, left_all, hidden_all = 0, {}, {}
                for path in PAGES:
                    pg.goto(base + path, wait_until='load'); pg.wait_for_timeout(250)
                    walk(pg)
                    st = pg.evaluate(STATE)
                    armed_total += st['armed']
                    if st['left']: left_all[path] = st['left']
                    if st['hidden']: hidden_all[path] = st['hidden']
                tag = f"{w}{'' if sda else ' without scroll-driven CSS'}"
                check(f'{tag}: below-the-fold content is armed for reveals', armed_total > 60, armed_total)
                check(f'{tag}: after scrolling every page, nothing is left hidden', not left_all and not hidden_all, {**left_all, **hidden_all})
                check(f'{tag}: no script errors', not errors, errors[:3])
                if not sda:
                    pg.goto(base + '/', wait_until='load'); pg.wait_for_timeout(300)
                    pg.evaluate("document.querySelector('.lymph__media').scrollIntoView({block: 'center'})"); pg.wait_for_timeout(200)
                    pg.evaluate('window.scrollBy(0, 150)'); pg.wait_for_timeout(200)
                    tr = pg.evaluate("getComputedStyle(document.querySelector('.lymph__media')).translate")
                    check(f'{tag}: parallax falls back to the JS drift', tr not in ('none', '0px', '0px 0px'), tr)
                ctx.close()

        # 2 · reduced motion, Pause motion, JS off: everything visible at once, nothing armed or split
        for mode in ('reduced', 'paused', 'nojs'):
            ctx = b.new_context(viewport={'width': 390, 'height': 664}, reduced_motion='reduce' if mode == 'reduced' else 'no-preference',
                                java_script_enabled=(mode != 'nojs'))
            if mode == 'paused':
                ctx.add_init_script("try { localStorage.setItem('ush-motion', 'paused') } catch (e) {}")
            pg = ctx.new_page(); bad = {}
            for path in ('/', '/massage/couples/', '/about/', '/locations/del-mar/', '/specials/'):
                pg.goto(base + path, wait_until='load'); pg.wait_for_timeout(150)
                st = pg.evaluate(STATE)
                # the hero's scroll-linked door (pure CSS, never hides content) still runs with JS off, as before
                anim = pg.evaluate("""() => document.getAnimations().filter(a => a.playState === 'running' || a.playState === 'pending').map(a => a.animationName || 'x').filter(n => !n.startsWith('door-'))""")
                if st['armed'] or st['split'] or st['hidden'] or anim:
                    bad[path] = {'armed': st['armed'], 'split': st['split'], 'hidden': st['hidden'], 'anim': anim[:5]}
            ticker = None
            pg.goto(base + '/', wait_until='load')
            ticker = pg.evaluate("""() => { const t = document.querySelector('.ticker'); const tr = t.querySelectorAll('.ticker__track');
              return { anim: getComputedStyle(tr[0]).animationName, dup: getComputedStyle(tr[1]).display, btn: getComputedStyle(t.querySelector('.ticker__toggle')).display }; }""")
            check(f'{mode}: no armed, split or half-faded content and no running animation on 5 pages', not bad, bad)
            check(f'{mode}: ticker is a static list (no duplicate, no button)', ticker['anim'] == 'none' and ticker['dup'] == 'none' and ticker['btn'] == 'none', ticker)
            if mode == 'nojs':
                pg.goto(base + '/', wait_until='load')
                vis = pg.evaluate("""() => ['.hero__sub', '.hero__actions', '#band-title', '.step', '.door-card__inner', '.footer__logo'].map(s => { const e = document.querySelector(s); return [s, getComputedStyle(e).opacity]; })""")
                check('JS off: hero, headings, steps, doors and footer fully visible', all(v[1] == '1' for v in vis), vis)
            ctx.close()

        # 3 · semantics and details (motion on)
        ctx = b.new_context(viewport={'width': 390, 'height': 664}); pg = ctx.new_page()
        pg.goto(base + '/', wait_until='load'); pg.wait_for_timeout(300)
        walk(pg)
        names = pg.evaluate("""() => [...document.querySelectorAll('main h2')].filter(h => h.querySelector('.fx-words')).map(h => [h.id, h.querySelector('.fx-sr').textContent.replace(/\\s+/g, ' ').trim()])""")
        heading_ok = all(pg.get_by_role('heading', name=n, exact=True).count() >= 1 for _, n in names if n)
        check('word-split H2s keep their accessible name (the visual copy is aria-hidden)', bool(names) and heading_ok, names[:3])
        tk = pg.evaluate("""() => { const t = document.querySelector('[data-ticker]'); const [a, d] = t.querySelectorAll('.ticker__track');
          return { items: [...a.querySelectorAll('li')].map(li => li.textContent.trim()), dupHidden: d.getAttribute('aria-hidden'), anim: getComputedStyle(a).animationName }; }""")
        live_names = {s['name'] for s in LIVE.values()} | {'Pure Cleanse and Rebalance facial'}
        check('ticker: live treatment names only, duplicate track aria-hidden, moving', tk['items'] and all(n in live_names for n in tk['items']) and tk['dupHidden'] == 'true' and tk['anim'] == 'fx-ticker', tk['items'][:4])
        pg.evaluate("document.querySelector('[data-ticker]').scrollIntoView({block:'center'})"); pg.wait_for_timeout(200)
        pg.click('[data-ticker-toggle]'); pg.mouse.move(5, 5); pg.wait_for_timeout(100)
        ps = pg.evaluate("""() => { const t = document.querySelector('[data-ticker]'); return { state: getComputedStyle(t.querySelector('.ticker__track')).animationPlayState, label: t.querySelector('[data-ticker-label]').textContent, aria: t.querySelector('[data-ticker-toggle]').getAttribute('aria-label') }; }""")
        check('ticker: the visible button pauses it ("Play" / name contains the visible label)', ps['state'] == 'paused' and ps['label'] == 'Play' and 'Play' in ps['aria'], ps)
        size = pg.evaluate("""() => { const b = document.querySelector('[data-ticker-toggle]').getBoundingClientRect(); return [b.width, b.height]; }""")
        check('ticker: Pause button is a 44px target', size[0] >= 44 and size[1] >= 44, size)
        # chip price cross-fade
        pg.goto(base + '/massage/', wait_until='load'); pg.wait_for_timeout(200)
        lab = pg.locator('[data-svc] label:has(input[type=radio])').nth(1)
        lab.scroll_into_view_if_needed(); lab.click(); pg.wait_for_timeout(60)
        sw = pg.evaluate("() => [...document.querySelectorAll('.fx-swap')].map(e => getComputedStyle(e).animationName)")
        check('duration chips: the new price cross-fades in', 'fx-swap' in sw, sw)
        # mobile menu cascade
        pg.click('[data-open="menu"]'); pg.wait_for_timeout(80)
        mm = pg.evaluate("() => [...document.querySelectorAll('#mobile-menu .mm__actions > *')].map(e => getComputedStyle(e).animationName)")
        check('mobile menu: items cascade in as it opens', mm and all(a == 'fx-in-rise' for a in mm), mm[:3])
        pg.keyboard.press('Escape')
        # lotus intro: first page only
        first = pg.evaluate("document.documentElement.hasAttribute('data-fx-intro')")
        ctx.close()
        ctx = b.new_context(viewport={'width': 1440, 'height': 900}); pg = ctx.new_page()
        pg.goto(base + '/', wait_until='load'); pg.wait_for_timeout(150)
        a1 = pg.evaluate("() => [document.documentElement.hasAttribute('data-fx-intro'), getComputedStyle(document.querySelector('.brand .lotus path')).animationName]")
        pg.click('header a[href="/about/"]'); pg.wait_for_url('**/about/'); pg.wait_for_timeout(400)
        a2 = pg.evaluate("() => [document.documentElement.hasAttribute('data-fx-intro'), document.documentElement.hasAttribute('data-fx'), getComputedStyle(document.querySelector('.brand .lotus path')).animationName]")
        pg.reload(wait_until='load')
        a3 = pg.evaluate("() => document.documentElement.hasAttribute('data-fx-intro')")
        check('header lotus draws on the first page of a visit only (not after a page change or reload)', a1 == [True, 'fx-draw'] and a2 == [False, True, 'none'] and a3 is False, [a1, a2, a3])
        # hover: outline button fill sweep and link underline
        pg.goto(base + '/', wait_until='load'); pg.wait_for_timeout(1200)
        btn = pg.locator('.hero__actions .btn--outline').first; btn.hover(); pg.wait_for_timeout(600)
        sweep = pg.evaluate("() => { const b = document.querySelector('.hero__actions .btn--outline'); return [getComputedStyle(b, '::before').transform, getComputedStyle(b).color]; }")
        check('outline buttons: fill sweeps in on hover', sweep[0].startswith('matrix(1,') and sweep[1] == 'rgb(242, 232, 218)', sweep)
        ctx.close()

        # 4 · CLS while scrolling Home
        for (w, h) in ((390, 664), (1440, 900)):
            ctx = b.new_context(viewport={'width': w, 'height': h}); pg = ctx.new_page()
            pg.add_init_script("""window.__cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });""")
            pg.goto(base + '/', wait_until='load'); pg.wait_for_timeout(600)
            walk(pg, step=180)
            cls = pg.evaluate('window.__cls')
            check(f'CLS on Home while scrolling, {w}px: < 0.1', cls < 0.1, round(cls, 4))
            ctx.close()

        # 5 · throttled mobile LCP on Home
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        pg = ctx.new_page()
        cdp = ctx.new_cdp_session(pg)
        cdp.send('Network.enable')
        cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': 150, 'downloadThroughput': 1.6 * 1024 * 1024 / 8, 'uploadThroughput': 750 * 1024 / 8})
        cdp.send('Emulation.setCPUThrottlingRate', {'rate': 4})
        pg.add_init_script("""window.__lcp = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp.push([Math.round(e.startTime), e.element ? (e.element.className || e.element.tagName) + '' : '']); }).observe({ type: 'largest-contentful-paint', buffered: true });""")
        pg.goto(base + '/', wait_until='load'); pg.wait_for_timeout(2500)
        lcp = pg.evaluate('window.__lcp')
        last = lcp[-1] if lcp else [99999, '']
        check('Home LCP on throttled mobile (4x CPU, 1.6 Mbps, 150 ms) < 2.5 s', last[0] < 2500, lcp)
        ctx.close()
        b.close()
    httpd.shutdown()
    failed = [n for n, ok in results if not ok]
    print(f'\n{len(results) - len(failed)} passed, {len(failed)} failed')
    sys.exit(1 if failed else 0)

if __name__ == '__main__':
    run()
