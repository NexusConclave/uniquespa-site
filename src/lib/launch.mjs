// The launch switch, in one place. Used by astro.config.mjs (site URL, postbuild), src/lib/site.ts (canonical,
// robots meta) and the tests (check-leaks.mjs, check-launch.mjs), so the build and its checks always agree.
//
//   site.json "launch": false  → staging  (default): canonical = the staging host, noindex everywhere,
//                                 robots.txt "Disallow: /", no sitemap.xml, X-Robots-Tag: noindex on every response.
//   site.json "launch": true   → launch: canonical https://uniquespahouse.com, pages indexable, production robots.txt
//                                 and sitemap.xml; *.pages.dev (previews) still answer X-Robots-Tag: noindex.
//
// Overrides for test builds: LAUNCH=1 / LAUNCH=0. PREVIEW=1 (drafts render) always builds staging.
// Staging host: env STAGING_URL (an https:// origin, e.g. a private staging server) or else site.json urls.staging
// (the Cloudflare Pages project address). The public repo names no private staging host.

/**
 * @param {{ launch?: boolean, urls: { staging: string, production: string } }} site  contents of src/data/site.json
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ launch: boolean, mode: 'launch' | 'staging', url: string }}
 */
export function buildMode(site, env = process.env) {
  const v = (env.LAUNCH ?? '').trim().toLowerCase();
  let launch = v === '1' || v === 'true' ? true : v === '0' || v === 'false' ? false : site.launch === true;
  if (env.PREVIEW === '1') launch = false; // draft offers/reviews never go out on an indexable build
  const url = (launch ? site.urls.production : stagingUrl(site, env)).replace(/\/+$/, '');
  return { launch, mode: launch ? 'launch' : 'staging', url };
}

/**
 * The staging origin: env STAGING_URL when set (must be an https:// origin), else site.json urls.staging.
 * @param {{ urls: { staging: string } }} site
 * @param {Record<string, string | undefined>} [env]
 */
export function stagingUrl(site, env = process.env) {
  const v = (env.STAGING_URL ?? '').trim();
  if (!v) return site.urls.staging;
  let u;
  try { u = new URL(v); } catch { throw new Error(`[launch] STAGING_URL is not a URL: ${v}`); }
  if (u.protocol !== 'https:' || u.pathname !== '/' || u.search || u.hash) throw new Error(`[launch] STAGING_URL must be an https:// origin with no path: ${v}`);
  return u.origin;
}

/**
 * Launch gate for interim images (review #3). A launch build must not ship any asset-manifest.json entry still
 * marked temp:true (TEMP stock crops, CSS placeholders standing in for shoot photos). Staging and PREVIEW builds
 * keep working with the TEMP set. Also blocked, so a half-done photo swap can't slip through:
 *   - "temp": false but no `file` (or a `variants` entry with no `file`): the page would still show the placeholder;
 *   - an `alt_todo` note: the alt text is known to be wrong for the final photo (e.g. it describes the interim image).
 * @param {{ assets: Array<{ id: string, file?: string | null, temp?: boolean, replace_with?: string, use?: string, alt_todo?: string, variants?: Record<string, { file?: string | null }> }> }} manifest
 * @returns {Array<{ id: string, file: string, replace_with: string }>}
 */
export function tempAssets(manifest) {
  const out = [];
  for (const a of manifest.assets || []) {
    const replace_with = a.replace_with || '(not set)';
    const variants = a.variants ? Object.entries(a.variants) : null;
    const fileText = variants
      ? variants.map(([k, v]) => `${k}: ${v.file || 'no file'}`).join(', ')
      : a.file || '(no file: CSS/typographic placeholder)';
    if (a.temp === true) { out.push({ id: a.id, file: fileText, replace_with }); continue; }
    const missing = variants ? variants.filter(([, v]) => !v.file).map(([k]) => k) : a.file ? [] : ['file'];
    if (missing.length) out.push({ id: a.id, file: `"temp": false but no photo (${missing.join(', ')})`, replace_with });
    else if (a.alt_todo) out.push({ id: a.id, file: `alt text to fix: ${a.alt_todo}`, replace_with });
  }
  return out;
}

/**
 * Throws with a readable list of the temp slots when `mode.launch` is on. Called from astro.config.mjs, so a launch
 * build stops before anything is generated.
 * @param {{ launch: boolean }} mode
 * @param {Parameters<typeof tempAssets>[0]} manifest
 */
export function assertLaunchAssets(mode, manifest) {
  if (!mode.launch) return;
  const temp = tempAssets(manifest);
  if (!temp.length) return;
  const lines = temp.map((a) => `  - ${a.id.padEnd(20)} ${a.file}  → replace with: ${a.replace_with}`);
  throw new Error(
    `LAUNCH BLOCKED: ${temp.length} image slot(s) in src/data/asset-manifest.json are not launch-ready (temp:true, no photo, or alt to fix).\n` +
    `A launch build (site.json "launch": true or LAUNCH=1) may not ship interim images. Replace each with its shoot ` +
    `photo, set "temp": false, fix its alt (remove any "alt_todo"), and delete the TEMP file:\n${lines.join('\n')}\n` +
    `(Staging and PREVIEW=1 builds are not affected.)`,
  );
}
