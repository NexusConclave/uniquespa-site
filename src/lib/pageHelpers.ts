/**
 * Small text helpers for service/spa pages (dev B). Every price, length and spa name in running copy
 * (FAQ answers, intros) comes from here, i.e. from lib/catalog.ts — never typed into a page.
 */
import {
  getService, getOption, liveServices, formatMinutes, optionPriceText, priceSuffix, spasFor, SPAS,
  type Group, type Service, type ServiceOption, type Spa,
} from './catalog';
import { site } from './site';

/** "$150", "$336 for two", "Price set at your visit". */
export function priceOf(id: string, minutes?: number): string {
  const o = getOption(getService(id), minutes);
  return optionPriceText(o) + (o.price != null ? priceSuffix(o) : '');
}

/** The massage length of an option ("60 min"; couples: "60 min", not the 2 hr visit). */
export function lengthOf(o: ServiceOption): string {
  const m = o.label.match(/^(\d+)\s*min/);
  if (/for two/i.test(o.label) && m) return `${m[1]} min`;
  const r = o.label.match(/^(\d+)\s*to\s*(\d+)\s*min/i);
  if (r) return `${r[1]} to ${r[2]} min`;
  return formatMinutes(o.minutes);
}

/** "60, 90 or 120 min" for the options offered (optionally at one spa). */
export function lengthsOf(id: string, onlySpa?: Spa): string {
  const mins = [...new Set(getService(id).options.filter((o) => !onlySpa || o.locations.includes(onlySpa)).filter((o) => !/with/i.test(o.label)).map((o) => o.minutes))];
  if (mins.length === 1) return formatMinutes(mins[0]);
  return `${mins.slice(0, -1).join(', ')} or ${mins[mins.length - 1]} min`;
}

/** "60 min $150 · 90 min $200 · 120 min $250". */
export function priceList(id: string, onlySpa?: Spa): string {
  return getService(id).options
    .filter((o) => !onlySpa || o.locations.includes(onlySpa))
    .map((o) => `${lengthOf(o)} ${optionPriceText(o)}${o.price != null ? priceSuffix(o) : ''}`)
    .join(' · ');
}

export function spaName(sp: Spa): string {
  return site.spas[sp].name;
}

/** "both spas" | "San Diego only" | "Del Mar only". */
export function whereText(s: Service | ServiceOption): string {
  const sp = spasFor(s);
  return sp.length === 2 ? 'both spas' : `${spaName(sp[0])} only`;
}

export function offeredAt(s: Service, sp: Spa): boolean {
  return s.options.some((o) => o.locations.includes(sp));
}

/** Live services in a group offered at a spa. */
export function servicesAt(sp: Spa, group?: Group): Service[] {
  return liveServices(group).filter((s) => offeredAt(s, sp));
}

/** Live services offered ONLY at this spa (every option). */
export function onlyAt(sp: Spa, group?: Group): Service[] {
  return liveServices(group).filter((s) => spasFor(s).length === 1 && spasFor(s)[0] === sp);
}

/** "A, B and C". */
export function listJoin(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** Lower-case a service name for running text, keeping brand words ("BABOR", "Katy", "Joëlle Ciocco", "Wrap Me Up"). */
export function inText(name: string): string {
  if (/^(BABOR|Joëlle|Wrap Me Up|Thai|Swedish)/.test(name)) return name;
  if (/\s[A-Z]/.test(name)) return name;   // a proper name later on ("Pure Cleanse and Rebalance", "with Katy")
  return name.charAt(0).toLowerCase() + name.slice(1);
}

export { SPAS };

/**
 * Public names where the claims log (research/copy/12-claims-log.md) renamed a Square item.
 * "Pure Detox" implies a detox claim → "Pure Cleanse and Rebalance facial" (rename on Square pending).
 */
const NAME_OVERRIDES: Record<string, string> = {
  'pure-detox': 'Pure Cleanse and Rebalance facial',
};
export function displayName(s: Service | string): string {
  const svc = typeof s === 'string' ? getService(s) : s;
  return NAME_OVERRIDES[svc.id] ?? svc.name;
}

/** One-line descriptions from the copy files (03-massage, 04-facials, 05-body), claims-log checked. */
const COPY: Record<string, string> = {
  swedish: 'Long, flowing strokes with light to medium pressure. A great first massage.',
  relaxing: 'A slow, soothing full session, just for unwinding.',
  'hot-stone': 'Smooth, warm stones plus massage. Deep warmth, even at gentle pressure.',
  foot: '30 minutes for tired feet.',
  'deep-tissue': 'Slow, firm pressure for deeper muscle layers and stubborn knots. It can feel intense, but never sharp.',
  therapeutic: 'A focused massage for one main area, like your neck, shoulders or lower back.',
  sports: 'Firmer, focused work for people who train. Popular after workouts and events.',
  thai: 'Yoga-like stretches and rhythmic pressure. You stay relaxed while your therapist does the work.',
  lymphatic: "Very gentle, rhythmic strokes, designed to encourage the flow of fluid. Most clients find it deeply calming. It's our only massage with gentle tummy work.",
  'anti-cellulite': 'Brisk, firm massage for thighs, hips and buttocks, at an energetic pace.',
  'brazilian-butt': "A firm sculpting massage with Brazilian wooden tools: brisk, rhythmic and warming.",
  'liposuction-massage': "About 3 hours on one area only.",
  prenatal: 'Designed for pregnancy. Positioning, pressure and technique are adjusted for each stage. Please check with your doctor or midwife first.',
  postnatal: "An hour that's all about you, after your baby arrives. Positioning and pressure are adjusted for comfort.",
  couples: 'Two tables in a private room. Then 30 minutes together, with tea or coffee, fresh fruit and cheese. All included.',
  katy: 'Book any massage with Katy, our owner. Lymphatic, deep tissue, anti-cellulite, relaxing, sports or therapeutic, or a mix.',
  'signature-facial': 'Starts with a skin check. Then cleansing, exfoliation, gentle extractions, a mask, massage and hydration, all chosen for your skin.',
  'babor-sculpt-lift': 'A sculpting face massage, a BABOR lifting ampoule (a sealed serum vial), an anti-wrinkle mask and LED light.',
  'babor-deep-cleanse': 'A deep cleanse with extractions. Ultrasound, high frequency or a peel are added if your skin needs them.',
  'pure-detox': 'A BABOR facial for oily, congested or breakout-prone skin.',
  'express-hydration': 'A quick BABOR boost for dry or tired skin. Hyaluronic serums, a gentle enzyme exfoliation and a hydro-gel mask.',
  'joelle-ciocco': 'A hands-on sculpting face massage, inspired by the Paris skin expert Joëlle Ciocco.',
  'face-sculpture': 'A sculpting massage for the face, jawline and neck.',
  'wrap-me-up': "A warming body wrap. Relax while you're cocooned. Add a 60 min massage if you like.",
};
export function summaryOf(s: Service | string): string | null {
  const svc = typeof s === 'string' ? getService(s) : s;
  return COPY[svc.id] ?? svc.summary;
}
