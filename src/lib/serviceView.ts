/**
 * View model shared by ServiceCard and ServiceRow: one entry per bookable option with
 * the display strings and per-spa deep links the client script swaps when a duration chip changes.
 */
import {
  bookUrl, formatMinutes, optionPriceText, priceSuffix, spokenMinutes, spasFor, SPAS,
  type Service, type ServiceOption, type Spa,
} from './catalog';
import { spa as spaInfo } from './site';

export interface OptionView {
  index: number;
  minutes: number;         // Square duration (visit length for couples)
  chip: string;            // chip label: "60 min", "90 min with stretching"
  minutesText: string;     // "60 min" / "2 hr 15 min"
  spokenMinutes: string;   // "60 minutes"
  priceText: string;       // "$150" / "$336 for two" / "Price set at your visit"
  priceNumber: string;     // "$150" (no suffix) for the display price
  suffix: string;          // " for two"
  locations: Spa[];
  links: Partial<Record<Spa, string>>;
}

export interface ServiceView {
  id: string;
  name: string;
  summary: string | null;
  flagship: string | null;
  options: OptionView[];
  spas: Spa[];             // spas where any option is bookable
  single: Spa | null;      // the one spa, if only one
}

function chipLabel(o: ServiceOption): string {
  // "60 min, for two" → "60 min"; "about 3 hours, one area" stays as is
  return o.label.replace(/, for two$/i, '');
}

/** "90 min with stretching" → "90 minutes with stretching"; "2 hr, with 60 min massage" → "2 hours, with 60-minute massage". Null for a plain "60 min". */
function spokenLabel(label: string, minutes: number): string | null {
  if (/^\d+\s*min$/i.test(label.trim())) return null;
  const m = label.match(/^(\d+)\s*min\b,?\s*(.+)$/i);
  if (m) return `${spokenMinutes(minutes)} ${m[2]}`;
  return label.replace(/\b(\d+)\s*min\b(?=\s+[a-z])/gi, '$1-minute').replace(/\b(\d+)\s*min\b/gi, '$1 minutes').replace(/\b1\s*hr\b/gi, '1 hour').replace(/\b(\d+)\s*hr\b/gi, '$1 hours');
}

export function viewService(s: Service, onlySpa?: Spa): ServiceView {
  const options = s.options
    .filter((o) => !onlySpa || o.locations.includes(onlySpa))
    .map((o, index): OptionView => {
      const links: Partial<Record<Spa, string>> = {};
      for (const sp of SPAS) {
        const u = bookUrl(o.square_id, sp);
        if (u && (!onlySpa || sp === onlySpa)) links[sp] = u;
      }
      const priceNumber = optionPriceText(o);
      const suffix = o.price != null ? priceSuffix(o) : '';
      const visit = /for two/i.test(o.label);
      // A ranged length ("60 to 120 min", Signature custom facial) shows the range, not Square's booking block.
      const range = o.label.match(/^(\d+)\s*to\s*(\d+)\s*min/i);
      // Options that differ by more than length ("90 min with stretching", "2 hr, with 60 min massage") are
      // spoken from their label, so a screen reader can tell them apart from the plain option.
      const extra = !range && !visit ? spokenLabel(o.label, o.minutes) : null;
      return {
        index,
        minutes: o.minutes,
        chip: chipLabel(o),
        minutesText: range ? `${range[1]} to ${range[2]} min` : visit ? `${formatMinutes(o.minutes, 'visit')} visit` : formatMinutes(o.minutes),
        spokenMinutes: range ? `${range[1]} to ${range[2]} minutes` : visit ? `${spokenMinutes(o.minutes)} visit` : extra ?? spokenMinutes(o.minutes),
        priceText: priceNumber + suffix,
        priceNumber,
        suffix,
        locations: (Object.keys(links) as Spa[]),
        links,
      };
    });
  const spas = SPAS.filter((sp) => options.some((o) => o.links[sp]));
  return {
    id: s.id,
    name: s.name,
    summary: s.summary,
    flagship: s.flagship,
    options,
    spas,
    single: spas.length === 1 ? spas[0] : null,
  };
}

export function spaName(sp: Spa): string {
  return spaInfo(sp).name;
}

/** "Swedish massage, 60 minutes, $150, San Diego" — the full spoken form for a booking link. */
export function spokenRow(name: string, o: OptionView, sp: Spa): string {
  return `${name}, ${o.spokenMinutes}, ${o.priceText}, ${spaName(sp)}`;
}

export { spasFor };
