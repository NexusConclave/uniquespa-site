// event-schema.mjs — ONE allowlist for booking-intent events, shared by the browser (src/scripts/site.ts),
// the Cloudflare Pages Function (functions/api/event.js) and the tests (scripts/test-tracking.mjs).
//
// Rule: an event is a name from EVENTS plus a few short slugs. Nothing else can pass:
//   - on the SERVER (functions/api/event.js) every value must also be in a closed vocabulary built from the site's
//     own data and code (src/lib/event-vocab.mjs: live service ids, offer ids, placements), so even a mistake in
//     our own code can't store a name or message. The browser applies the structural rules below (the vocabulary
//     stays server-side so unpublished offer ids never ship in page JavaScript);
//   - no names, emails, phone numbers, free text, IP addresses, user agents, cookies or visitor ids;
//   - unknown keys are dropped; a value that isn't a short lowercase slug is dropped;
//   - any value with 7 or more digits is dropped (phone or card number shapes);
//   - page paths are reduced to known-shaped site paths without query strings;
//   - the referrer is reduced to a host name; campaign tags keep only utm_source/medium/campaign.
// Plain JavaScript (no imports) so Node, Vite and the Workers runtime can all load it.

export const EVENTS = Object.freeze([
  'book_click',      // a Square booking link (spa and, for deep links, service)
  'gift_card_click', // the Square eGift card link
  'call_click',      // a tel: link
  'text_click',      // an sms: link
  'chat_open',       // Uni opened
  'chat_lead',       // Uni passed a callback request to the team (channel: chat | voice); never its content
  'voice_start',     // a Uni voice call connected
  'lead_submitted',  // the contact or consultation form was sent (source, spa, interest only)
  'offer_view',      // an offer card scrolled into view
]);

export const PROP_KEYS = Object.freeze(['spa', 'service', 'placement', 'source', 'interest', 'offer', 'channel', 'amount']);
export const UTM_KEYS = Object.freeze(['utm_source', 'utm_medium', 'utm_campaign']);

const SPAS = new Set(['SD', 'DM', 'UNSURE']);
const CHANNELS = new Set(['chat', 'voice', 'form']);
const SOURCES = new Set(['website-form', 'consultation-form']);
const EXTRA_INTERESTS = ['gift', 'consultation', 'other', 'unsure'];
const AMOUNT = /^(\d{1,4}|couples|custom)$/;
const SLUG = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const HOST = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const DIGITS7 = /(?:\D*\d){7}/;
// Paths whose later segments can carry something personal (a referral code, a name) are collapsed.
const COLLAPSE = ['refer', 'rewards'];

/** A short lowercase slug, or null. "Consultation form" → "consultation-form". */
export function slug(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim().toLowerCase().replace(/\s+/g, '-');
  if (!SLUG.test(s) || DIGITS7.test(s) || s.includes('@')) return null;
  return s;
}

/** Turn the generated vocabulary module into lookup sets (server side). */
export function makeVocab(v) {
  if (!v) return null;
  return {
    service: new Set([...(v.SERVICES || []), ...(v.OFFERS || [])]), // specials book as their own Square item
    interest: new Set([...(v.SERVICES || []), ...EXTRA_INTERESTS]),
    offer: new Set(v.OFFERS || []),
    placement: new Set(v.PLACEMENTS || []),
  };
}

/**
 * Only known prop keys, each a valid slug; spa is SD | DM | UNSURE; channel is chat | voice | form; source is
 * website-form | consultation-form; amount is a gift amount (up to 4 digits) or couples | custom.
 * With a vocabulary (makeVocab), service, interest, offer and placement must also be known values.
 */
export function cleanProps(props, vocab) {
  const out = {};
  if (!props || typeof props !== 'object' || Array.isArray(props)) return out;
  for (const k of PROP_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(props, k)) continue;
    const raw = props[k];
    if (raw == null || raw === '') continue;
    if (k === 'spa') { const s = String(raw).trim().toUpperCase(); if (SPAS.has(s)) out.spa = s; continue; }
    const s = slug(raw);
    if (!s) continue;
    if (k === 'channel') { if (CHANNELS.has(s)) out.channel = s; continue; }
    if (k === 'source') { if (SOURCES.has(s)) out.source = s; continue; }
    if (k === 'amount') { if (AMOUNT.test(s)) out.amount = s; continue; }
    if (vocab && vocab[k] && !vocab[k].has(s)) continue;
    out[k] = s;
  }
  return out;
}

/** A site path like "/massage/couples/" (no query, no fragment, max 3 segments), else "/other/". */
export function cleanPath(p) {
  if (typeof p !== 'string' || !p.startsWith('/')) return '/other/';
  let path = p.split(/[?#]/)[0].toLowerCase();
  if (path === '/' || path === '') return '/';
  if (path.endsWith('.html')) path = path.replace(/(index)?\.html$/, '');
  const segs = path.split('/').filter(Boolean);
  if (segs.length && COLLAPSE.includes(segs[0])) return `/${segs[0]}/`;
  if (segs.length > 3 || !segs.every((s) => /^[a-z0-9][a-z0-9-]{0,47}$/.test(s)) || DIGITS7.test(path)) return '/other/';
  return '/' + segs.join('/') + '/';
}

/** The referring site's host name only ("www.google.com"), or null for direct visits, our own site or junk. */
export function cleanRef(ref, ownHost) {
  if (typeof ref !== 'string' || !ref) return null;
  let host;
  try { host = new URL(ref).hostname.toLowerCase(); } catch { host = String(ref).toLowerCase(); }
  host = host.replace(/^www\./, '');
  const own = typeof ownHost === 'string' ? ownHost.toLowerCase().replace(/^www\./, '') : '';
  if (!host || host === own || host.length > 80 || !HOST.test(host) || DIGITS7.test(host)) return null;
  return host;
}

/** Campaign tags from a query string or object: utm_source, utm_medium, utm_campaign only, each a slug. */
export function cleanUtm(input) {
  const out = {};
  if (!input) return out;
  let get;
  if (typeof input === 'string') { const q = new URLSearchParams(input); get = (k) => q.get(k); }
  else if (typeof input === 'object') get = (k) => input[k];
  else return out;
  for (const k of UTM_KEYS) { const s = slug(get(k)); if (s) out[k] = s; }
  return out;
}

/**
 * The whole event, cleaned. Returns null when the event name isn't allowed.
 * Shape: { e, p: {spa?, service?, placement?, source?, interest?, offer?, channel?, amount?}, path, ref?, utm? }
 * Pass a vocabulary (makeVocab) on the server.
 */
export function sanitizeEvent(input, ownHost, vocab) {
  if (!input || typeof input !== 'object') return null;
  const e = typeof input.e === 'string' ? input.e : '';
  if (!EVENTS.includes(e)) return null;
  const out = { e, p: cleanProps(input.p, vocab), path: cleanPath(input.path) };
  const ref = cleanRef(input.ref, ownHost);
  if (ref) out.ref = ref;
  const utm = cleanUtm(input.utm);
  if (Object.keys(utm).length) out.utm = utm;
  return out;
}

/** Do Not Track or Global Privacy Control is on (browser side). */
export function browserOptedOut(nav, win) {
  try {
    const n = nav || {};
    const w = win || {};
    return n.globalPrivacyControl === true || n.doNotTrack === '1' || n.doNotTrack === 'yes' || w.doNotTrack === '1' || n.msDoNotTrack === '1';
  } catch { return false; }
}

/** Do Not Track or Global Privacy Control is on (request headers, server side). */
export function headersOptedOut(headers) {
  const get = (k) => (headers && typeof headers.get === 'function' ? headers.get(k) : null);
  return get('DNT') === '1' || get('Sec-GPC') === '1';
}

/** Maximum request body the endpoint accepts (bytes). A clean event is well under 400. */
export const MAX_BODY = 1024;
