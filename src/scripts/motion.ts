/**
 * Motion (client request, 24 Oct 2026). Pairs with src/styles/motion.css; the effect list is in shots/motion/EFFECTS.md.
 *
 * One IntersectionObserver path for every browser: Safari before 26 and Firefox have no scroll-driven animations,
 * so reveals are a class toggle (.is-in) and CSS transitions do the moving.
 * - Only elements that start BELOW the fold are armed ([data-rv="kind"] → hidden until they enter). Anything on
 *   the first screen is left alone, so nothing visible ever blinks, and the hero H1 is never touched.
 * - Nothing is armed when the visitor prefers reduced motion or has Pause motion on (CSS also ignores the
 *   hidden states then, so toggling Pause mid-page shows everything at once).
 * - Runs on first load and after every ClientRouter swap (astro:page-load); cleans up on astro:before-swap.
 */

const root = document.documentElement;
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
const NS = 'http://www.w3.org/2000/svg';
const SDA = typeof CSS !== 'undefined' && CSS.supports('animation-timeline: view()');

function motionOn(): boolean {
  return !reduced.matches && root.getAttribute('data-motion') !== 'paused' && root.hasAttribute('data-fx');
}

type Kind = 'section' | 'rise' | 'img' | 'words' | 'step' | 'door' | 'lotus' | 'gift';

// Order matters: an element takes the first kind it matches.
const GROUPS: Array<[Kind, string]> = [
  ['words', 'main h2, .pq--large blockquote p'],
  ['step', '.visit__steps > li, .b-steps > li'],
  ['door', 'main .door-card__arch'],
  ['gift', 'main .giftcard'],
  ['img', 'main .card__media, main figure, main .b-media'],
  ['lotus', '.footer__logo .lotus'],
  ['rise', [
    '.cards__list > li', '.offers__grid > *', '.b-cards > li', '.b-duo > *', '.b-ticks > li', '.b-rows > *',
    '.sp__list > *', '.faq__list > *', '.ct-spas__list > *', '.ct-faq__list > *', '.ab-how__list > *',
    '.ab-offer__list > *', '.ab-spas__list > *', '.gc-tiles > *', '.gc-steps > *', '.rw-steps > *', '.rf-steps > *',
    '.spas__doors > *', '.final > *',
  ].join(', ')],
  ['section', 'main .reveal'],
];
const STAGGER: Partial<Record<Kind, number>> = { rise: 80, img: 90, step: 160, gift: 80, door: 220 };

let io: IntersectionObserver | null = null;
let ro: ResizeObserver | null = null;
let abort: AbortController | null = null;

/* ---------- word split (H2s and the band quote) ---------- */
function splitInto(node: Node, out: Node): void {
  node.childNodes.forEach((child) => {
    if (child.nodeType === Node.TEXT_NODE) {
      (child.textContent || '').split(/(\s+)/).forEach((part) => {
        if (!part) return;
        if (/^\s+$/.test(part)) { out.appendChild(document.createTextNode(' ')); return; }
        const w = document.createElement('span'); w.className = 'w';
        const s = document.createElement('span'); s.textContent = part;
        w.appendChild(s); out.appendChild(w);
      });
    } else if (child instanceof HTMLElement) {
      if (child.classList.contains('sr-only')) return;
      const copy = child.cloneNode(false) as HTMLElement;
      copy.removeAttribute('id');
      splitInto(child, copy);
      out.appendChild(copy);
    }
  });
}
function split(el: HTMLElement): boolean {
  if (el.querySelector('.fx-words')) return true;
  if (el.closest('dialog, [hidden], .door') || el.classList.contains('sr-only')) return false;
  if (el.querySelector('a, button, input, select, textarea, svg, img')) return false;
  if (!(el.textContent || '').trim()) return false;
  const sr = document.createElement('span'); sr.className = 'fx-sr';
  while (el.firstChild) sr.appendChild(el.firstChild);
  const visual = document.createElement('span'); visual.className = 'fx-words'; visual.setAttribute('aria-hidden', 'true');
  splitInto(sr, visual);
  el.append(sr, visual);
  visual.querySelectorAll<HTMLElement>('.w').forEach((w, i) => w.style.setProperty('--wi', String(Math.min(i, 16))));
  return true;
}

/* ---------- spa door outlines (SVG drawn over the CSS arch, which steps aside) ---------- */
function arc(x: number, y: number, w: number, h: number): string {
  const r = w / 2;
  return `M${x} ${y + h}V${y + r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h}`;
}
function layoutDoor(arch: HTMLElement): void {
  const svg = arch.querySelector<SVGSVGElement>(':scope > .door-svg');
  const inner = arch.querySelector<HTMLElement>('.door-card__inner');
  if (!svg || !inner) return;
  const W = arch.offsetWidth, H = arch.offsetHeight;
  const a = arch.getBoundingClientRect(), b = inner.getBoundingClientRect();
  const k = a.width ? W / a.width : 1;   // ignore any transform on the way in
  svg.setAttribute('width', String(W)); svg.setAttribute('height', String(H)); svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const [o, i, t] = Array.from(svg.children) as SVGPathElement[];
  o.setAttribute('d', arc(0.5, 0.5, W - 1, H - 0.5));
  i.setAttribute('d', arc((b.left - a.left) * k + 0.5, (b.top - a.top) * k + 0.5, b.width * k - 1, b.height * k - 0.5));
  t.setAttribute('d', `M-14 ${H - 0.5}H${W + 14}`);
}
function buildDoor(arch: HTMLElement): boolean {
  if (!arch.querySelector('.door-card__inner')) return false;
  if (!arch.querySelector(':scope > .door-svg')) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'door-svg'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
    ['o', 'i', 't'].forEach((c) => { const p = document.createElementNS(NS, 'path'); p.setAttribute('class', c); p.setAttribute('pathLength', '1'); svg.appendChild(p); });
    arch.prepend(svg);
  }
  layoutDoor(arch);
  arch.setAttribute('data-fx-door', '');
  ro?.observe(arch);
  return true;
}

/* ---------- arming ---------- */
function arm(el: HTMLElement, kind: Kind, fold: number): void {
  if (el.hasAttribute('data-rv') || el.closest('dialog')) return;
  const r = el.getBoundingClientRect();
  const laidOut = r.width > 0 || r.height > 0;
  if (laidOut && r.top < fold) return;              // on the first screen (or above it): leave visible
  if (kind === 'img' && !el.querySelector('img')) return;
  if (kind === 'words' && !split(el)) return;
  if (kind === 'door' && !buildDoor(el)) return;
  el.setAttribute('data-rv', kind);
  io?.observe(el);
}

function reveal(entries: IntersectionObserverEntry[]): void {
  const shown = entries.filter((e) => e.isIntersecting).map((e) => e.target as HTMLElement);
  shown.sort((p, q) => {
    const a = p.getBoundingClientRect(), b = q.getBoundingClientRect();
    return Math.abs(a.top - b.top) > 8 ? a.top - b.top : a.left - b.left;
  });
  const n: Partial<Record<Kind, number>> = {};
  shown.forEach((el) => {
    const kind = el.getAttribute('data-rv') as Kind;
    const step = STAGGER[kind] ?? 0;
    const k = n[kind] ?? 0; n[kind] = k + 1;
    el.style.setProperty('--d', `${Math.min(k, 6) * step}ms`);
    el.classList.add('is-in');
    io?.unobserve(el);
  });
}

/* ---------- parallax fallback (browsers without scroll-driven animations) ---------- */
function parallaxFallback(signal: AbortSignal): void {
  if (SDA) return;
  const els = Array.from(document.querySelectorAll<HTMLElement>('[data-parallax]'));
  if (!els.length) return;
  let queued = false;
  const run = () => {
    queued = false;
    const vh = window.innerHeight;
    const on = motionOn();
    els.forEach((el) => {
      if (!on) { el.style.translate = ''; return; }
      const last = Number(el.dataset.fxY || 0);
      const r = el.getBoundingClientRect();
      const top = r.top - last;
      if (top > vh || top + r.height < 0) return;
      const p = (vh - top) / (vh + r.height);           // 0 → entering, 1 → leaving
      const drift = parseFloat(getComputedStyle(el).getPropertyValue('--drift')) || 32;
      const y = Math.round(drift * (1 - 2 * p) * 10) / 10;
      el.dataset.fxY = String(y);
      el.style.translate = `0 ${y}px`;
    });
  };
  const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(run); } };
  window.addEventListener('scroll', onScroll, { passive: true, signal });
  window.addEventListener('resize', onScroll, { passive: true, signal });
  run();
}

/* At the very end of a page the reveal line can sit below the last items: show whatever is left. */
function revealAtEnd(): void {
  const doc = document.documentElement;
  if (window.innerHeight + window.scrollY < doc.scrollHeight - 4) return;
  const left = Array.from(document.querySelectorAll<HTMLElement>('[data-rv]:not(.is-in)'))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.top < window.innerHeight && (r.width > 0 || r.height > 0); });
  if (left.length) reveal(left.map((target) => ({ target, isIntersecting: true }) as unknown as IntersectionObserverEntry));
}

/* ---------- page lifecycle ---------- */
function init(): void {
  teardown();
  abort = new AbortController();
  parallaxFallback(abort.signal);
  if (!motionOn() || !('IntersectionObserver' in window)) return;
  io = new IntersectionObserver(reveal, { rootMargin: '0px 0px -8% 0px', threshold: 0 });
  ro = 'ResizeObserver' in window ? new ResizeObserver((list) => list.forEach((e) => layoutDoor(e.target as HTMLElement))) : null;
  const fold = window.innerHeight * 0.94;
  GROUPS.forEach(([kind, sel]) => {
    document.querySelectorAll<HTMLElement>(sel).forEach((el) => arm(el, kind, fold));
  });
  window.addEventListener('scroll', revealAtEnd, { passive: true, signal: abort.signal });
  requestAnimationFrame(revealAtEnd);
}
function teardown(): void {
  io?.disconnect(); io = null;
  ro?.disconnect(); ro = null;
  abort?.abort(); abort = null;
}

// Ticker: the visible Pause/Play control (hover and focus also pause it, in CSS)
document.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-ticker-toggle]');
  if (!btn) return;
  const t = btn.closest<HTMLElement>('[data-ticker]'); if (!t) return;
  const paused = !t.hasAttribute('data-paused');
  t.toggleAttribute('data-paused', paused);
  const label = btn.querySelector('[data-ticker-label]');
  if (label) label.textContent = paused ? 'Play' : 'Pause';
  btn.setAttribute('aria-label', paused ? 'Play the moving list of treatments' : 'Pause the moving list of treatments');
});

document.addEventListener('astro:before-swap', (e) => {
  teardown();
  const doc = (e as Event & { newDocument?: Document }).newDocument;
  if (doc && root.hasAttribute('data-fx')) doc.documentElement.setAttribute('data-fx', '');   // keep motion on; never replay the lotus intro
});
document.addEventListener('astro:page-load', init);

/** Replays the quick cross-fade on a changed price (called from site.ts). */
export function swapPulse(els: Iterable<Element>): void {
  if (!motionOn()) return;
  for (const el of els) {
    el.classList.remove('fx-swap');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('fx-swap');
  }
}
