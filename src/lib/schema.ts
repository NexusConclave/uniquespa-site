/**
 * JSON-LD helpers (blueprint §11) for service and spa pages. One `@graph` per page:
 *   Organization (ref) · DaySpa nodes (Del Mar without openingHours while its hours are unknown)
 *   Service + Offer at exact Square prices (live items only; no Offer for a variable price)
 *   BreadcrumbList · FAQPage only where the FAQ is visible on the page.
 * No AggregateRating, ever. Everything is generated from lib/catalog.ts and site.json.
 */
import { SITE_URL, site } from './site';
import { SPAS, bookUrl, spaBookingUrl, optionPriceText, VARIABLE_PRICE_TEXT, type Service, type Spa } from './catalog';
import { NAME, PHONE_SCHEMA, EMAIL, OPENED, SAME_AS, SKINCARE_BRAND } from './entity';

export const ORG_ID = `${SITE_URL}/#organization`;
export const spaId = (sp: Spa) => `${SITE_URL}${site.spas[sp].page}#spa`;

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export const WEBSITE_ID = `${SITE_URL}/#website`;

/**
 * The business entity (GEO): the same name, phone, email and profiles on every page, linked to both spas.
 * No alternateName: the old listing names ("Unique Med Spa", the LLC) must not be reinforced.
 */
export function orgNode() {
  return {
    '@type': 'Organization',
    '@id': ORG_ID,
    name: NAME,
    url: `${SITE_URL}/`,
    logo: `${SITE_URL}/favicon.svg`,
    description: site.description,
    telephone: PHONE_SCHEMA,
    email: EMAIL,
    foundingDate: OPENED,
    sameAs: SAME_AS,
    knowsAbout: ['Massage', 'Lymphatic drainage massage', 'Facials', 'Body wraps', `${SKINCARE_BRAND} skincare`],
  };
}

export function websiteNode() {
  return { '@type': 'WebSite', '@id': WEBSITE_ID, url: `${SITE_URL}/`, name: NAME, inLanguage: 'en-US', publisher: { '@id': ORG_ID } };
}

/** WebPage node for a page with a visible "Last reviewed" date (freshness signal for AI answers). */
export function webPageNode(path: string, name: string, opts: { dateModified?: string; about?: string; type?: string } = {}) {
  const node: Record<string, unknown> = {
    '@type': opts.type ?? 'WebPage',
    '@id': `${SITE_URL}${path}#page`,
    url: `${SITE_URL}${path}`,
    name,
    isPartOf: { '@id': WEBSITE_ID },
    about: { '@id': opts.about ?? ORG_ID },
    inLanguage: 'en-US',
  };
  if (opts.dateModified) node.dateModified = opts.dateModified;
  return node;
}

/** One spa as a DaySpa. openingHours only when the spa's hours are known (Del Mar: none yet). */
export function spaNode(sp: Spa, extra: Record<string, unknown> = {}) {
  const s = site.spas[sp];
  const node: Record<string, unknown> = {
    '@type': 'DaySpa',
    '@id': spaId(sp),
    name: `${NAME}, ${s.name}`,
    url: `${SITE_URL}${s.page}`,
    telephone: PHONE_SCHEMA,
    email: EMAIL,
    address: { '@type': 'PostalAddress', streetAddress: s.street, addressLocality: s.city, addressRegion: s.region, postalCode: s.postal, addressCountry: 'US' },
    hasMap: s.directions_url,
    currenciesAccepted: 'USD',
    parentOrganization: { '@id': ORG_ID },
    // Booking: the spa's own Square page (agents and assistants can hand people straight to it)
    potentialAction: {
      '@type': 'ReserveAction',
      target: { '@type': 'EntryPoint', urlTemplate: spaBookingUrl(sp), actionPlatform: ['https://schema.org/DesktopWebPlatform', 'https://schema.org/MobileWebPlatform'] },
      result: { '@type': 'Reservation', name: `Appointment at ${NAME}, ${s.name}` },
    },
    ...extra,
  };
  if (s.hours) node.openingHoursSpecification = [{ '@type': 'OpeningHoursSpecification', dayOfWeek: DAYS, opens: s.hours.opens, closes: s.hours.closes }];
  return node;
}

/** Offers for a live service: one per option per spa, exact price, deep link. Skips variable prices. */
export function offersFor(s: Service, onlySpa?: Spa, name = s.name) {
  return s.options.flatMap((o) =>
    SPAS.filter((sp) => (!onlySpa || sp === onlySpa) && o.locations.includes(sp))
      .map((sp) => ({ sp, url: bookUrl(o.square_id, sp) }))
      .filter(({ url }) => url && o.price != null && optionPriceText(o) !== VARIABLE_PRICE_TEXT)
      .map(({ sp, url }) => ({
        '@type': 'Offer',
        name: `${name}, ${o.label}`,
        price: (o.price as number).toFixed(2),
        priceCurrency: 'USD',
        url,
        availableAtOrFrom: { '@id': spaId(sp) },
      })),
  );
}

/** A Service node for a live service (name, description, provider, exact-price offers). */
export function serviceNode(s: Service, opts: { path?: string; name?: string; description?: string | null; onlySpa?: Spa; alternateName?: string[] } = {}) {
  const name = opts.name ?? s.name;
  const spas = SPAS.filter((sp) => (!opts.onlySpa || sp === opts.onlySpa) && s.options.some((o) => o.locations.includes(sp)));
  const node: Record<string, unknown> = {
    '@type': 'Service',
    name,
    serviceType: s.group === 'facials' ? 'Facial' : s.group === 'body' ? 'Body treatment' : 'Massage',
    provider: spas.map((sp) => ({ '@id': spaId(sp) })),
    areaServed: spas.map((sp) => ({ '@type': 'City', name: site.spas[sp].city })),
    offers: offersFor(s, opts.onlySpa, name),
  };
  if (opts.alternateName?.length) node.alternateName = opts.alternateName;   // only names the page itself shows
  const d = opts.description === undefined ? s.summary : opts.description;
  if (d) node.description = d;
  if (opts.path) { node.url = `${SITE_URL}${opts.path}`; node['@id'] = `${SITE_URL}${opts.path}#service`; }
  return node;
}

/** BreadcrumbList from visible crumbs: [{ name: 'Home', path: '/' }, …]. */
export function breadcrumbNode(items: Array<{ name: string; path: string }>) {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, name: it.name, item: `${SITE_URL}${it.path}` })),
  };
}

const strip = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

/** FAQPage, only for an FAQ rendered visibly on the same page (the Faq component shows every answer). */
export function faqNode(items: Array<{ q: string; a: string }>) {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: strip(f.a) } })),
  };
}

export function graph(...nodes: Array<Record<string, unknown> | null | undefined | false>) {
  return { '@context': 'https://schema.org', '@graph': nodes.filter(Boolean) };
}
