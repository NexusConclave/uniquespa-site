/** Site facts (phones, addresses, hours, rating line) and build flags. */
import site from '../data/site.json';
import type { Spa } from './catalog';
import { todayLA, daysBetween } from './dates';
import { buildMode } from './launch.mjs';

export { site };
export type SpaInfo = (typeof site.spas)['SD'] | (typeof site.spas)['DM'];

/** Staging builds run with PREVIEW=1: draft offers and unapproved reviews render, each marked as a draft. */
export const PREVIEW: boolean = process.env.PREVIEW === '1';

export function spa(id: Spa): SpaInfo {
  return site.spas[id];
}

/** Launch switch (site.json "launch", see lib/launch.mjs): false = staging (noindex, staging host), true = live. */
const MODE = buildMode(site);
export const LAUNCH: boolean = MODE.launch;
/** Canonical origin, no trailing slash: the staging host (site.json urls.staging or env STAGING_URL) on staging, https://uniquespahouse.com once launched. */
export const SITE_URL: string = MODE.url;
/** Robots meta for every page: staging is never indexed. */
export const ROBOTS: string = LAUNCH ? 'index, follow' : 'noindex, nofollow';

// QA m-20: the /refer share message carries SITE_URL. Referral can't go live while that's still the staging host.
if (site.flags.refer_live && !LAUNCH) {
  throw new Error('[site] refer_live is on but this is a staging build (site.json "launch" is false): the share link would point at the staging host.');
}

/** The rating line shows only while its dated screenshot is under max_age_days old (build-time half; the client re-checks). */
export function ratingVisible(today: string = todayLA()): boolean {
  const r = site.rating;
  if (!r.rating_checked) return false;
  return daysBetween(r.rating_checked, today) <= r.max_age_days;
}

/** ISO date after which the rating line must hide (for the client-side check). */
export function ratingExpires(): string {
  const d = new Date(site.rating.rating_checked + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + site.rating.max_age_days);
  return d.toISOString().slice(0, 10);
}

/** One-line address. */
export function addressLine(s: SpaInfo): string {
  return `${s.street}, ${s.city}, ${s.region} ${s.postal}`;
}
