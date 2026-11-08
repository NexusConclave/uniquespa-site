/** Date helpers. All offer/rating dates are calendar days in the spa's time zone (America/Los_Angeles). */
export const SPA_TZ = 'America/Los_Angeles';

/** Today's date in Los Angeles as YYYY-MM-DD. BUILD_DATE=YYYY-MM-DD overrides it (tests, previews of future months). */
export function todayLA(now: Date = new Date()): string {
  const override = process.env.BUILD_DATE;
  if (override && /^\d{4}-\d{2}-\d{2}$/.test(override)) return override;
  return new Intl.DateTimeFormat('en-CA', { timeZone: SPA_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Whole days from a to b (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000);
}

/** "2026-10-31" → "Oct 31" (adds the year when it isn't the current one). */
export function shortDate(iso: string, today: string = todayLA()): string {
  const d = new Date(iso + 'T12:00:00Z');
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  if (iso.slice(0, 4) !== today.slice(0, 4)) opts.year = 'numeric';
  return new Intl.DateTimeFormat('en-US', opts).format(d);
}

/** "2026-10-31" → "October 31, 2026" for screen readers and terms. */
export function longDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));
}
