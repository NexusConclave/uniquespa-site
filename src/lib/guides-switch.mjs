// The service-guides switch, in one place (like launch.mjs). Used by src/lib/guides.ts (pages, links, llms.txt)
// and the tests (check-leaks.mjs, check-links.mjs, check-geo.mjs; the Python tests read the same two inputs).
//
//   site.json flags.guides_live: false (default) → /guides/ is not built, nothing links to it, and it is in
//                                                  neither sitemap.xml nor llms.txt.
//   site.json flags.guides_live: true            → built, linked, listed (sitemap only on a launch build).
//
// Override for test builds: GUIDES=1 / GUIDES=0.

/**
 * @param {{ flags?: { guides_live?: boolean } }} site  contents of src/data/site.json
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function guidesLive(site, env = process.env) {
  const v = (env.GUIDES ?? '').trim().toLowerCase();
  if (v === '1' || v === 'true') return true;
  if (v === '0' || v === 'false') return false;
  return site?.flags?.guides_live === true;
}

/** "/guides/" plus "/guides/{slug}/" for every guide in src/data/guides.json (built paths, trailing slash). */
export function guidePaths(guidesData) {
  return ['/guides/', ...guidesData.guides.map((g) => `/guides/${g.slug}/`)];
}
