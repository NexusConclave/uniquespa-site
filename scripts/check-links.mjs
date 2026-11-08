// Dead internal link check over dist (blueprint §13: 0 dead). Resolves /path, /path/, relative paths and #fragments.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname, posix } from 'node:path';
const dist = process.env.DIST || new URL('../dist', import.meta.url).pathname;
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const pages = walk(dist).filter((f) => f.endsWith('.html'));
const ids = new Map(pages.map((p) => [p, new Set([...readFileSync(p, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))]));
function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  const cands = [join(dist, clean), join(dist, clean, 'index.html'), join(dist, clean + '.html')];
  return cands.find((c) => existsSync(c) && statSync(c).isFile());
}
let dead = 0, checked = 0;
for (const page of pages) {
  const html = readFileSync(page, 'utf8');
  const base = '/' + relative(dist, dirname(page)).replace(/\\/g, '/');
  for (const m of html.matchAll(/\s(?:href|src|srcset)="([^"]+)"/g)) {
    for (let raw of m[1].split(',').map((s) => s.trim().split(/\s+/)[0])) {
      if (!raw || /^(https?:|mailto:|tel:|sms:|data:|javascript:)/.test(raw) || raw.startsWith('//')) continue;
      checked++;
      const [path, frag] = raw.split('#');
      const abs = path === '' ? '/' + relative(dist, page) : path.startsWith('/') ? path : posix.join(base, path);
      const file = resolveFile(abs);
      if (!file) { console.log(`DEAD  ${'/' + relative(dist, page)} → ${raw}`); dead++; continue; }
      if (frag && file.endsWith('.html') && !ids.get(file)?.has(frag)) { console.log(`DEAD#  ${'/' + relative(dist, page)} → ${raw}`); dead++; }
    }
  }
}
// Service guides: while live, every guide page must be in this crawl (so its links are checked).
{
  const { guidesLive, guidePaths } = await import('../src/lib/guides-switch.mjs');
  const root = new URL('..', import.meta.url).pathname;
  const live = guidesLive(JSON.parse(readFileSync(join(root, 'src/data/site.json'), 'utf8')));
  if (live) for (const p of guidePaths(JSON.parse(readFileSync(join(root, 'src/data/guides.json'), 'utf8')))) {
    if (!pages.includes(join(dist, p, 'index.html'))) { console.log(`MISSING guide page ${p} (guides are on)`); dead++; }
  }
}
console.log(dead ? `\n✗ ${dead} dead internal link(s) (${checked} checked)` : `✓ 0 dead internal links (${checked} checked across ${pages.length} pages)`);
process.exit(dead ? 1 : 0);
