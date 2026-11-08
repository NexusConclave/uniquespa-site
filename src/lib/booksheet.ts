/**
 * Book sheet rows (§4.0): six Square deep links per spa, then (once approved) "New here? First-visit prices",
 * then "Full menu" last. A special that is a version of a row's service takes that row's place; otherwise
 * it fills row 6. No service appears twice.
 */
import { getService, getOption, bookUrl, formatMinutes, optionPriceText, priceSuffix, spokenMinutes, formatPrice, type Spa } from './catalog';
import { monthSpecial, offerBookUrl, isDraft } from './offers';
import { spa as spaInfo } from './site';

export interface SheetRow {
  key: string;
  name: string;
  meta: string;        // "60 min · $150"
  spoken: string;      // ", 60 minutes, $150, San Diego"
  href: string;
  service: string;
  draft?: boolean;
  ends?: string;
  starts?: string;
  fallback?: SheetRow; // shown instead once the special expires (client-side)
}

const PLAN: Record<Spa, Array<[string, number]>> = {
  SD: [['swedish', 60], ['deep-tissue', 60], ['lymphatic', 60], ['babor-sculpt-lift', 90], ['couples', 120], ['hot-stone', 60]],
  DM: [['swedish', 60], ['deep-tissue', 60], ['lymphatic', 60], ['babor-sculpt-lift', 90], ['wrap-me-up', 80], ['katy', 60]],
};

function serviceRow(id: string, minutes: number, sp: Spa): SheetRow {
  const s = getService(id);
  const o = getOption(s, minutes);
  const href = bookUrl(o.square_id, sp);
  if (!href) throw new Error(`[booksheet] ${id} ${minutes} is not bookable at ${sp}`);
  const forTwo = priceSuffix(o);
  const price = optionPriceText(o) + forTwo;
  const len = forTwo ? `${o.label.replace(/, for two$/, '')}` : formatMinutes(o.minutes);
  const spokenLen = forTwo ? `${o.label.replace(/ min, for two$/, '')} minutes` : spokenMinutes(o.minutes);
  return {
    key: `${id}-${minutes}`,
    name: s.name,
    meta: `${len} · ${price}`,
    spoken: `, ${spokenLen}, ${price}, ${spaInfo(sp).name}`,
    href,
    service: id,
  };
}

export function sheetRows(sp: Spa): SheetRow[] {
  const rows = PLAN[sp].map(([id, m]) => serviceRow(id, m, sp));
  const special = monthSpecial(sp);
  if (!special) return rows;
  const href = offerBookUrl(special, sp);
  if (!href || special.price == null) return rows;
  const price = formatPrice(special.price);
  const sRow: SheetRow = {
    key: `offer-${special.id}`,
    name: special.title,
    meta: `${special.minutes ? formatMinutes(special.minutes) + ' · ' : ''}${price} · this month`,
    spoken: `, ${special.minutes ? spokenMinutes(special.minutes) + ', ' : ''}${price}, ${spaInfo(sp).name}, this month's special`,
    href,
    service: special.id,
    draft: isDraft(special),
    ends: special.ends,
    starts: special.starts,
  };
  const idx = special.replaces_service ? rows.findIndex((r) => r.service === special.replaces_service) : -1;
  const at = idx >= 0 ? idx : rows.length - 1;
  sRow.fallback = rows[at];
  rows[at] = sRow;
  return rows;
}
