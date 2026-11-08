/**
 * Analytics switches, read once at build time. Both are OFF unless set, so staging and local builds stay clean.
 *
 *   PUBLIC_CF_ANALYTICS_TOKEN  Cloudflare Web Analytics site token (32 hex characters; public, it sits in the page).
 *                              Set → the cookieless Cloudflare beacon loads for page views and traffic sources.
 *   PUBLIC_EVENTS_ENDPOINT     Same-site path of the event counter, normally "/api/event" (functions/api/event.js).
 *                              Set → booking-intent clicks are sent there (allowlisted slugs only, src/lib/event-schema.mjs).
 *
 * Neither loads when the browser sends Do Not Track or Global Privacy Control.
 * A malformed value counts as empty (nothing renders), so a typo can't inject markup.
 */
const rawToken = String(import.meta.env.PUBLIC_CF_ANALYTICS_TOKEN ?? '').trim();
const rawEndpoint = String(import.meta.env.PUBLIC_EVENTS_ENDPOINT ?? '').trim();

export const CF_ANALYTICS_TOKEN: string = /^[a-f0-9]{32}$/i.test(rawToken) ? rawToken : '';
export const EVENTS_ENDPOINT: string = /^\/[a-z0-9/_-]{1,40}$/i.test(rawEndpoint) ? rawEndpoint : '';
export const ANALYTICS_ON: boolean = !!(CF_ANALYTICS_TOKEN || EVENTS_ENDPOINT);
