/**
 * llms.txt body (llmstxt.org format), served at /llms.txt by src/pages/llms.txt.ts — a plain-text brief for AI assistants, generated at build time from the same data
 * as the pages (lib/catalog.ts → services.json + square-lock.json, lib/entity.ts → site.json), so a price can never
 * drift from the menu. scripts/check-geo.mjs compares every price here with the owner's facts file (public subset: facts/facts.public.json).
 *
 * Rules (same as the pages): live services only; consult-only and on-hold treatments are never named; offers only
 * when approved and running today (never drafts, even on a PREVIEW build); no ratings, no result or medical claims.
 * Brazilian butt and liposuction massage stay as rows on /menu only (check-leaks.mjs), so they're left out here.
 */
import { liveServices, liveAddOns, optionPriceText, spasFor, spaBookingUrl, giftUrl, formatPrice, formatMinutes, PRICES_CAPTURED, type Group, type Service, type ServiceOption } from './catalog';
import { activeOffers } from './offers';
import { displayName } from './pageHelpers';
import { SITE_URL, site } from './site';
import { NAME, PHONE_DISPLAY, EMAIL, OPENED, OWNER, SKINCARE_BRAND, SAME_AS, SPA_FACTS, entitySentence } from './entity';
import { longDate } from './dates';
import { liveGuides } from './guides';

/** Menu-row-only items (see check-leaks.mjs BB_ALLOWED / ALLOW_IN): listed on /menu, not in this brief. */
export const LLMS_SKIP = new Set(['brazilian-butt', 'liposuction-massage']);

const url = (path: string) => `${SITE_URL}${path === '/' ? '/' : path.replace(/\/?$/, '/')}`;
const where = (x: Service | ServiceOption) => {
  const sp = spasFor(x);
  return sp.length === 2 ? 'both spas' : `${site.spas[sp[0]].name} only`;
};

/** "60 min $150 · 90 min $200 · 120 min $275 (San Diego only)": an option's spa is added only when it differs from the service's. */
export function optionsText(s: Service): string {
  const all = where(s);
  return s.options
    .map((o) => {
      const price = optionPriceText(o);
      const w = where(o);
      // "60 min $150"; labels with a comma or a non-$ price read better with a comma: "60 min, for two, $336", "60 to 120 min, price set at your visit"
      const sep = /,/.test(o.label) || !price.startsWith('$') ? ', ' : ' ';
      const p = price.startsWith('$') ? price : price.charAt(0).toLowerCase() + price.slice(1);
      return `${o.label}${sep}${p}${w !== all ? ` (${w})` : ''}`;
    })
    .join(' · ');
}

function serviceLine(s: Service): string {
  const name = displayName(s);
  const link = s.flagship ? `[${name}](${url(s.flagship)})` : name;
  const summary = s.summary ? ` ${s.summary.replace(/\.?$/, '.')}` : '';
  return `- ${link}: ${optionsText(s)}. ${where(s).charAt(0).toUpperCase() + where(s).slice(1)}.${summary}`;
}

const GROUPS: Array<{ group: Group; title: string; page: string }> = [
  { group: 'massage', title: 'Massage', page: '/massage' },
  { group: 'facials', title: 'Facials', page: '/facials' },
  { group: 'body', title: 'Body treatments', page: '/body' },
];

export function llmsText(): string {
  const L: string[] = [];
  L.push(`# ${NAME}`, '');
  L.push(`> ${entitySentence()} It opened in ${OPENED}. One phone number for both spas: ${PHONE_DISPLAY}.`, '');
  L.push(`Prices are the exact prices on our online booking menu (Square), in US dollars, as checked on ${longDate(PRICES_CAPTURED)}. The booking page always shows the latest price. Couples prices are for two people. This file is generated from the same data as the website.`, '');

  L.push('## Locations', '');
  for (const s of SPA_FACTS) {
    L.push(`- [${s.label}](${url(s.page)}): ${s.address}. Hours: ${s.hours}. Phone: ${s.phone}. Book online: ${spaBookingUrl(s.id)}`);
  }
  L.push('');

  L.push('## Contact and booking', '');
  L.push(`- Phone (both spas): ${PHONE_DISPLAY}`);
  L.push(`- Email: ${EMAIL}`);
  L.push(`- Book online through Square at either spa (links above), or call. Square asks for a card on file to book online.`);
  L.push(`- Cancel or reschedule at least 24 hours before your appointment; after that a $50 cancellation fee may apply. [Booking policies](${url('/policies')})`);
  L.push(`- Gift cards: eGift cards from $100 or a custom amount, sent by text or email: ${giftUrl()}`);
  L.push(`- Instagram: ${SAME_AS[0]}`);
  L.push(`- Facebook: ${SAME_AS[1]}`);
  L.push('');

  for (const g of GROUPS) {
    const list = liveServices(g.group).filter((s) => !LLMS_SKIP.has(s.id));
    if (!list.length) continue;
    L.push(`## ${g.title}`, '', `All ${g.title.toLowerCase()}: ${url(g.page)}`, '');
    for (const s of list) L.push(serviceLine(s));
    if (g.group === 'massage') {
      for (const a of liveAddOns('massage')) {
        L.push(`- Add-on, ${a.name} on any massage: ${a.options.map((o) => `${formatMinutes(o.minutes)} ${formatPrice(o.price)}`).join(' · ')}. ${where(a.options[0]).charAt(0).toUpperCase() + where(a.options[0]).slice(1)}.`);
      }
    }
    L.push('');
  }

  // Specials: approved and running today only (activeOffers also returns drafts on a PREVIEW build; never here).
  const specials = activeOffers({ kind: 'special' }).filter((o) => o.approved === true && o.price != null);
  if (specials.length) {
    L.push("## This month's specials", '');
    for (const o of specials) {
      // Spa phrase is lower-case and comma-joined ("…, at both spas."), so the line can't be read as a menu service
      // line ("…. Both spas.") by check-geo.mjs; it is checked by the specials rule instead.
      L.push(`- ${o.title}${o.minutes ? `, ${formatMinutes(o.minutes)}` : ''}: ${formatPrice(o.price)}, ${o.starts} to ${o.ends}, ${o.spa.length === 2 ? 'at both spas' : `at the ${site.spas[o.spa[0]].name} spa only`}. [Specials](${url('/specials')})`);
    }
    L.push('');
  }

  L.push('## About', '');
  L.push(`- Owner: ${OWNER}. Book any 60, 90 or 120 min massage with ${OWNER}: ${url('/massage/with-katy')}`);
  L.push('- Team: licensed massage therapists and certified estheticians.');
  L.push(`- Skincare: ${SKINCARE_BRAND} professional skincare in our facials.`);
  L.push('- Every massage starts with a short chat about your goals, the pressure you like and any health concerns.');
  L.push(`- Only the treatments listed here can be booked online. For anything else, call ${PHONE_DISPLAY}.`);
  L.push('');

  L.push('## Pages', '');
  L.push(`- [Full menu and prices](${url('/menu')}): every treatment, length, price and spa`);
  L.push(`- [Lymphatic drainage massage](${url('/massage/lymphatic-drainage')}): our most-loved treatment, with questions and answers`);
  L.push(`- [Couples massage](${url('/massage/couples')})`);
  for (const g of liveGuides()) L.push(`- [${g.label}](${url(`/guides/${g.slug}`)}): guide. ${g.summary}`);
  L.push(`- [San Diego (Mission Valley) spa](${url(site.spas.SD.page)})`);
  L.push(`- [Del Mar spa](${url(site.spas.DM.page)})`);
  L.push(`- [About us](${url('/about')})`);
  L.push(`- [Contact](${url('/contact')})`);
  L.push('');

  L.push('## Optional', '');
  L.push(`- [Specials](${url('/specials')}): monthly specials, posted at the start of each month`);
  L.push(`- [Gift cards](${url('/gift-cards')})`);
  L.push(`- [Booking policies](${url('/policies')})`);
  L.push('');
  return L.join('\n');
}
