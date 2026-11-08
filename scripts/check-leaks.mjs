// Status-leak + compliance check over the built site (blueprint §13 "Status leak", hard rules 2–5, 7).
// Fails (exit 1) if dist HTML or our own JS mentions a consult/hold/hidden service, a medical term,
// a forbidden price/offer phrase, a result claim (review #4), a star glyph, or a page has the wrong robots meta for the build mode
// (staging: every page "noindex, nofollow"; launch: every page "index, follow" — see src/lib/launch.mjs).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildMode } from '../src/lib/launch.mjs';
import { guidesLive, guidePaths } from '../src/lib/guides-switch.mjs';

const root = new URL('..', import.meta.url).pathname;
const dist = process.env.DIST || join(root, 'dist');
const MODE = buildMode(JSON.parse(readFileSync(join(root, 'src/data/site.json'), 'utf8')));
const ROBOTS = MODE.launch ? 'index, follow' : 'noindex, nofollow';
const services = JSON.parse(readFileSync(join(root, 'src/data/services.json'), 'utf8')).services;

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}
const files = walk(dist).filter((f) => /\.(html|js|json|xml|txt)$/.test(f) && !f.endsWith('uni-voice.js')); // third-party SDK excluded

// Square ids of anything not live must never ship.
const gatedIds = services.filter((s) => s.status !== 'live').flatMap((s) => s.options.map((o) => o.square_id));

// Terms (case-insensitive unless marked). Brazilian Butt is allowed only as a menu row on these pages.
const BB_ALLOWED = ['/menu/', '/massage/', '/body/'];
const terms = [
  [/t-?shape/i, 'T-Shape'], [/t-?sculpt/i, 'T-Sculpt'], [/\bEMS\b/, 'EMS'], [/\bRF\b/, 'RF'], [/radio ?frequency/i, 'radiofrequency'],
  [/micro-?needl/i, 'microneedling'], [/\blaser/i, 'laser'], [/\bIV\b/, 'IV'], [/iv therapy|iv drip/i, 'IV therapy'],
  [/weight[- ]?loss/i, 'weight loss'], [/tirzepatide|semaglutide|ozempic|wegovy|mounjaro|glp-1/i, 'weight-loss medicine'],
  [/\bdose|dosage/i, 'dose'], [/med ?spa/i, 'med spa'], [/mesosphere/i, 'Mesosphere'], [/exosome/i, 'exosome'], [/\bPDRN\b|salmon dna/i, 'PDRN'],
  [/\bTCA\b/, 'TCA'], [/nordlys|candela/i, 'Nordlys/Candela'], [/endosph/i, 'Endosphere'], [/\bsauna/i, 'sauna'], [/botox|filler/i, 'injectables'],
  [/glac[eē]|hydro ?facial|hydrafacial/i, 'Hydro facial (hold)'], [/buccal/i, 'Buccal (hold)'], [/\bLPG\b|endermolog/i, 'LPG (hold)'],
  [/bamboo/i, 'Bamboo (hidden)'], [/liposuction|\blipo\b/i, 'Liposuction (hold until Q13)'],
  [/\breg\.|regular price|valued at|\bwas \$/i, 'former price'], [/buy \d+ get \d+/i, 'buy-get'], [/\bfree\b/i, '"free"'],
  [/[★☆⭐]/, 'star glyph'],
  [/to be named|\bTBD\b/, 'placeholder (privacy processors)'],
  // Review #4: result claims. Copy says what a treatment is and how it feels, never what it does to the body.
  [/\bpuff(?:y|iness)\b/i, 'result claim: puffy'], [/\bfeel(?:s|ing)? lighter\b|\blighter,? (?:and )?less\b/i, 'result claim: lighter'],
  [/\bsmoother\b/i, 'result claim: smoother'], [/\blifted\b/i, 'result claim: lifted'],
  [/realistic(?:\s|<[^>]*>)*results/i, 'result claim: realistic results'],
  [/\byou save\b/i, '"You save" (savings wording; staging drafts too, review #19)'],
];

let problems = 0;
for (const f of files) {
  const rel = '/' + relative(dist, f).replace(/index\.html$/, '');
  let text = readFileSync(f, 'utf8');
  // Ignore our own documentation comments in bundled JS and the noindex meta itself
  if (f.endsWith('.html')) {
    const robots = [...text.matchAll(/<meta name="robots" content="([^"]*)"/g)].map((m) => m[1]);
    if (robots.length !== 1 || robots[0] !== ROBOTS) { console.log(`ROBOTS meta (${MODE.mode}: want "${ROBOTS}", got ${JSON.stringify(robots)}): ${rel}`); problems++; }
    text = text.replace(/<!--[\s\S]*?-->/g, '');
  }
  for (const id of gatedIds) if (text.includes(id)) { console.log(`GATED SQUARE ID ${id} in ${rel}`); problems++; }
  for (const [re, name] of terms) {
    const m = text.match(re);
    if (!m) continue;
    if (/brazilian/i.test(m[0]) && BB_ALLOWED.some((p) => rel.startsWith(p))) continue;
    const i = m.index ?? 0;
    console.log(`${name.padEnd(28)} ${rel}  …${text.slice(Math.max(0, i - 50), i + 50).replace(/\s+/g, ' ')}…`);
    problems++;
  }
  if (/brazilian/i.test(text) && !BB_ALLOWED.some((p) => rel.startsWith(p))) { console.log(`Brazilian Butt outside the menu rows: ${rel}`); problems++; }
}
// Service guides gate (site.json flags.guides_live; env GUIDES=1/0). Off: not built, not linked, not in sitemap/llms.txt.
// On: every guide is built, linked from the footer and llms.txt, and (launch) listed in the sitemap.
{
  const siteJson = JSON.parse(readFileSync(join(root, 'src/data/site.json'), 'utf8'));
  const guidesData = JSON.parse(readFileSync(join(root, 'src/data/guides.json'), 'utf8'));
  const live = guidesLive(siteJson);
  const paths = guidePaths(guidesData);
  const linkRe = /(?:href="|\]\(|<loc>)[^"<)]*\/guides(?:\/|"|\))/;
  const built = paths.filter((p) => { try { return statSync(join(dist, p, 'index.html')).isFile(); } catch { return false; } });
  if (!live) {
    if (built.length) { console.log(`GUIDES OFF but built: ${built.join(', ')}`); problems++; }
    for (const f of files) {
      const t = readFileSync(f, 'utf8');
      const m = t.match(linkRe);
      if (m) { console.log(`GUIDES OFF but linked/listed in /${relative(dist, f)}: …${t.slice(Math.max(0, m.index - 40), m.index + 60).replace(/\s+/g, ' ')}…`); problems++; }
    }
  } else {
    for (const p of paths) if (!built.includes(p)) { console.log(`GUIDES ON but not built: ${p}`); problems++; }
    const home = readFileSync(join(dist, 'index.html'), 'utf8');
    if (!/href="\/guides\/"/.test(home)) { console.log('GUIDES ON but the footer has no Guides link'); problems++; }
    const llms = (() => { try { return readFileSync(join(dist, 'llms.txt'), 'utf8'); } catch { return ''; } })();
    for (const p of paths.slice(1)) {
      if (!llms.includes(`${MODE.url}${p})`)) { console.log(`GUIDES ON but llms.txt doesn't list ${p}`); problems++; }
      const linkedFrom = files.filter((f) => f.endsWith('.html') && !relative(dist, f).startsWith('guides/') && readFileSync(f, 'utf8').includes(`href="${p}"`));
      if (!linkedFrom.length) { console.log(`GUIDES ON but no service page links to ${p}`); problems++; }
    }
    if (MODE.launch) {
      const sm = (() => { try { return readFileSync(join(dist, 'sitemap.xml'), 'utf8'); } catch { return ''; } })();
      for (const p of paths) if (!sm.includes(`<loc>${MODE.url}${p}</loc>`)) { console.log(`GUIDES ON but sitemap.xml misses ${p}`); problems++; }
    }
  }
  console.log(`guides gate: ${live ? 'on' : 'off'} (${built.length}/${paths.length} guide pages built)`);
}

console.log(problems ? `\n✗ ${problems} leak/compliance problem(s) in ${files.length} files` : `✓ no status leaks or forbidden terms in ${files.length} files (${MODE.mode}: robots "${ROBOTS}")`);
process.exit(problems ? 1 : 0);
