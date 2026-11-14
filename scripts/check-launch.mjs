// Launch-switch checks over the built site (npm run test:launch; also part of npm test).
// The expected mode comes from the same switch the build used (src/lib/launch.mjs: site.json "launch", LAUNCH, PREVIEW).
//   staging: robots meta noindex, robots.txt "Disallow: /", no sitemap.xml, canonicals on the staging host,
//            _headers sends X-Robots-Tag noindex on every path.
//   launch:  robots meta "index, follow", production robots.txt + sitemap.xml, canonicals on uniquespahouse.com,
//            no staging host anywhere, X-Robots-Tag only on *.pages.dev.
// Both: _headers parses (Cloudflare rules) and its CSP hashes cover every inline script; every _redirects rule is a
// valid 301 to a page that exists in the build and doesn't shadow a real page; radio-group names and element ids are
// unique on each page. (Byte-for-byte reproducible builds: npm run test:repro.)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildMode, tempAssets, stagingUrl } from '../src/lib/launch.mjs';
import { inlineScriptHashes } from '../integrations/postbuild.mjs';

const root = new URL('..', import.meta.url).pathname;
const dist = process.env.DIST || join(root, 'dist');
const site = JSON.parse(readFileSync(join(root, 'src/data/site.json'), 'utf8'));
const MODE = buildMode(site);
const PROD = site.urls.production.replace(/\/$/, '');
const STAGING = stagingUrl(site).replace(/\/$/, '');
const STAGING_HOST = new URL(STAGING).host;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else { fail++; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); } };

// ---------------------------------------------------------------- review #3: no temp image slots in a launch build
if (MODE.launch) {
  const temp = tempAssets(JSON.parse(readFileSync(join(root, 'src/data/asset-manifest.json'), 'utf8')));
  check('launch: no asset-manifest.json slot is temp:true, photo-less or alt_todo', temp.length === 0, temp.map((a) => a.id).join(', '));
}
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const files = walk(dist);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const rel = (f) => '/' + relative(dist, f).replace(/\\/g, '/').replace(/index\.html$/, '');
const read = (f) => readFileSync(f, 'utf8');
const pageFor = (urlPath) => {
  const p = decodeURIComponent(urlPath.split(/[?#]/)[0]);
  return [join(dist, p, 'index.html'), join(dist, p)].find((c) => existsSync(c) && statSync(c).isFile());
};

// ---------------------------------------------------------------- pages: robots meta, canonical, og:url
const wantRobots = MODE.launch ? 'index, follow' : 'noindex, nofollow';
for (const f of htmlFiles) {
  const h = read(f), r = rel(f);
  const robots = [...h.matchAll(/<meta name="robots" content="([^"]*)"/g)].map((m) => m[1]);
  check(`robots meta ${r}`, robots.length === 1 && robots[0] === wantRobots, JSON.stringify(robots));
  const canon = [...h.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((m) => m[1]);
  const og = (h.match(/<meta property="og:url" content="([^"]*)"/) || [])[1];
  // The 404 page has no canonical and no og:url: it isn't a page to index, and /404/ only redirects to /404 (QA r2 N5).
  if (r === '/404.html') { check(`no canonical or og:url on ${r}`, canon.length === 0 && og === undefined, JSON.stringify([canon, og])); continue; }
  check(`one canonical on ${MODE.url} ${r}`, canon.length === 1 && canon[0].startsWith(MODE.url + '/'), JSON.stringify(canon));
  check(`og:url = canonical ${r}`, og === canon[0], og);
  if (MODE.launch && !r.endsWith('.html')) check(`canonical is the page itself ${r}`, canon[0] === PROD + r, canon[0]);
}

// ---------------------------------------------------------------- robots.txt + sitemap.xml
const robotsTxt = existsSync(join(dist, 'robots.txt')) ? read(join(dist, 'robots.txt')) : '';
const sitemapPath = join(dist, 'sitemap.xml');
if (MODE.launch) {
  check('robots.txt allows crawling', /^User-agent: \*$/m.test(robotsTxt) && /^Allow: \/$/m.test(robotsTxt) && !/^Disallow: \/$/m.test(robotsTxt), robotsTxt);
  check('robots.txt points at the production sitemap', robotsTxt.includes(`Sitemap: ${PROD}/sitemap.xml`), robotsTxt);
  check('sitemap.xml exists', existsSync(sitemapPath));
  if (existsSync(sitemapPath)) {
    const locs = [...read(sitemapPath).matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    check('sitemap lists pages', locs.length >= 10, String(locs.length));
    check('sitemap has the home page', locs.includes(PROD + '/'));
    for (const l of locs) {
      check(`sitemap URL on production host: ${l}`, l.startsWith(PROD + '/'));
      check(`sitemap URL is a built page: ${l}`, !!pageFor(l.slice(PROD.length)));
      check(`sitemap URL not a hidden page: ${l}`, !/\/(refer|rewards|404)/.test(l));
    }
  }
  // No staging host anywhere a visitor or crawler can read
  for (const f of files.filter((x) => /\.(html|xml|txt|js|json|css)$/.test(x) || /\/_(headers|redirects)$/.test(x))) {
    check(`no staging host (${STAGING_HOST}) in ${rel(f)}`, !read(f).includes(STAGING_HOST));
  }
} else {
  check('robots.txt disallows everything', /^User-agent: \*$/m.test(robotsTxt) && /^Disallow: \/$/m.test(robotsTxt), robotsTxt);
  check('robots.txt has no sitemap line', !/^Sitemap:/mi.test(robotsTxt));
  check('no sitemap.xml on staging', !existsSync(sitemapPath));
  for (const f of htmlFiles) check(`no production canonical on staging ${rel(f)}`, !read(f).includes(`href="${PROD}/`));
}

// ---------------------------------------------------------------- _headers
const headersPath = join(dist, '_headers');
check('_headers exists', existsSync(headersPath));
const rules = [];
if (existsSync(headersPath)) {
  const text = read(headersPath);
  check('_headers placeholder filled', !text.includes('{{'));
  let cur = null;
  text.split('\n').forEach((line, i) => {
    if (line.length > 2000) check(`_headers line ${i + 1} ≤ 2000 chars`, false, String(line.length));
    if (!line.trim() || line.trimStart().startsWith('#')) return;
    if (!/^\s/.test(line)) {
      const ok = /^(\/\S*|https:\/\/\S+)$/.test(line);
      check(`_headers line ${i + 1} is a path or URL`, ok, line);
      cur = { path: line, headers: {} };
      rules.push(cur);
      return;
    }
    const m = line.match(/^\s+([A-Za-z0-9-]+):\s*(.+)$/);
    check(`_headers line ${i + 1} is "Name: value" under a path`, !!m && !!cur, line);
    if (m && cur) cur.headers[m[1].toLowerCase()] = m[2];
  });
  check('_headers ≤ 100 rules', rules.length > 0 && rules.length <= 100, String(rules.length));
  const all = rules.find((r) => r.path === '/*');
  check('_headers has a /* rule', !!all);
  if (all) {
    for (const h of ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'x-frame-options', 'referrer-policy', 'permissions-policy']) {
      check(`/* sends ${h}`, !!all.headers[h]);
    }
    const csp = Object.fromEntries((all.headers['content-security-policy'] || '').split(';').map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([k, ...v]) => [k, v]));
    const script = csp['script-src'] || [];
    check('CSP script-src has no unsafe-inline / unsafe-eval', !script.includes("'unsafe-inline'") && !script.includes("'unsafe-eval'"), script.join(' '));
    const need = inlineScriptHashes(htmlFiles.map(read));
    const missing = need.filter((h) => !script.includes(h));
    check(`CSP covers all ${need.length} inline scripts`, missing.length === 0, missing.join(' '));
    check('CSP allows Cloudflare Web Analytics', script.includes('https://static.cloudflareinsights.com') && (csp['connect-src'] || []).includes('https://cloudflareinsights.com'));
    check('CSP allows the ElevenLabs voice (https + wss)', (csp['connect-src'] || []).includes('https://*.elevenlabs.io') && (csp['connect-src'] || []).includes('wss://*.elevenlabs.io'));
    // Uni voice worklets are self-hosted (public/chat/worklets): no blob:/data:/CDN script sources, no blob: workers.
    check('CSP script-src allows no blob:, data: or CDN host', !script.some((x) => /^(blob:|data:|https:\/\/cdn\.|https:$|\*)/.test(x)), script.join(' '));
    check('CSP worker-src has no blob:', !(csp['worker-src'] || []).includes('blob:'), (csp['worker-src'] || []).join(' '));
    check('CSP connect-src has no CDN host', !(csp['connect-src'] || []).some((x) => /jsdelivr|unpkg|cdnjs/.test(x)));
    for (const w of ['rawAudioProcessor.js', 'audioConcatProcessor.js', 'libsamplerate.worklet.js']) {
      check(`voice worklet self-hosted: /chat/worklets/${w}`, existsSync(join(dist, 'chat', 'worklets', w)));
    }
    check("CSP form-action 'self' (forms post to /api/lead)", (csp['form-action'] || []).join(' ') === "'self'");
    check("CSP frame-ancestors 'none'", (csp['frame-ancestors'] || []).join(' ') === "'none'");
    check('Permissions-Policy lets this site use the microphone (Uni voice)', /microphone=\(self\)/.test(all.headers['permissions-policy'] || ''));
    // Booking and gift links are plain navigations (new tab), which CSP doesn't restrict. Uni's booking card form uses
    // Square's Web Payments SDK: its script, card iframe and card-token API must be allowed, and only Square's hosts.
    const sq = (d, h) => (csp[d] || []).includes(h);
    check('CSP allows the Square card form (script, iframe, token API)', sq('script-src', 'https://web.squarecdn.com') && sq('frame-src', 'https://web.squarecdn.com') && sq('connect-src', 'https://pci-connect.squareup.com') && sq('connect-src', 'https://web.squarecdn.com'));
    check('CSP adds no wildcard script host for Square', !script.some((x) => /^https:\/\/\*\./.test(x)), script.join(' '));
    const robotsHeader = all.headers['x-robots-tag'];
    if (MODE.launch) check('launch: /* has no X-Robots-Tag', !robotsHeader, robotsHeader);
    else check('staging: /* sends X-Robots-Tag noindex', /noindex/.test(robotsHeader || ''), robotsHeader);
  }
  for (const p of ['https://:project.pages.dev/*', 'https://:version.:project.pages.dev/*']) {
    const r = rules.find((x) => x.path === p);
    check(`${p} sends X-Robots-Tag noindex`, !!r && /noindex/.test(r.headers['x-robots-tag'] || ''));
  }
}

// ---------------------------------------------------------------- _redirects
const redirectsPath = join(dist, '_redirects');
check('_redirects exists', existsSync(redirectsPath));
let redirectCount = 0;
if (existsSync(redirectsPath)) {
  const seen = new Set();
  read(redirectsPath).split('\n').forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    const parts = t.split(/\s+/);
    const [from, to, status] = parts;
    redirectCount++;
    check(`_redirects line ${i + 1}: "from to 301"`, parts.length === 3 && status === '301' && from.startsWith('/') && to.startsWith('/'), t);
    check(`_redirects line ${i + 1}: source listed once`, !seen.has(from), from);
    seen.add(from);
    check(`_redirects ${from}: doesn't shadow a real page`, !pageFor(from), from);
    check(`_redirects ${from} → ${to}: target exists in the build`, !!pageFor(to), to);
    check(`_redirects ${from} → ${to}: target is the final address (trailing slash, no second hop)`, to === '/' || to.endsWith('/'), to);
    check(`_redirects ${from}: no splat/placeholder`, !/[*:]/.test(from), from);
  });
  check('_redirects has rules', redirectCount > 0);
}

// ---------------------------------------------------------------- deterministic, unique ids
for (const f of htmlFiles) {
  const h = read(f), r = rel(f);
  const groups = [...h.matchAll(/<fieldset class="chips"[\s\S]*?<\/fieldset>/g)].map((m) => [...new Set([...m[0].matchAll(/type="radio" name="([^"]+)"/g)].map((x) => x[1]))]);
  for (const g of groups) check(`one radio-group name per chip set ${r}`, g.length === 1, g.join(','));
  const names = groups.map((g) => g[0]);
  check(`radio-group names unique ${r}`, new Set(names).size === names.length, names.join(','));
  const ids = [...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  check(`element ids unique ${r}`, dup.length === 0, [...new Set(dup)].join(','));
  for (const n of names) check(`radio-group name is deterministic ${n} ${r}`, /^len-(svc|row)-[a-z0-9-]+$/.test(n), n);
}

console.log(fail
  ? `\n✗ launch checks: ${fail} failed, ${pass} passed (${MODE.mode} build, ${MODE.url})`
  : `✓ launch checks: ${pass} passed (${MODE.mode} build, ${MODE.url}; ${htmlFiles.length} pages, ${redirectCount} redirects, ${rules.length} header rules)`);
process.exit(fail ? 1 : 0);
