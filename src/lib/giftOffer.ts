/**
 * The holiday gift card offer: ONE switch, site.json "gift_offer" (gift kit decision 1, APPROVALS Q50).
 *   option "A" (default) → no offer anywhere: cards sell at menu prices.
 *   option "B" → "$25 off a $225 eGift card" (buyer pays $200).
 *   option "C" → "$25 promo card" for a buyer who spends $200+ on eGift cards.
 * The wording is the approved copy from the gift kit (offers.json "holiday-egift-2026".options). The same resolved
 * text feeds the gift page block, the $225 tile badge (B only), the home offers band and the policies gift card section.
 * Choosing B or C is the owner's approval, so no draft note shows. Required fields missing → a production build fails;
 * PREVIEW shows [brackets] so staging can still be reviewed.
 * Env overrides for test builds: GIFT_OFFER=A|B|C, GIFT_STARTS=YYYY-MM-DD, GIFT_ENDS=YYYY-MM-DD.
 */
import offersData from '../data/offers.json';
import { site, PREVIEW } from './site';
import { todayLA, shortDate, longDate } from './dates';

export type GiftOption = 'A' | 'B' | 'C';

interface GiftCopy { eyebrow: string; title: string; deal: string; small: string; tile_badge: string | null; button: string }
interface GiftConfig {
  option: string; starts: string | null; ends: string | null;
  c_send_days: number | string | null; c_promo_valid: string | null; c_limits: string | null;
}

export interface GiftOffer {
  id: string;
  option: 'B' | 'C';
  starts: string;
  ends: string;
  eyebrow: string;
  title: string;
  deal: string;
  small: string;
  /** Badge on the $225 tile, or null (option C has none). */
  tileBadge: string | null;
  button: string;
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const entry = (offersData.offers as Array<{ id: string; kind: string; options?: Record<string, GiftCopy> }>).find((o) => o.kind === 'gift');
const cfg = (site as unknown as { gift_offer: GiftConfig }).gift_offer;

/** The chosen option (env GIFT_OFFER overrides site.json for test builds). */
export const GIFT_OPTION: GiftOption = (() => {
  const v = (process.env.GIFT_OFFER || cfg?.option || 'A').trim().toUpperCase();
  if (v !== 'A' && v !== 'B' && v !== 'C') throw new Error(`[gift-offer] site.json gift_offer.option must be "A", "B" or "C" (got "${v}")`);
  return v;
})();

function fail(msg: string): string {
  if (PREVIEW) return '';
  throw new Error(`[gift-offer] option ${GIFT_OPTION}: ${msg}. Set it in site.json gift_offer (or choose option "A").`);
}

/** The resolved offer for this build, ignoring today's date; null for option A. */
function resolve(): GiftOffer | null {
  if (GIFT_OPTION === 'A') return null;
  if (!entry?.options?.[GIFT_OPTION]) throw new Error(`[gift-offer] offers.json "holiday-egift-2026" has no wording for option ${GIFT_OPTION}`);
  const copy = entry.options[GIFT_OPTION];
  const starts = process.env.GIFT_STARTS || cfg.starts || '';
  const ends = process.env.GIFT_ENDS || cfg.ends || '';
  if (!ISO.test(starts) || !ISO.test(ends)) { fail('starts and ends must be set as YYYY-MM-DD'); }
  if (ISO.test(starts) && ISO.test(ends) && ends < starts) throw new Error(`[gift-offer] ends (${ends}) is before starts (${starts})`);
  const tokens: Record<string, string> = {
    starts_short: ISO.test(starts) ? shortDate(starts) : '[start]',
    ends_short: ISO.test(ends) ? shortDate(ends) : '[end]',
    starts_long: ISO.test(starts) ? longDate(starts) : '[Start date]',
    ends_long: ISO.test(ends) ? longDate(ends) : '[end date]',
  };
  if (GIFT_OPTION === 'C') {
    const days = cfg.c_send_days;
    if (days == null || !/^\d+$/.test(String(days)) || Number(days) < 1) fail('c_send_days must be a whole number of days');
    if (!cfg.c_promo_valid) fail('c_promo_valid must say when the promo card can be used');
    if (cfg.c_limits == null) fail('c_limits must be a sentence, or "" for none');
    tokens.c_send_days = days != null && /^\d+$/.test(String(days)) ? String(days) : '[X]';
    tokens.c_promo_valid = cfg.c_promo_valid || '[use dates]';
    tokens.c_limits = cfg.c_limits ?? '[Your limits.]';
  }
  const fill = (t: string | null) => (t == null ? null : t.replace(/\{(\w+)\}/g, (_, k) => {
    if (!(k in tokens)) throw new Error(`[gift-offer] unknown token {${k}} in offers.json wording`);
    return tokens[k];
  }).replace(/\s+$/, ''));
  return {
    id: entry.id,
    option: GIFT_OPTION,
    starts, ends,
    eyebrow: fill(copy.eyebrow)!,
    title: fill(copy.title)!,
    deal: fill(copy.deal)!,
    small: fill(copy.small)!,
    tileBadge: fill(copy.tile_badge),
    button: copy.button,
  };
}

const OFFER = resolve();

export interface GiftOfferView {
  offer: GiftOffer;
  /** True when the offer hasn't started yet: render it hidden with data-reveal-on-start (production). */
  upcoming: boolean;
  /** PREVIEW shows an upcoming offer now (with its start date); production reveals it client-side on the day. */
  previewEarly: boolean;
}

/**
 * The gift offer to render today, or null. Active (starts <= today <= ends), or starting within `days` days
 * (rendered hidden; the client reveals it on its start date). PREVIEW also shows an offer that starts later.
 */
export function giftOffer(opts: { days?: number; today?: string } = {}): GiftOfferView | null {
  if (!OFFER) return null;
  const today = opts.today ?? todayLA();
  if (!ISO.test(OFFER.starts) || !ISO.test(OFFER.ends)) return PREVIEW ? { offer: OFFER, upcoming: false, previewEarly: false } : null;
  if (today > OFFER.ends) return null;
  if (today >= OFFER.starts) return { offer: OFFER, upcoming: false, previewEarly: false };
  const horizon = new Date(today + 'T12:00:00Z');
  horizon.setUTCDate(horizon.getUTCDate() + (opts.days ?? 30));
  const near = OFFER.starts <= horizon.toISOString().slice(0, 10);
  if (PREVIEW) return { offer: OFFER, upcoming: true, previewEarly: true };
  return near ? { offer: OFFER, upcoming: true, previewEarly: false } : null;
}

/** Title with its last word as the one italic accent: ["Holiday gift ", "cards"]. */
export function giftTitleParts(title: string): [string, string] | null {
  const m = title.replace(/\.$/, '').match(/^(.*\s)(\S+)$/);
  return m ? [m[1], m[2]] : null;
}
