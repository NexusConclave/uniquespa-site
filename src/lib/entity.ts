/**
 * The business as one entity (GEO / AI-assistant visibility). Name, address and phone (NAP) come only from
 * src/data/site.json, so the About block, the location pages, JSON-LD and /llms.txt always say exactly the same thing.
 * Facts here mirror the owner's facts file (public subset facts/facts.public.json "business"); nothing is guessed:
 * Del Mar hours, suite and parking are unknown, so they are never stated.
 */
import { site, addressLine } from './site';
import { SPAS, type Spa } from './catalog';

export const NAME: string = site.name;                       // "Unique Spa House" — never "Unique Med Spa" or the LLC name
export const PHONE_DISPLAY: string = site.phone.display;     // (858) 293-8900, both spas
export const PHONE_E164: string = site.phone.tel.replace(/^tel:/, ''); // +18582938900
export const PHONE_SCHEMA = '+1-858-293-8900';
export const EMAIL: string = site.email;
export const OPENED = '2021';
export const OWNER = 'Katy';
export const SKINCARE_BRAND = 'BABOR';
export const SAME_AS: string[] = [site.social.instagram, site.social.facebook];
export const WHAT = 'massage, facials and body treatments';

/** One spa's NAP line exactly as every page shows it. */
export function spaFacts(sp: Spa) {
  const s = site.spas[sp];
  return {
    id: sp,
    name: `${NAME}, ${s.name}`,
    label: s.long_name,             // "San Diego (Mission Valley)" | "Del Mar"
    address: addressLine(s),        // "2650 Camino del Rio N, Suite 108, San Diego, CA 92108"
    hours: s.hours_text,            // "Mon–Sun 9 AM–8 PM" | "Call for today's hours"
    page: s.page,
    phone: s.phone.display,
  };
}

export const SPA_FACTS = SPAS.map(spaFacts);

/** One sentence that answers "What is Unique Spa House?" (used on Home, About and in llms.txt). */
export function entitySentence(): string {
  const [sd, dm] = SPA_FACTS;
  return `${NAME} is a day spa offering ${WHAT} at two locations: ${sd.label}, at ${sd.address}, and ${dm.label}, at ${dm.address}.`;
}
