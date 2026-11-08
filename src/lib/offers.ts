/**
 * Offers (blueprint §8, offers.json). An offer is shown only when:
 *   (approved === true OR the build has PREVIEW=1) AND starts <= today <= ends (Los Angeles dates).
 * Every rendered offer element also carries data-ends (and data-starts) so the client hides it after
 * its end date even if the nightly rebuild hasn't run.
 */
import offersData from '../data/offers.json';
import { bookUrl, giftUrl, findLiveService, formatMinutes, type Spa } from './catalog';
import { PREVIEW } from './site';
import { todayLA } from './dates';

export type OfferKind = 'special' | 'gift' | 'first-visit' | 'referral' | 'series';

export interface Offer {
  id: string;
  kind: OfferKind;
  title: string;
  body: string;
  includes?: string[];
  legal_line?: string;
  price: number | null;
  minutes?: number;
  starts: string;
  ends: string;
  spa: Spa[];
  square_id?: string;
  service_id?: string;
  related_service?: string;
  replaces_service?: string;
  featured?: boolean;
  name_only?: boolean;
  url?: string;
  /** Bundle parts, for "Save $X vs booking separately" (see offerSaving). Each must be a live menu item. */
  parts?: OfferPart[];
  approved: boolean;
  owner_confirm: string;
}

/** One menu item inside a bundle offer: a live service id plus its option (minutes, or the option label). */
export interface OfferPart { service: string; minutes?: number; label?: string }

// The holiday gift card offer (kind 'gift') is switched by site.json gift_offer and read by lib/giftOffer.ts only.
const ALL = (offersData.offers as Offer[]).filter((o) => o.kind !== 'gift');

/** Offers that are redeemed by booking a Square special-price item. They need their OWN square_id. */
const BOOKABLE_KINDS: OfferKind[] = ['special', 'series', 'first-visit'];

/** True when the offer is redeemed by booking but has no Square item of its own yet. */
export function needsSquareItem(o: Offer): boolean {
  return BOOKABLE_KINDS.includes(o.kind) && !o.square_id;
}

const warned = new Set<string>();
/**
 * True when this offer may render in this build, ignoring dates:
 * approved (or PREVIEW) AND, outside PREVIEW, a bookable offer must have its own Square item.
 * Production builds log a warning for an approved offer that is held back for lack of one.
 */
export function isRenderable(o: Offer): boolean {
  if (PREVIEW) return true;
  if (o.approved !== true) return false;
  if (needsSquareItem(o)) {
    if (!warned.has(o.id)) {
      warned.add(o.id);
      console.warn(`[offers] "${o.id}" is approved but has no Square item of its own (square_id); it will not render.`);
    }
    return false;
  }
  return true;
}

/** A draft = renderable only because of PREVIEW. Draft cards carry the "Draft offer — needs owner approval" note. */
export function isDraft(o: Offer): boolean {
  return !o.approved;
}

export function isActive(o: Offer, today: string = todayLA()): boolean {
  return o.starts <= today && today <= o.ends;
}

/** Offers that render today, optionally filtered by kind and spa. Featured first. */
export function activeOffers(opts: { kind?: OfferKind | OfferKind[]; spa?: Spa; today?: string } = {}): Offer[] {
  const kinds = opts.kind ? ([] as OfferKind[]).concat(opts.kind) : null;
  const today = opts.today ?? todayLA();
  return ALL.filter(
    (o) =>
      isRenderable(o) &&
      isActive(o, today) &&
      (!kinds || kinds.includes(o.kind)) &&
      (!opts.spa || o.spa.includes(opts.spa)),
  ).sort((a, b) => Number(!!b.featured) - Number(!!a.featured));
}

/** Offers that start within the next `days` days (rendered hidden, revealed client-side on their start date). */
export function upcomingOffers(opts: { kind?: OfferKind | OfferKind[]; days?: number; today?: string } = {}): Offer[] {
  const kinds = opts.kind ? ([] as OfferKind[]).concat(opts.kind) : null;
  const today = opts.today ?? todayLA();
  const horizon = new Date(today + 'T12:00:00Z');
  horizon.setUTCDate(horizon.getUTCDate() + (opts.days ?? 14));
  const h = horizon.toISOString().slice(0, 10);
  return ALL.filter((o) => isRenderable(o) && o.starts > today && o.starts <= h && (!kinds || kinds.includes(o.kind)));
}

/** "This month's special" for one spa (Book sheet row): the featured active special that can actually be booked. */
export function monthSpecial(spa: Spa, today?: string): Offer | null {
  return activeOffers({ kind: 'special', spa, today }).find((o) => !o.name_only && offerBookUrl(o, spa)) ?? null;
}

/**
 * Deep link for an offer at a spa: its OWN Square special-price item. Null when the offer isn't at that spa
 * or has no Square item yet — never the spa's general booking page (the price there would differ).
 */
export function offerBookUrl(o: Offer, spa: Spa): string | null {
  if (!o.spa.includes(spa) || !o.square_id) return null;
  return bookUrl(o.square_id, spa);
}

/** One offer by id, if it may render in this build (approved or PREVIEW). Dates are NOT checked: use isActive for that. */
export function offerById(id: string): Offer | null {
  const o = ALL.find((x) => x.id === id);
  return o && isRenderable(o) ? o : null;
}

export interface OfferSaving { amount: number; parts: Array<{ name: string; length: string; price: number }> }

/**
 * "Save $X vs booking separately" (§4.5, G5 / B&P §17501). Returns null — so no saving line renders — unless
 * the offer lists `parts` and EVERY part is a live menu item with a fixed Square price, offered at EVERY spa
 * the offer runs at. Prices come from the catalog (square-lock), never from offers.json. Never a former price.
 */
export function offerSaving(o: Offer): OfferSaving | null {
  if (!o.parts?.length || o.price == null) return null;
  const parts: OfferSaving['parts'] = [];
  for (const p of o.parts) {
    const s = findLiveService(p.service);
    if (!s) return null;
    const opt = s.options.find((x) => (p.label ? x.label === p.label : p.minutes != null ? x.minutes === p.minutes : true));
    if (!opt || opt.price == null) return null;
    if (!o.spa.every((sp) => opt.locations.includes(sp))) return null;
    parts.push({ name: s.name, length: formatMinutes(opt.minutes), price: opt.price });
  }
  const amount = parts.reduce((sum, r) => sum + r.price, 0) - o.price;
  return amount > 0 ? { amount, parts } : null;
}

export function offerUrl(o: Offer): string {
  return o.url === 'gift' ? giftUrl() : '/specials';
}

/** The seasonal bottom-bar swap (Gift replaces Call). Only seasonal change on the site (decisions log #3). */
export function giftBarWindows(): Array<{ starts: string; ends: string }> {
  return offersData.bar_gift_windows.map(({ starts, ends }) => ({ starts, ends }));
}

export function giftBarActive(today: string = todayLA()): boolean {
  return giftBarWindows().some((w) => w.starts <= today && today <= w.ends);
}
