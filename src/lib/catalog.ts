/**
 * Catalog: the only place prices, minutes and booking links come from.
 * Sources: src/data/services.json (site catalog + status) and src/data/square-lock.json (Square snapshot, 2026-10-23).
 *
 * Status gate (blueprint §3.1): only `live` services are ever returned by the public helpers.
 * `hold`, `consult` and `hidden` items never leave this module: no names, prices or links.
 * Use only these helpers in pages/components — never import services.json directly.
 */
import servicesData from '../data/services.json';
import lock from '../data/square-lock.json';
import offersData from '../data/offers.json';
import treatmentPaths from '../data/treatment-paths.json';

export type Spa = 'SD' | 'DM';
export const SPAS: Spa[] = ['SD', 'DM'];
export type Group = 'massage' | 'facials' | 'body';

export interface ServiceOption {
  label: string;
  square_id: string;
  /** Exact Square price in dollars, or null when Square's price is variable/unknown. */
  price: number | null;
  minutes: number;
  locations: Spa[];
  square_name?: string;
}

export interface Service {
  id: string;
  name: string;
  group: string;
  status: 'live' | 'hold' | 'consult' | 'hidden';
  medical: 'yes' | 'no' | 'pending';
  options: ServiceOption[];
  summary: string | null;
  flagship: string | null;
  notes: string | null;
}

interface LockEntry {
  id: string;
  name: string;
  price_cents: number | null;
  price_type: string;
  duration_min: number;
  locations: Spa[];
}

const LOCK = new Map<string, LockEntry>((lock.services as LockEntry[]).map((s) => [s.id, s]));
const ALL = servicesData.services as unknown as Service[];

/** Square items that only exist as a dated offer (e.g. "October Special: …"). They show via offers.json, never in menus. */
const OFFER_ITEM_IDS = new Set(
  (offersData.offers as Array<{ service_id?: string }>).map((o) => o.service_id).filter(Boolean) as string[],
);

/** Price text for a service whose Square price is variable (Signature custom facial). Hard rule 1. */
export const VARIABLE_PRICE_TEXT = 'Price set at your visit';
/** Price text when no price is known. Hard rule 1. */
export const NO_PRICE_TEXT = 'Pricing at consultation';

function isLive(s: Service | undefined): s is Service {
  return !!s && s.status === 'live' && s.medical === 'no';
}

/** One option with the lockfile's price/minutes/locations merged over services.json. */
function lockOption(o: ServiceOption): ServiceOption {
  const l = LOCK.get(o.square_id);
  if (!l) return o;
  const price = l.price_type === 'fixed' && l.price_cents ? l.price_cents / 100 : null;
  return { ...o, price, minutes: l.duration_min ?? o.minutes, locations: [...l.locations] as Spa[] };
}

/** V2 full treatment pages (src/data/treatment-paths.json): the page a service links to when services.json names no flagship. */
const TREATMENT_PATHS = treatmentPaths.paths as Record<string, string>;

/** Merge the lockfile's price/minutes/locations over services.json, so a stale services.json can't leak a wrong price. */
function withLock(s: Service): Service {
  return { ...s, flagship: s.flagship ?? TREATMENT_PATHS[s.id] ?? null, options: s.options.map(lockOption) };
}

/**
 * An extra a guest adds in the Square booking flow next to a service of `group` (services.json `addons`),
 * e.g. hot stones or cupping on any massage. Shown as one line (AddOnLine.astro), never with a Book link of its own.
 */
export interface AddOn {
  id: string;
  /** Lower-case, for running text: "Add {name} to any massage". */
  name: string;
  group: Group;
  status: Service['status'];
  medical: Service['medical'];
  options: ServiceOption[];
  notes?: string | null;
}

const ADDONS = ((servicesData as { addons?: unknown[] }).addons ?? []) as AddOn[];

/** Live add-ons for a group, prices/minutes/locations from the lockfile; options without a fixed price are dropped. */
export function liveAddOns(group: Group): AddOn[] {
  return ADDONS.filter((a) => a.group === group && a.status === 'live' && a.medical === 'no')
    .map((a) => ({
      ...a,
      options: a.options.map(lockOption).filter((o) => o.price != null && o.locations.length).sort((x, y) => x.minutes - y.minutes),
    }))
    .filter((a) => a.options.length);
}

/** Live services in a group (massage | facials | body), menu order. Excludes dated offer items. */
export function liveServices(group?: Group): Service[] {
  return ALL.filter((s) => isLive(s) && !OFFER_ITEM_IDS.has(s.id) && (!group || s.group === group)).map(withLock);
}

/** One live service by id. Throws at build time for an unknown or gated id, so a hold/consult item can never render. */
export function getService(id: string): Service {
  const s = ALL.find((x) => x.id === id);
  if (!isLive(s)) throw new Error(`[catalog] "${id}" is not a live spa service; it must not appear on the site.`);
  return withLock(s);
}

/** Like getService, but returns null instead of throwing (for optional slots such as offer items). */
export function findLiveService(id: string): Service | null {
  const s = ALL.find((x) => x.id === id);
  return isLive(s) ? withLock(s) : null;
}

/** Pick an option by minutes (60) or by label ("60 min"). Defaults to the first option. */
export function getOption(s: Service, which?: number | string): ServiceOption {
  if (which == null) return s.options[0];
  const o = s.options.find((x) => (typeof which === 'number' ? x.minutes === which : x.label === which));
  if (!o) throw new Error(`[catalog] ${s.id} has no option ${which}`);
  return o;
}

/** Spas where at least one option is offered. */
export function spasFor(s: Service | ServiceOption): Spa[] {
  const locs = 'options' in s ? s.options.flatMap((o) => o.locations) : s.locations;
  return SPAS.filter((sp) => locs.includes(sp));
}

export function isSingleSpa(s: Service | ServiceOption): Spa | null {
  const sp = spasFor(s);
  return sp.length === 1 ? sp[0] : null;
}

/** "$150". Never a fee-inclusive odd price; Square's exact price only. */
export function formatPrice(price: number | null | undefined, fallback = NO_PRICE_TEXT): string {
  if (price == null) return fallback;
  return '$' + price.toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/** 60 → "60 min", 120 → "120 min", 135 → "2 hr 15 min" (visit lengths), 180 → "3 hr". */
export function formatMinutes(min: number, style: 'treatment' | 'visit' = 'treatment'): string {
  if (style === 'treatment' && min <= 120) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

/** Screen-reader form: 60 → "60 minutes". */
export function spokenMinutes(min: number): string {
  if (min <= 120) return `${min} minutes`;
  const h = Math.floor(min / 60), m = min % 60;
  return `${h} hour${h > 1 ? 's' : ''}${m ? ` ${m} minutes` : ''}`;
}

/** Display price for an option, honouring the variable-price rule. */
export function optionPriceText(o: ServiceOption): string {
  const l = LOCK.get(o.square_id);
  if (l && l.price_type === 'variable') return VARIABLE_PRICE_TEXT;
  return formatPrice(o.price);
}

/** "Couples" options are priced for two. */
export function priceSuffix(o: ServiceOption): string {
  return /for two/i.test(o.label) ? ' for two' : '';
}

/**
 * Square deep link for one bookable item at one spa:
 *   booking_base[spa] + "/" + square_id
 * Returns null (and never builds a link) when:
 *   - the item isn't in the Square snapshot,
 *   - the item isn't offered at that spa (e.g. a San Diego-only item at Del Mar — it would fail silently on Square),
 *   - the item belongs to a non-live (hold/consult/hidden) service.
 * Offer items (special-price Square items) pass through `bookOfferUrl` in offers.ts.
 */
export function bookUrl(squareId: string, spa: Spa): string | null {
  const l = LOCK.get(squareId);
  if (!l) return null;
  if (!l.locations.includes(spa)) return null;
  const owner = ALL.find((s) => s.options.some((o) => o.square_id === squareId));
  if (!owner || !isLive(owner)) return null;
  return `${(lock.booking_base as Record<Spa, string>)[spa]}/${squareId}`;
}

/** The spa's Square booking page (service list), for "Book online" without a specific item. */
export function spaBookingUrl(spa: Spa): string {
  return (lock.booking_base as Record<Spa, string>)[spa];
}

/** Square eGift order page. */
export function giftUrl(): string {
  return lock.gift_card_url;
}

/** Snapshot date of the Square prices. */
export const PRICES_CAPTURED: string = lock.captured;
