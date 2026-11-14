#!/usr/bin/env python3
"""
Phase-A browser tests (blueprint §13). Run after `PREVIEW=1 npm run build`:  python3 scripts/test-home.py
Serves dist/ on a local port, blocks every non-local request, mocks /api/* (never posts to the real API,
never opens Square). Writes screenshots to shots/ and a JSON report to shots/test-report.json.

Checks
  1. Screenshots: Home at 390x664 and 1440x900; hero at 25/50/75% of the "Come in" range (1280, 1440, 1920).
  2. Hero geometry: no visible text over the photo; faded H1 block is visibility:hidden (can't take focus);
     the 50% frame is an in-between shape; full bleed holds >= 30vh.
  3. Mobile first screen (390x664): H1, Book, rating line and >= 120px of arch crown above the bar.
  4. Static mode: reduced motion, Pause motion, < 500px tall: no sticky frame, no dead scroll, H1 stays visible.
  5. axe-core on Home + every stub (desktop and mobile): 0 serious/critical.
  6. Keyboard: Book sheet (focus to heading, radio group, Esc, focus returns), header disclosures, mobile menu.
  7. Budgets: JS <= 100 KB (excl. the on-demand voice SDK), every image <= 200 KB.
"""
import json, os, sys, threading, functools, glob
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, 'dist')
SHOTS = os.path.join(ROOT, 'shots')
AXE = os.path.join(ROOT, 'node_modules', 'axe-core', 'axe.min.js')
os.makedirs(SHOTS, exist_ok=True)

PAGES = ['/', '/menu/', '/massage/', '/massage/lymphatic-drainage/', '/massage/couples/', '/massage/with-katy/', '/facials/', '/body/',
         '/locations/san-diego/', '/locations/del-mar/', '/consultations/', '/specials/', '/gift-cards/', '/rewards/', '/refer/',
         '/about/', '/contact/', '/policies/', '/privacy/', '/accessibility/', '/terms/', '/404.html']

def _guide_pages():
    """Service guides (site.json flags.guides_live; env GUIDES=1/0 overrides): checked only while built."""
    v = os.environ.get('GUIDES', '').strip().lower()
    live = v in ('1', 'true') or (v not in ('0', 'false') and json.load(open(os.path.join(ROOT, 'src/data/site.json')))['flags'].get('guides_live') is True)
    if not live:
        return []
    return ['/guides/'] + ['/guides/%s/' % g['slug'] for g in json.load(open(os.path.join(ROOT, 'src/data/guides.json')))['guides']]
PAGES = PAGES + _guide_pages()

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *a): pass

def serve():
    srv = ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=DIST))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv, f'http://127.0.0.1:{srv.server_address[1]}'

results = {'pass': [], 'fail': [], 'info': {}}
def check(name, ok, detail=''):
    (results['pass'] if ok else results['fail']).append(f'{name}{": " + str(detail) if detail else ""}')
    print(('PASS ' if ok else 'FAIL ') + name + (f'  [{detail}]' if detail else ''))

def guard(page, base):
    def route(r):
        url = r.request.url
        if '/api/' in url:
            return r.fulfill(status=200, content_type='application/json', body='{"reply":"(mocked)"}')
        if not url.startswith(base):
            return r.abort()
        return r.continue_()
    page.route('**/*', route)
    page.on('pageerror', lambda e: results['fail'].append(f'pageerror: {e}'))

def new_page(browser, base, w, h, reduced=False, paused=False):
    ctx = browser.new_context(viewport={'width': w, 'height': h}, reduced_motion='reduce' if reduced else 'no-preference')
    if paused:
        ctx.add_init_script("try{localStorage.setItem('ush-motion','paused')}catch(e){}")
    pg = ctx.new_page(); guard(pg, base)
    return ctx, pg

HERO_JS = """(p) => {
  const st = document.querySelector('.door__stage');
  const hh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 0;
  const top = st.getBoundingClientRect().top + scrollY;
  const len = st.offsetHeight - (innerHeight - hh);
  return Math.round(top - hh + p * len);
}"""

GEOM_JS = """() => {
  const pic = document.querySelector('.door__picture'), r = pic.getBoundingClientRect();
  const intro = document.querySelector('.door__intro'), cs = getComputedStyle(intro);
  const clip = getComputedStyle(pic).clipPath;
  const introVisible = cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.01;
  // While the H1 block is visible the arch is at rest: its left edge is 96% - --w of the frame.
  // Any visible text box reaching past that edge would sit over the photo.
  const w = Math.min(innerWidth * 0.42, innerHeight * 0.62);
  const archLeft = r.left + r.width * 0.96 - w;
  let overlap = false;
  if (introVisible) intro.querySelectorAll('h1, p, a, button').forEach((el) => {
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.right > archLeft && b.bottom > r.top && b.top < r.bottom) overlap = true;
  });
  const a = document.getAnimations().find((x) => x.animationName && x.animationName.startsWith('door-open'));
  const progress = a ? a.effect.getComputedTiming().progress : null;
  return { introVisible, introVisibility: cs.visibility, opacity: cs.opacity, clip, overlap, progress, frameTop: r.top, frameH: r.height };
}"""

def hero_frames(browser, base, w, h, tag):
    ctx, pg = new_page(browser, base, w, h)
    pg.goto(base + '/', wait_until='networkidle'); pg.wait_for_timeout(300)
    out = {}
    for p in (0, 0.25, 0.5, 0.75, 1.0):
        y = pg.evaluate(HERO_JS, p)
        pg.evaluate(f'window.scrollTo(0,{y})'); pg.wait_for_timeout(350)
        g = pg.evaluate(GEOM_JS)
        out[p] = g
        if p in (0.25, 0.5, 0.75):
            pg.screenshot(path=os.path.join(SHOTS, f'hero-{tag}-{int(p*100)}.png'))
    check(f'hero {tag}: no visible text over the photo (0/25/50/75%)', not any(out[p]['overlap'] for p in out), {p: out[p]['overlap'] for p in out})
    check(f'hero {tag}: H1 block hidden (visibility) from 25%', all(out[p]['introVisibility'] == 'hidden' for p in (0.25, 0.5, 0.75)), [out[p]['introVisibility'] for p in (0.25, 0.5, 0.75)])
    pr = {p: out[p]['progress'] for p in out}
    check(f'hero {tag}: arch at rest at 0%, in-between (rounded) at 50%', pr[0] == 0 and pr[0.5] is not None and 0 < pr[0.5] < 1 and 'round' in out[0.5]['clip'], pr)
    check(f'hero {tag}: full bleed at 75% and 100%', pr[0.75] is not None and pr[0.75] >= 0.999 and pr[1.0] >= 0.999, pr)
    # full bleed holds for >= 30vh: 55%..100% of the contain range
    hold = pg.evaluate(HERO_JS, 1.0) - pg.evaluate(HERO_JS, 0.55)
    check(f'hero {tag}: full bleed holds >= 30vh', hold >= 0.3 * h, f'{hold}px vs {0.3*h:.0f}px')
    ctx.close()

def mobile_first_screen(browser, base):
    ctx, pg = new_page(browser, base, 390, 664)
    pg.goto(base + '/', wait_until='networkidle'); pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(SHOTS, 'home-390x664.png'))
    m = pg.evaluate("""() => {
      const bar = document.querySelector('.bottom-bar').getBoundingClientRect();
      const vis = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, ok: r.bottom <= bar.top && r.top >= 0 && r.height > 0 }; };
      const frame = document.querySelector('.door__frame').getBoundingClientRect();
      const crownTop = frame.top + frame.height * 0.02;
      return { barTop: bar.top, h1: vis(document.querySelector('h1')), heroBook: vis(document.querySelector('.door [data-open="book"]')),
               barBook: vis(document.querySelector('.bottom-bar [data-open="book"]')), rating: vis(document.querySelector('.hero__rating')),
               crownVisible: Math.round(bar.top - crownTop), barPos: getComputedStyle(document.querySelector('.bottom-bar')).position };
    }""")
    results['info']['mobile_first_screen'] = m
    check('mobile 390x664: H1 above the bar', m['h1'] and m['h1']['ok'], m['h1'])
    check('mobile 390x664: Book visible (bar, filled) and hero outline Book above the bar', m['barBook'] and m['heroBook'] and m['heroBook']['ok'], m['heroBook'])
    check('mobile 390x664: rating line above the bar', m['rating'] and m['rating']['ok'], m['rating'])
    check('mobile 390x664: >= 120px of arch crown above the bar', m['crownVisible'] >= 120, f"{m['crownVisible']}px")
    check('mobile bar is fixed from first paint', m['barPos'] == 'fixed', m['barPos'])
    ctx.close()
    # under 500px tall: the bar un-sticks
    ctx, pg = new_page(browser, base, 844, 390)
    pg.goto(base + '/', wait_until='networkidle')
    pos = pg.evaluate("getComputedStyle(document.querySelector('.bottom-bar')).position")
    check('bar un-sticks below 500px tall', pos == 'static', pos)
    ctx.close()

def static_modes(browser, base):
    for label, kw, size in (('reduced motion', {'reduced': True}, (1440, 900)), ('Pause motion', {'paused': True}, (1440, 900)),
                            ('reduced motion mobile', {'reduced': True}, (390, 664)), ('< 500px tall', {}, (1440, 480))):
        ctx, pg = new_page(browser, base, size[0], size[1], **kw)
        pg.goto(base + '/', wait_until='networkidle'); pg.wait_for_timeout(200)
        s = pg.evaluate("""() => {
          const st = document.querySelector('.door__stage'), fr = document.querySelector('.door__frame'), intro = document.querySelector('.door__intro');
          return { framePos: getComputedStyle(fr).position, stageH: st.offsetHeight, vh: innerHeight,
                   anim: getComputedStyle(document.querySelector('.door__picture')).animationName, introAnim: getComputedStyle(intro).animationName,
                   motionAttr: document.documentElement.getAttribute('data-motion') };
        }""")
        pg.evaluate('window.scrollTo(0, 300)'); pg.wait_for_timeout(200)
        vis = pg.evaluate("getComputedStyle(document.querySelector('.door__intro')).visibility")
        ok = s['framePos'] != 'sticky' and s['anim'] == 'none' and s['introAnim'] == 'none' and s['stageH'] <= max(s['vh'], 560) + 2 and vis == 'visible'
        check(f'static mode ({label}): no sticky/animation, no dead scroll, H1 visible', ok, s)
        if label == 'reduced motion':
            pg.evaluate('window.scrollTo(0, 0)'); pg.wait_for_timeout(100)
            pg.screenshot(path=os.path.join(SHOTS, 'home-1440x900-reduced-motion.png'))
        ctx.close()

def run_axe(browser, base):
    src = open(AXE).read()
    total = {}
    for (w, h, tag) in ((1440, 900, 'desktop'), (390, 664, 'mobile')):
        ctx, pg = new_page(browser, base, w, h, reduced=True)
        for path in PAGES:
            pg.goto(base + path, wait_until='networkidle')
            pg.add_script_tag(content=src)
            res = pg.evaluate("""async () => { const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa','best-practice'] } });
              return r.violations.map(v => ({ id: v.id, impact: v.impact, n: v.nodes.length, target: v.nodes.slice(0,3).map(n => n.target.join(' ')) })); }""")
            serious = [v for v in res if v['impact'] in ('serious', 'critical')]
            total[f'{tag} {path}'] = res
            if serious: print('   axe', tag, path, serious)
        ctx.close()
    results['info']['axe'] = total
    bad = {k: [v for v in vs if v['impact'] in ('serious', 'critical')] for k, vs in total.items()}
    bad = {k: v for k, v in bad.items() if v}
    check(f'axe: 0 serious/critical on Home + {len(PAGES)-1} stubs (desktop + mobile)', not bad, bad or '')
    minor = sorted({v['id'] for vs in total.values() for v in vs})
    results['info']['axe_minor_rules'] = minor

def keyboard(browser, base):
    ctx, pg = new_page(browser, base, 1440, 900)
    pg.goto(base + '/', wait_until='networkidle')
    # Skip link is the first tab stop
    pg.keyboard.press('Tab')
    first = pg.evaluate("document.activeElement.className")
    check('keyboard: skip link is the first tab stop', 'skip-link' in first, first)
    # Header disclosure
    pg.focus('button[aria-controls="nav-treatments"]'); pg.keyboard.press('Enter'); pg.wait_for_timeout(100)
    exp = pg.get_attribute('button[aria-controls="nav-treatments"]', 'aria-expanded')
    shown = pg.is_visible('#nav-treatments')
    pg.keyboard.press('Tab')
    inpanel = pg.evaluate("!!document.activeElement.closest('#nav-treatments')")
    pg.keyboard.press('Escape'); pg.wait_for_timeout(100)
    back = pg.evaluate("document.activeElement.getAttribute('aria-controls')")
    closed = pg.get_attribute('button[aria-controls="nav-treatments"]', 'aria-expanded')
    check('keyboard: Treatments disclosure opens on Enter, Tab enters it, Esc closes + returns focus', exp == 'true' and shown and inpanel and back == 'nav-treatments' and closed == 'false', (exp, shown, inpanel, back, closed))
    pg.focus('button[aria-controls="nav-offers"]'); pg.keyboard.press('Space'); pg.wait_for_timeout(100)
    check('keyboard: Offers disclosure opens on Space with aria-expanded', pg.get_attribute('button[aria-controls="nav-offers"]', 'aria-expanded') == 'true' and pg.is_visible('#nav-offers'))
    pg.keyboard.press('Escape')
    # Book sheet
    pg.evaluate("try{localStorage.removeItem('ush-spa')}catch(e){}")
    pg.focus('.site-header [data-open="book"]'); pg.keyboard.press('Enter'); pg.wait_for_timeout(400)
    st = pg.evaluate("({ open: document.getElementById('book-sheet').open, focus: document.activeElement.id })")
    pg.keyboard.press('Tab'); pg.keyboard.press('Tab')
    onradio = pg.evaluate("document.activeElement.name")
    pg.keyboard.press('ArrowDown'); pg.wait_for_timeout(150)
    chosen = pg.evaluate("({ v: document.querySelector('input[name=book-spa]:checked')?.value, rows: !document.querySelector('[data-sheet-rows=DM]').hidden })")
    labels = pg.evaluate("[...document.querySelectorAll('[data-sheet-rows=DM] li:not([hidden]) a')].map(a => a.textContent.replace(/\\s+/g,' ').trim())")
    inside = True
    for _ in range(14):
        pg.keyboard.press('Tab')
        inside = inside and pg.evaluate("!!document.activeElement.closest('#book-sheet')")
    pg.keyboard.press('Escape'); pg.wait_for_timeout(250)
    after = pg.evaluate("({ open: document.getElementById('book-sheet').open, focus: document.activeElement.matches('.site-header [data-open=book]') })")
    check('keyboard: Book sheet opens as a modal with focus on its heading', st['open'] and st['focus'] == 'book-title', st)
    check('keyboard: spa choice is a radio group (arrow keys choose, rows appear)', onradio == 'book-spa' and chosen['v'] == 'DM' and chosen['rows'], (onradio, chosen))
    check('keyboard: focus stays inside the sheet while open', inside)
    check('keyboard: Esc closes the sheet and focus returns to Book', (not after['open']) and after['focus'], after)
    results['info']['sheet_rows_DM'] = labels
    sd_only = [l for l in labels if 'Couples' in l or 'Hot stone' in l]
    check('Book sheet: no San Diego-only item in the Del Mar rows', not sd_only, sd_only)
    check('Book sheet: rows read in full ("…, 60 minutes, $150, Del Mar")', any('60 minutes, $150, Del Mar' in l for l in labels), labels[:2])
    # Remembered spa → "Booking at Del Mar · Change"
    pg.focus('.site-header [data-open="book"]'); pg.keyboard.press('Enter'); pg.wait_for_timeout(300)
    rem = pg.evaluate("({ chosen: !document.querySelector('[data-sheet-chosen]').hidden, name: document.querySelector('[data-sheet-spa-name]').textContent, change: document.querySelector('[data-sheet-change]').tagName })")
    check('Book sheet: remembered spa shown as "Booking at … · Change" (a button)', rem['chosen'] and rem['name'] == 'Del Mar' and rem['change'] == 'BUTTON', rem)
    pg.keyboard.press('Escape')
    # Service chips: price announced via aria-live
    pg.evaluate("document.querySelector('.katy').scrollIntoView()")
    pg.click('.katy .chip:nth-child(2)'); pg.wait_for_timeout(100)
    live = pg.evaluate("document.querySelector('.katy [aria-live] [data-svc-spoken]').textContent")
    check('service chips: changing length updates the aria-live price', '90 minutes, $225' in live, live)
    ctx.close()
    # Mobile menu
    ctx, pg = new_page(browser, base, 390, 664)
    pg.goto(base + '/', wait_until='networkidle')
    pg.focus('.menu-btn'); pg.keyboard.press('Enter'); pg.wait_for_timeout(350)
    o = pg.evaluate("({ open: document.getElementById('mobile-menu').open, offersExpanded: [...document.querySelectorAll('#mobile-menu a')].some(a => a.textContent.trim() === 'This month') })")
    pg.screenshot(path=os.path.join(SHOTS, 'menu-390x664.png'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(250)
    f = pg.evaluate("document.activeElement.classList.contains('menu-btn')")
    check('keyboard: mobile menu opens as a dialog with Offers expanded; Esc returns focus to Menu', o['open'] and o['offersExpanded'] and f, (o, f))
    # Book sheet on mobile
    pg.click('.bottom-bar [data-open="book"]'); pg.wait_for_timeout(400)
    pg.screenshot(path=os.path.join(SHOTS, 'book-sheet-390x664.png'))
    pg.keyboard.press('Escape')
    # Uni never auto-opens; opens from the bar as a modal
    auto = pg.evaluate("!!window.UniChat")
    pg.click('.bottom-bar [data-open="uni"]'); pg.wait_for_timeout(700)
    u = pg.evaluate("({ open: window.UniChat?.isOpen(), modal: document.querySelector('.usc-panel')?.getAttribute('aria-modal'), inert: document.querySelector('main').hasAttribute('inert') })")
    pg.screenshot(path=os.path.join(SHOTS, 'uni-390x664.png'))
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    back = pg.evaluate("document.activeElement.matches('.bottom-bar [data-open=uni]')")
    check('Uni: not loaded until asked; opens as a true modal (aria-modal, inert background); Esc returns focus', (not auto) and u['open'] and u['modal'] == 'true' and u['inert'] and back, (auto, u, back))
    ctx.close()

def uni_dock_and_speak(browser, base):
    """Owner request, 14 Nov 2026. Desktop: Uni shows itself 3 s after the page loads, docked bottom right, not modal,
    without taking focus; closing it is remembered for the visit. Phones: never auto-opens; the chat has a
    "Speak your question…" box under the text box, with the recording and microphone notice in the line below it."""
    ctx, pg = new_page(browser, base, 1440, 900)
    pg.goto(base + '/', wait_until='networkidle'); pg.wait_for_timeout(1200)
    early = pg.evaluate("!!(window.UniChat && window.UniChat.isOpen())")
    try:
        pg.wait_for_function("window.UniChat && window.UniChat.isOpen()", timeout=6000); shown = True
    except Exception:
        shown = False
    pg.wait_for_timeout(100)
    d = pg.evaluate("""() => { const p = document.querySelector('.usc-panel'); const r = document.querySelector('.usc-root');
      return { docked: !!window.UniChat?.isDocked?.(), modal: p?.getAttribute('aria-modal'), inert: document.querySelector('main').hasAttribute('inert'),
        focusIn: !!document.activeElement.closest('.usc-panel'), scrim: getComputedStyle(document.querySelector('.usc-scrim')).display,
        anim: getComputedStyle(p).animationName, lock: document.documentElement.classList.contains('usc-lock'),
        ov: document.documentElement.scrollWidth - document.documentElement.clientWidth }; }""")
    pg.wait_for_timeout(1100)
    pg.screenshot(path=os.path.join(SHOTS, 'uni-dock-1440x900.png'))
    check('Uni desktop: not shown at 1 s, slides in by itself after 3 s', (not early) and shown and d['anim'] == 'usc-slide-in', (early, shown, d))
    check('Uni desktop: docked, not modal (no scrim, page not inert, focus not moved, no sideways scroll)',
          d['docked'] and d['modal'] == 'false' and not d['inert'] and not d['focusIn'] and d['scrim'] == 'none' and not d['lock'] and d['ov'] <= 0, d)
    pg.click('.usc-close'); pg.wait_for_timeout(200)
    pg.reload(wait_until='networkidle'); pg.wait_for_timeout(4200)
    again = pg.evaluate("!!(window.UniChat && window.UniChat.isOpen())")
    check('Uni desktop: once closed, it does not show itself again in the same visit', not again, again)
    pg.click('.site-header [data-open="uni"]'); pg.wait_for_timeout(700)
    a = pg.evaluate("({ docked: !!window.UniChat?.isDocked?.(), focusIn: !!document.activeElement.closest('.usc-panel'), inert: document.querySelector('main').hasAttribute('inert') })")
    check('Uni desktop: Ask Uni opens it docked and moves focus into it', a['docked'] and a['focusIn'] and not a['inert'], a)
    ctx.close()
    # Reduced motion: it appears without the slide
    ctx, pg = new_page(browser, base, 1440, 900, reduced=True)
    pg.goto(base + '/', wait_until='networkidle')
    try:
        pg.wait_for_function("window.UniChat && window.UniChat.isOpen()", timeout=7000); shown = True
    except Exception:
        shown = False
    anim = pg.evaluate("getComputedStyle(document.querySelector('.usc-panel') || document.body).animationName")
    check('Uni desktop, reduced motion: shown without the slide animation', shown and anim == 'none', (shown, anim))
    ctx.close()
    # Phone
    ctx, pg = new_page(browser, base, 390, 664)
    pg.goto(base + '/', wait_until='networkidle'); pg.wait_for_timeout(4200)
    auto = pg.evaluate("!!window.UniChat")
    pg.click('.bottom-bar [data-open="uni"]'); pg.wait_for_selector('.usc-start'); pg.click('.usc-start'); pg.wait_for_timeout(300)
    m = pg.evaluate("""() => { const b = document.querySelector('.usc-speak'); const r = b ? b.getBoundingClientRect() : null;
      const f = document.querySelector('.usc-form').getBoundingClientRect();
      return { speak: !!b && !document.querySelector('.usc-speakrow').hidden, h: r ? r.height : 0, below: r ? r.top >= f.bottom - 1 : false,
        text: b ? b.textContent.trim() : '', foot: document.querySelector('.usc-foot').textContent,
        modal: document.querySelector('.usc-panel').getAttribute('aria-modal'), ov: document.documentElement.scrollWidth - document.documentElement.clientWidth }; }""")
    pg.screenshot(path=os.path.join(SHOTS, 'uni-speak-390x664.png'))
    check('Uni phone: never opens by itself (not even loaded after 4 s); still a true modal', (not auto) and m['modal'] == 'true', (auto, m['modal']))
    check('Uni phone: "Speak your question…" box sits under the text box, 44 px or taller', m['speak'] and m['below'] and m['h'] >= 44 and m['text'].startswith('Speak your question'), m)
    check('Uni: the line under the boxes carries the AI, recording and microphone notices', all(t in m['foot'] for t in ('AI assistant', 'Voice calls are recorded and transcribed', 'microphone', 'Privacy page')), m['foot'])
    ctx.close()

def desktop_shots(browser, base):
    ctx, pg = new_page(browser, base, 1440, 900)
    pg.goto(base + '/', wait_until='networkidle'); pg.wait_for_timeout(300)
    pg.screenshot(path=os.path.join(SHOTS, 'home-1440x900.png'))
    pg.focus('.site-header [data-open="book"]'); pg.keyboard.press('Enter'); pg.wait_for_timeout(400)
    pg.click('label.spa-opt:has(input[value="SD"])'); pg.wait_for_timeout(200)
    pg.screenshot(path=os.path.join(SHOTS, 'book-sheet-1440x900.png'))
    ctx.close()
    # Full-page captures in static mode (reduced motion) so the sticky hero doesn't distort them
    for (w, h) in ((1440, 900), (390, 664)):
        ctx, pg = new_page(browser, base, w, h, reduced=True)
        pg.goto(base + '/', wait_until='networkidle'); pg.wait_for_timeout(300)
        # walk the page so lazy images load before the full-page capture
        H = pg.evaluate('document.documentElement.scrollHeight')
        for y in range(0, H, h // 2):
            pg.evaluate(f'window.scrollTo(0,{y})'); pg.wait_for_timeout(60)
        pg.evaluate('window.scrollTo(0,0)'); pg.wait_for_load_state('networkidle'); pg.wait_for_timeout(300)
        pg.screenshot(path=os.path.join(SHOTS, f'home-{w}-full-static.png'), full_page=True)
        ctx.close()


SPACING_CSS = "* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p, li, dd { margin-bottom: 2em !important; }"

def qa_followups(browser, base):
    """Checks added for the QA report (M1, M4, M5, m-10, m-18)."""
    # m-10: Book controls are real links to /menu/ and work without JavaScript
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, java_script_enabled=False)
    pg = ctx.new_page(); guard(pg, base)
    pg.goto(base + '/', wait_until='load')
    hrefs = pg.evaluate("[...document.querySelectorAll('[data-open=book]')].map(e => e.tagName + ' ' + (e.getAttribute('href') || ''))")
    pg.click('.site-header [data-open="book"]'); pg.wait_for_load_state('load')
    check('no-JS: every Book opener is a link to /menu/ and works', all(h.startswith('A /menu/') for h in hrefs) and pg.url.endswith('/menu/'), (hrefs[:3], pg.url))
    ctx.close()
    # M4: the hero photo is never shown larger than its source (CSS px), at rest and fully open
    for (w, h) in ((1440, 900), (1920, 1080), (1280, 800), (390, 664), (820, 1180)):
        ctx, pg = new_page(browser, base, w, h)
        pg.goto(base + '/', wait_until='networkidle'); pg.wait_for_timeout(200)
        scales = []
        for p in (0, 1.0):
            y = pg.evaluate(HERO_JS, p); pg.evaluate(f'window.scrollTo(0,{y})'); pg.wait_for_timeout(250)
            # cover scale against the REAL pixel width of the chosen srcset candidate (naturalWidth is density-corrected)
            scales.append(pg.evaluate("""() => { const i = document.querySelector('.door__img'); const r = i.getBoundingClientRect();
              const pic = i.closest('picture'); const file = i.currentSrc.split('/').pop();
              let W = 0;
              for (const s of pic.querySelectorAll('source')) for (const c of s.srcset.split(',')) {
                const [u, d] = c.trim().split(/\\s+/); if (u.split('/').pop() === file) W = parseInt(d); }
              if (!W) W = i.naturalWidth;
              const H = W * i.naturalHeight / i.naturalWidth;
              return +Math.max(r.width / W, r.height / H).toFixed(3); }"""))
        check(f'hero {w}x{h}: photo never upscaled (rest, open)', max(scales) <= 1.001, scales)
        if (w, h) == (820, 1180):
            st = pg.evaluate("""() => { const i = document.querySelector('.door__intro').getBoundingClientRect(), s = document.querySelector('.door__stage').getBoundingClientRect();
              return { introBottom: Math.round(i.bottom + scrollY), stageTop: Math.round(s.top + scrollY) }; }""")
            check('hero 820x1180 portrait: H1 block stacks above the arch (QA M5)', st['introBottom'] <= st['stageTop'] + 1, st)
            pg.evaluate('window.scrollTo(0,0)'); pg.wait_for_timeout(200)
            pg.screenshot(path=os.path.join(SHOTS, 'home-820x1180.png'))
        if (w, h) == (1440, 900):
            pg.screenshot(path=os.path.join(SHOTS, 'hero-1440-open.png'))
        ctx.close()
    # M1: no horizontal scroll at 320px, nor at 390px with WCAG 1.4.12 text spacing
    for (w, h, spacing) in ((320, 600, False), (390, 900, True)):
        ctx, pg = new_page(browser, base, w, h, reduced=True)
        over = {}
        for path in PAGES:
            pg.goto(base + path, wait_until='networkidle')
            if spacing: pg.add_style_tag(content=SPACING_CSS); pg.wait_for_timeout(100)
            d = pg.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')
            if d > 0: over[path] = d
        check(f'reflow {w}px{" + text spacing" if spacing else ""}: no horizontal scroll on any page', not over, over)
        ctx.close()
    # m-18: Book, Call, Text and Uni are on the first screen of the mobile menu
    ctx, pg = new_page(browser, base, 390, 664)
    pg.goto(base + '/', wait_until='networkidle')
    pg.click('.menu-btn'); pg.wait_for_timeout(350)
    vis = pg.evaluate("""() => [...document.querySelectorAll('#mobile-menu .mm__actions a, #mobile-menu .mm__actions button')].map(e => e.getBoundingClientRect().bottom <= innerHeight)""")
    check('mobile menu: Book, Call, Text us and Ask Uni on the first screen (QA m-18)', len(vis) >= 4 and all(vis), vis)
    ctx.close()

def budgets():
    js = [f for f in glob.glob(os.path.join(DIST, '_astro', '*.js'))] + [os.path.join(DIST, 'chat', 'spa-chat.js')]
    total = sum(os.path.getsize(f) for f in js)
    check('JS <= 100 KB (excl. on-demand voice SDK)', total <= 100 * 1024, f'{total/1024:.1f} KB in {len(js)} files')
    imgs = [f for f in glob.glob(os.path.join(DIST, '_astro', '*')) if f.split('.')[-1] in ('avif', 'webp', 'jpg', 'jpeg', 'png')]
    big = [(os.path.basename(f), os.path.getsize(f) // 1024) for f in imgs if os.path.getsize(f) > 200 * 1024]
    check('every image <= 200 KB', not big, big or f'{len(imgs)} images, max {max(os.path.getsize(f) for f in imgs)//1024} KB')

def main():
    srv, base = serve()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        desktop_shots(browser, base)
        for (w, h) in ((1440, 900), (1280, 800), (1920, 1080)):
            hero_frames(browser, base, w, h, f'{w}')
        mobile_first_screen(browser, base)
        static_modes(browser, base)
        keyboard(browser, base)
        uni_dock_and_speak(browser, base)
        qa_followups(browser, base)
        run_axe(browser, base)
        browser.close()
    srv.shutdown()
    budgets()
    with open(os.path.join(SHOTS, 'test-report.json'), 'w') as f:
        json.dump(results, f, indent=2)
    print(f"\n{len(results['pass'])} passed, {len(results['fail'])} failed")
    sys.exit(1 if results['fail'] else 0)

if __name__ == '__main__':
    main()
