/**
 * site.ts — the client script (bundled once by Astro with motion.ts; survives ClientRouter navigations).
 * Everything uses event delegation on `document`, so it keeps working after each page swap.
 *
 *  - Pause motion (localStorage, try/catch) → html[data-motion="paused"]
 *  - Disclosures: [data-disclosure] buttons (aria-expanded) inside [data-disclosure-root]
 *  - Dialogs: Book sheet (#book-sheet), mobile menu (#mobile-menu) — focus in, Esc, focus returns
 *  - Uni: [data-open="uni"] lazy-loads /chat/spa-chat.js once and opens it. Phones and tablets: never auto-opens.
 *    Desktop (owner request, 14 Nov 2026): 3 s after the first page load Uni slides in bottom right, docked, not modal.
 *  - Service chips: price/minutes/links swap; price announced through the card's aria-live region
 *  - Date gates: [data-ends] / [data-starts] / [data-hide-after] (Los Angeles dates)
 *  - Bottom bar: Gift ⇄ Call windows, after-hours Call menu
 *  - Analytics: window.track(event, props) → first-party /api/event counter (src/lib/event-schema.mjs allowlist).
 *    A no-op unless PUBLIC_EVENTS_ENDPOINT was set at build time, and always a no-op under Do Not Track / GPC.
 *  - Motion (reveals, word-split headings, door outlines, ticker, parallax fallback): ./motion.ts
 */
import { swapPulse } from './motion';
import { EVENTS_ENDPOINT } from '../lib/analytics';
import { sanitizeEvent, cleanRef, cleanUtm, browserOptedOut } from '../lib/event-schema.mjs';

type Props = Record<string, unknown>;
declare global {
  interface Window {
    track: (event: string, props?: Props) => void;
    UniChat?: { open: (opener?: HTMLElement | null) => void; dock?: () => boolean; close: () => void; isOpen: () => boolean; isDocked?: () => boolean; inCall: () => boolean; refreshInert: () => void };
    __uscLoaded?: boolean;
  }
}

/* ---------------- analytics (booking-intent events) ---------------- */
// Off unless PUBLIC_EVENTS_ENDPOINT is set at build time, and off under Do Not Track / Global Privacy Control.
// Each event is cleaned by sanitizeEvent (allowlisted names and slugs only) before it leaves the page, and again
// on the server. The visit's source (referring host + utm_source/medium/campaign) is kept for this tab only
// (sessionStorage), so a booking click can be tied to the campaign that brought the visit. No cookies, no ids.
const TRACK_ON = !!EVENTS_ENDPOINT && !browserOptedOut(navigator, window as unknown as Record<string, unknown>);
const SRC_KEY = 'ush-src';
type Src = { ref?: string; utm?: Record<string, string> };
let visitSrc: Src = {};
function captureSource() {
  if (!TRACK_ON) return;
  try { const kept = sessionStorage.getItem(SRC_KEY); if (kept) { visitSrc = JSON.parse(kept) || {}; return; } } catch { /* private mode */ }
  const utm = cleanUtm(location.search);
  const ref = cleanRef(document.referrer, location.hostname);
  visitSrc = { ...(ref ? { ref } : {}), ...(Object.keys(utm).length ? { utm } : {}) };
  try { sessionStorage.setItem(SRC_KEY, JSON.stringify(visitSrc)); } catch { /* private mode */ }
}
function pagePath(): string {
  // The canonical path is built from the site's own routes, so a mistyped or crafted URL can't leak into a count.
  const c = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  try { return c ? new URL(c.href).pathname : location.pathname; } catch { return location.pathname; }
}
function send(event: string, props?: Props) {
  if (!TRACK_ON) return;
  const ev = sanitizeEvent({ e: event, p: props, path: pagePath(), ref: visitSrc.ref, utm: visitSrc.utm }, location.hostname);
  if (!ev) return;
  const body = JSON.stringify(ev);
  try {
    if (navigator.sendBeacon && navigator.sendBeacon(EVENTS_ENDPOINT, new Blob([body], { type: 'application/json' }))) return;
  } catch { /* fall through */ }
  try { fetch(EVENTS_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true, credentials: 'omit' }).catch(() => {}); } catch { /* never break the page */ }
}
window.track = window.track || send;
captureSource();

// Links built at run time (Uni's link cards and chat replies) may lack data-track: infer the event from the href.
const SQUARE_SPA: Record<string, string> = { LWTMBRFFB1D7G: 'SD', LXYVNKXTR50S3: 'DM' };
function inferTrack(a: HTMLAnchorElement): { event: string; props: Props } | null {
  const href = a.getAttribute('href') || '';
  const placement = a.closest('#uni') ? 'chat' : 'page';
  if (href.startsWith('tel:')) return { event: 'call_click', props: { placement } };
  if (href.startsWith('sms:')) return { event: 'text_click', props: { placement } };
  if (/^https:\/\/app\.squareup\.com\/gift\//.test(href)) return { event: 'gift_card_click', props: { placement } };
  const m = href.match(/^https:\/\/book\.squareup\.com\/appointments\/[^/]+\/location\/([A-Z0-9]+)\//);
  if (m) return { event: 'book_click', props: { spa: SQUARE_SPA[m[1]], placement } };
  return null;
}

/* ---------------- storage (never throws) ---------------- */
const store = {
  get(k: string): string | null { try { return window.localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string | null) { try { v == null ? window.localStorage.removeItem(k) : window.localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const SPA_KEY = 'ush-spa';
const MOTION_KEY = 'ush-motion';

/* ---------------- dates (America/Los_Angeles) ---------------- */
function todayLA(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function minutesNowLA(): number {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
  const h = Number(p.find((x) => x.type === 'hour')?.value ?? 0), m = Number(p.find((x) => x.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

/* ---------------- Pause motion ---------------- */
function motionPaused(): boolean { return store.get(MOTION_KEY) === 'paused'; }
function applyMotion(root: HTMLElement = document.documentElement) {
  if (motionPaused()) root.setAttribute('data-motion', 'paused'); else root.removeAttribute('data-motion');
}
function syncMotionToggles() {
  const on = motionPaused();
  document.querySelectorAll<HTMLButtonElement>('[data-motion-toggle]').forEach((b) => b.setAttribute('aria-pressed', String(on)));
}

/* ---------------- disclosures ---------------- */
function closeDisclosure(btn: HTMLElement, focus = false) {
  const panel = document.getElementById(btn.getAttribute('aria-controls') || '');
  btn.setAttribute('aria-expanded', 'false');
  if (panel) panel.hidden = true;
  if (focus) btn.focus();
}
function closeAllDisclosures(except?: Element | null) {
  document.querySelectorAll<HTMLElement>('[data-disclosure][aria-expanded="true"]').forEach((b) => { if (b !== except) closeDisclosure(b); });
}
function toggleDisclosure(btn: HTMLElement) {
  const open = btn.getAttribute('aria-expanded') === 'true';
  closeAllDisclosures(btn);
  const panel = document.getElementById(btn.getAttribute('aria-controls') || '');
  btn.setAttribute('aria-expanded', String(!open));
  if (panel) panel.hidden = open;
}

/* ---------------- dialogs ---------------- */
const openers = new WeakMap<HTMLDialogElement, HTMLElement | null>();
function openDialog(d: HTMLDialogElement, opener: HTMLElement | null, focusEl?: HTMLElement | null) {
  if (d.open) return;
  closeAllDisclosures();
  openers.set(d, opener);
  d.showModal();
  (focusEl || d.querySelector<HTMLElement>('[tabindex="-1"], h2, button'))?.focus();
}
function closeDialog(d: HTMLDialogElement) { if (d.open) d.close(); }
function onDialogClose(e: Event) {
  const d = e.target as HTMLDialogElement;
  const opener = openers.get(d);
  if (opener && opener.isConnected) opener.focus();
}

/* ---------------- Book sheet ---------------- */
function sheet(): HTMLDialogElement | null { return document.getElementById('book-sheet') as HTMLDialogElement | null; }
function setSheetSpa(sp: string | null, opts: { collapse: boolean }) {
  const d = sheet(); if (!d) return;
  const fs = d.querySelector<HTMLElement>('[data-sheet-spa]');
  const chosen = d.querySelector<HTMLElement>('[data-sheet-chosen]');
  d.querySelectorAll<HTMLElement>('[data-sheet-rows]').forEach((r) => { r.hidden = r.dataset.sheetRows !== sp; });
  d.querySelectorAll<HTMLInputElement>('input[name="book-spa"]').forEach((i) => { i.checked = i.value === sp; });
  const name = d.querySelector<HTMLInputElement>(`input[name="book-spa"][value="${sp}"]`)?.dataset.spaName || '';
  const nameEl = d.querySelector<HTMLElement>('[data-sheet-spa-name]'); if (nameEl) nameEl.textContent = name;
  if (fs) fs.hidden = !!(sp && opts.collapse);
  if (chosen) chosen.hidden = !(sp && opts.collapse);
}
function openSheet(opener: HTMLElement | null) {
  const d = sheet(); if (!d) return;
  const sp = store.get(SPA_KEY);
  const valid = sp === 'SD' || sp === 'DM' ? sp : null;
  setSheetSpa(valid, { collapse: !!valid });
  openDialog(d, opener, d.querySelector<HTMLElement>('#book-title'));
}

/* ---------------- Uni (text chat + voice), loaded on demand ---------------- */
let uniLoading: Promise<void> | null = null;
function loadUni(): Promise<void> {
  if (window.UniChat) return Promise.resolve();
  if (uniLoading) return uniLoading;
  uniLoading = new Promise<void>((resolve, reject) => {
    if (!document.querySelector('link[data-uni-css]')) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/chat/spa-chat.css'; l.setAttribute('data-uni-css', '');
      document.head.appendChild(l);
    }
    const s = document.createElement('script'); s.src = '/chat/spa-chat.js'; s.async = true;
    s.onload = () => (window.UniChat ? resolve() : reject(new Error('uni')));
    s.onerror = () => { uniLoading = null; reject(new Error('uni')); };
    document.head.appendChild(s);
  });
  return uniLoading;
}
function openUni(opener: HTMLElement | null) {
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(closeDialog);
  window.track('chat_open', { placement: opener?.closest('[data-bar]') ? 'bar' : opener?.closest('.site-header') ? 'header' : 'page' });
  loadUni().then(() => window.UniChat?.open(opener)).catch(() => {
    alert('Uni is unavailable right now. Please call (858) 293-8900 or text us.');
  });
}

/* Desktop only: Uni shows itself once, 3 s after the first page load, docked bottom right (not modal, no focus move).
   It then stays on display across pages (the #uni node persists). Closing it is remembered for the visit (sessionStorage,
   in spa-chat.js). Phones and tablets never auto-open: there the chat is a full-screen modal. Not counted as chat_open. */
const UNI_DOCK_QUERY = '(min-width: 961px)';
const UNI_DOCK_DELAY = 3000;
function scheduleUniDock() {
  try {
    if (!window.matchMedia(UNI_DOCK_QUERY).matches) return;
    if (sessionStorage.getItem('usc-dock-closed-v1') === '1') return;
  } catch { return; }
  window.setTimeout(() => {
    if (window.UniChat?.isOpen() || window.UniChat?.inCall()) return;
    loadUni().then(() => window.UniChat?.dock?.()).catch(() => { /* Uni unavailable: nothing to show */ });
  }, UNI_DOCK_DELAY);
}

/* ---------------- service chips ---------------- */
interface Opt { price: string; num: string; suffix: string; min: string; spoken: string; links: Record<string, string>; locs: string[] }
function onChip(input: HTMLInputElement) {
  const card = input.closest<HTMLElement>('[data-svc]'); if (!card) return;
  let opts: Opt[] = [];
  try { opts = JSON.parse(card.dataset.options || '[]'); } catch { return; }
  const o = opts[Number(input.value)]; if (!o) return;
  const set = (sel: string, text: string) => card.querySelectorAll<HTMLElement>(sel).forEach((el) => { el.textContent = text; });
  set('[data-svc-price]', o.price);
  set('[data-svc-num]', o.num);
  set('[data-svc-suffix]', o.suffix.trim());
  set('[data-svc-min]', o.min);
  set('[data-svc-sr-len]', o.spoken);
  set('[data-svc-spoken]', `${o.spoken}, ${o.price}`);   // aria-live region announces this
  swapPulse(card.querySelectorAll('[data-svc-num], [data-svc-price]'));
  card.querySelectorAll<HTMLAnchorElement>('[data-book]').forEach((a) => {
    const href = o.links[a.dataset.book || ''];
    a.hidden = !href; if (href) a.href = href;
  });
  const single = o.locs.length === 1;
  card.querySelectorAll<HTMLElement>('[data-where]').forEach((c) => { c.hidden = single || !o.locs.includes(c.dataset.where || ''); });
  const only = card.querySelector<HTMLElement>('[data-where-only]');
  if (only) {
    only.hidden = !single;
    const n = only.querySelector('[data-where-only-name]');
    if (n && single) n.textContent = o.locs[0] === 'SD' ? 'San Diego' : 'Del Mar';
  }
}

/* ---------------- date gates ---------------- */
function applyDateGates(root: ParentNode = document) {
  const today = todayLA();
  root.querySelectorAll<HTMLElement>('[data-ends], [data-starts]').forEach((el) => {
    const ends = el.dataset.ends, starts = el.dataset.starts;
    const expired = !!ends && today > ends;
    const early = !!starts && today < starts;
    if (expired || early) {
      el.hidden = true;
      const key = el.dataset.sheetRow;
      if (key) root.querySelectorAll<HTMLElement>(`[data-fallback-for="${key}"]`).forEach((f) => { f.hidden = false; });
    } else if (el.hasAttribute('data-reveal-on-start')) {
      el.hidden = false;
    }
  });
  root.querySelectorAll<HTMLElement>('[data-hide-after]').forEach((el) => { if (today > (el.dataset.hideAfter || '')) el.hidden = true; });
  // Month labels (e.g. /specials) follow the current LA month even before the nightly rebuild.
  const month = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'America/Los_Angeles' }).format(new Date());
  root.querySelectorAll<HTMLElement>('[data-month]').forEach((el) => {
    const old = el.textContent || '';
    if (old && old !== month) {
      el.textContent = month;
      if (document.title.includes(old)) document.title = document.title.replace(old, month);
    }
  });
}

/* ---------------- bottom bar ---------------- */
function applyBar() {
  const bar = document.querySelector<HTMLElement>('[data-bar]'); if (!bar) return;
  const today = todayLA();
  let windows: Array<{ starts: string; ends: string }> = [];
  let hours: Record<string, { opens: string; closes: string } | null> = {};
  try { windows = JSON.parse(bar.dataset.giftWindows || '[]'); hours = JSON.parse(bar.dataset.hours || '{}'); } catch { /* keep defaults */ }
  const gift = windows.some((w) => w.starts <= today && today <= w.ends);
  const call = bar.querySelector<HTMLElement>('[data-bar-call]');
  const ah = bar.querySelector<HTMLElement>('[data-bar-afterhours]');
  const giftEl = bar.querySelector<HTMLElement>('[data-bar-gift]');
  if (giftEl) giftEl.hidden = !gift;
  // Call dials the chosen spa; only a spa with known hours gets the after-hours menu.
  const sp = store.get(SPA_KEY) || 'SD';
  const h = hours[sp];
  let closed = false;
  if (h) {
    const [oh, om] = h.opens.split(':').map(Number), [ch, cm] = h.closes.split(':').map(Number);
    const now = minutesNowLA();
    closed = now < oh * 60 + om || now >= ch * 60 + cm;
  }
  if (call) call.hidden = gift || closed;
  if (ah) ah.hidden = gift || !closed;
  // Other Call links that change wording after hours (e.g. the Book sheet footer): "Call and leave a message"
  document.querySelectorAll<HTMLElement>('[data-afterhours-label]').forEach((el) => {
    el.textContent = (closed ? el.dataset.afterhoursLabel : el.dataset.callLabel) || el.textContent;
  });
}

/* ---------------- page init (runs on first load and after every ClientRouter swap) ---------------- */
let firstLoad = true;
function initPage() {
  applyMotion();
  syncMotionToggles();
  applyDateGates();
  applyBar();
  // Offer views (once per element)
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => {
        if (e.isIntersecting) { window.track('offer_view', { offer: (e.target as HTMLElement).dataset.offerView }); io.unobserve(e.target); }
      });
    }, { threshold: 0.5 });
    document.querySelectorAll('[data-offer-view]:not([hidden])').forEach((el) => io.observe(el));
  }
  document.querySelectorAll<HTMLDialogElement>('dialog').forEach((d) => {
    if (!d.dataset.bound) { d.dataset.bound = '1'; d.addEventListener('close', onDialogClose); }
  });
  // After a client-side navigation, move focus to the new page's H1 (the router announces the title).
  if (!firstLoad) {
    const h1 = document.querySelector<HTMLElement>('main h1');
    if (h1 && !location.hash) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
  }
  firstLoad = false;
  if (window.UniChat?.isOpen()) window.UniChat.refreshInert();
}

/* ---------------- global listeners (bound once) ---------------- */

// Openers ([data-open="book|uni|menu"]) run in the CAPTURE phase, before ClientRouter's own click handler:
// a Book opener is a real link to /menu (works without JS), and preventDefault() here stops the router navigating.
document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const opener = t.closest<HTMLElement>('[data-open]');
  if (!opener) return;
  const me = e as MouseEvent;
  if (opener instanceof HTMLAnchorElement && (me.metaKey || me.ctrlKey || me.shiftKey || me.altKey || me.button !== 0)) return;
  {
    const what = opener.dataset.open;
    if (what === 'book') {
      e.preventDefault();
      const from = opener.closest('dialog') as HTMLDialogElement | null;
      if (from) closeDialog(from);
      // From inside the menu, focus returns to the Menu button afterwards
      openSheet(from ? document.querySelector<HTMLElement>('[data-open="menu"]') : opener);
    }
    else if (what === 'uni') { e.preventDefault(); openUni(opener); }
    else if (what === 'menu') { e.preventDefault(); const m = document.getElementById('mobile-menu') as HTMLDialogElement | null; if (m) openDialog(m, opener, m.querySelector<HTMLElement>('[data-close]')); }
  }
}, true);
document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;

  if (t.closest('[data-open]')) return;   // openers are handled in the capture-phase listener above

  const disc = t.closest<HTMLElement>('[data-disclosure]');
  if (disc) { toggleDisclosure(disc); return; }

  const closer = t.closest<HTMLElement>('[data-close]');
  if (closer) { const d = closer.closest('dialog'); if (d) closeDialog(d as HTMLDialogElement); return; }

  const change = t.closest<HTMLElement>('[data-sheet-change]');
  if (change) {
    setSheetSpa(store.get(SPA_KEY), { collapse: false });
    (sheet()?.querySelector<HTMLInputElement>('input[name="book-spa"]:checked') || sheet()?.querySelector<HTMLInputElement>('input[name="book-spa"]'))?.focus();
    return;
  }

  const mt = t.closest<HTMLElement>('[data-motion-toggle]');
  if (mt) {
    store.set(MOTION_KEY, motionPaused() ? null : 'paused');
    applyMotion(); syncMotionToggles();
    return;
  }

  // Light dismiss: a click on a modal dialog's backdrop closes it
  if (t instanceof HTMLDialogElement && t.open) {
    const r = t.getBoundingClientRect();
    const me = e as MouseEvent;
    if (me.clientX < r.left || me.clientX > r.right || me.clientY < r.top || me.clientY > r.bottom) closeDialog(t);
  }

  // Close open disclosures when clicking elsewhere
  if (!t.closest('[data-disclosure-root]')) closeAllDisclosures();

  // In-dialog links to on-site pages: close the dialog so the router can navigate cleanly
  const link = t.closest<HTMLAnchorElement>('dialog a[href^="/"]');
  if (link) { const d = link.closest('dialog') as HTMLDialogElement | null; if (d) closeDialog(d); }

  const tr = t.closest<HTMLElement>('[data-track]');
  if (tr) {
    let p: Props = {};
    try { p = JSON.parse(tr.dataset.trackProps || '{}'); } catch { /* ignore */ }
    window.track(tr.dataset.track || 'click', p);
  } else {
    const a = t.closest<HTMLAnchorElement>('a[href]');
    const inferred = a && inferTrack(a);
    if (inferred) window.track(inferred.event, inferred.props);
  }
});

// Track clicks on elements that also open things (handled above with early return)
document.addEventListener('click', (e) => {
  const tr = (e.target as HTMLElement).closest<HTMLElement>('[data-open][data-track]');
  if (!tr) return;
  let p: Props = {};
  try { p = JSON.parse(tr.dataset.trackProps || '{}'); } catch { /* ignore */ }
  if (tr.dataset.track !== 'chat_open') window.track(tr.dataset.track || 'click', p);
}, true);


document.addEventListener('change', (e) => {
  const t = e.target as HTMLInputElement;
  if (t.matches('input[name="book-spa"]')) {
    store.set(SPA_KEY, t.value);
    setSheetSpa(t.value, { collapse: false });
    applyBar();
    return;
  }
  if (t.matches('[data-svc] input[data-opt]')) onChip(t);
});

// Modal dialogs keep Tab inside themselves (wraps first ⇄ last) instead of escaping to the browser chrome.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const d = document.querySelector<HTMLDialogElement>('dialog[open]');
  if (!d) return;
  const all = [...d.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((el) => (el.checkVisibility ? el.checkVisibility() : el.offsetParent !== null));
  // A radio group is one tab stop: its checked radio, or its first radio when none is checked.
  const isRadio = (el: Element): el is HTMLInputElement => el instanceof HTMLInputElement && el.type === 'radio';
  const f = all.filter((el) => {
    if (!isRadio(el)) return true;
    const group = all.filter((o) => isRadio(o) && o.name === el.name) as HTMLInputElement[];
    const checked = group.find((o) => o.checked);
    return checked ? el === checked : el === group[0];
  });
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1], active = document.activeElement as HTMLElement | null;
  if (e.shiftKey && (active === first || !d.contains(active))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && (active === last || !d.contains(active))) { e.preventDefault(); first.focus(); }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const open = document.querySelector<HTMLElement>('[data-disclosure][aria-expanded="true"]');
  if (open) { closeDisclosure(open, true); e.stopPropagation(); }
});

document.addEventListener('focusout', (e) => {
  const root = (e.target as HTMLElement).closest('[data-disclosure-root]');
  const next = (e as FocusEvent).relatedTarget as Node | null;
  if (root && next && !root.contains(next)) {
    root.querySelectorAll<HTMLElement>('[data-disclosure][aria-expanded="true"]').forEach((b) => closeDisclosure(b));
  }
});

// While Uni is on a voice call, off-site links open in a new tab so the call survives (capture phase).
document.addEventListener('click', (e) => {
  if (!window.UniChat?.inCall()) return;
  const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if (a && a.origin !== location.origin && !a.target) a.target = '_blank';
}, true);

// ClientRouter hooks
document.addEventListener('astro:before-swap', (e) => {
  const ev = e as Event & { newDocument?: Document };
  if (ev.newDocument) applyMotion(ev.newDocument.documentElement);
  // Keep the voice SDK's <audio> inside the persisted #uni node, so the swap never pauses it (githubDesign Q2).
  const uni = document.getElementById('uni');
  if (uni) document.querySelectorAll('body > audio, body > video').forEach((el) => uni.append(el));
  document.querySelectorAll<HTMLDialogElement>('dialog[open]').forEach(closeDialog);
});
document.addEventListener('astro:page-load', initPage);
scheduleUniDock(); // once per full page load; client-side navigations keep the docked panel
window.addEventListener('pageshow', () => { applyDateGates(); applyBar(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) { applyDateGates(); applyBar(); } });

export {};
