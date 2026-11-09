// Square booking-link check (QA r2 N3). Offline: no network.
// Square answers HTTP 200 for a wrong service id (it just shows the full service list), so a link check can't catch
// a typo. This checks every Square deep link against the catalog data the repo already has:
//   1. src/data/services.json and src/data/offers.json: every square_id is in the Square snapshot
//      (src/data/square-lock.json), and every location an option lists is a location Square has it at.
//   2. dist (HTML, llms.txt, JS): every book.squareup.com/.../location/<L>/services/<ID> link uses a known
//      booking base (SD or DM), the ID is in square-lock.json and in services.json or offers.json, and the item
//      is at that location in Square.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dist = process.env.DIST || join(root, 'dist');
const json = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
const lock = json('src/data/square-lock.json');
const services = json('src/data/services.json');
const offers = json('src/data/offers.json');

let pass = 0, fail = 0;
const check = (name, ok, info = '') => { if (ok) pass++; else { fail++; console.log(`✗ ${name}${info ? ` — ${info}` : ''}`); } };

const LOCK = new Map(lock.services.map((s) => [s.id, s]));
const BASES = Object.entries(lock.booking_base).map(([spa, url]) => ({ spa, url }));
check('square-lock.json has SD and DM booking bases', BASES.some((b) => b.spa === 'SD') && BASES.some((b) => b.spa === 'DM'));

// ---------------------------------------------------------------- 1. data files
const dataIds = new Map(); // square_id -> where it is used
for (const s of [...services.services, ...(services.addons || [])]) {
  for (const o of s.options || []) {
    if (!o.square_id) continue;
    dataIds.set(o.square_id, `services.json ${s.id} ${o.label}`);
    const l = LOCK.get(o.square_id);
    check(`services.json ${s.id} ${o.label}: square_id ${o.square_id} is in square-lock.json`, !!l);
    if (l) for (const sp of o.locations || []) check(`services.json ${s.id} ${o.label}: Square has ${o.square_id} at ${sp}`, l.locations.includes(sp), l.locations.join(','));
  }
}
for (const o of offers.offers) {
  if (!o.square_id) continue;
  dataIds.set(o.square_id, `offers.json ${o.id}`);
  const l = LOCK.get(o.square_id);
  check(`offers.json ${o.id}: square_id ${o.square_id} is in square-lock.json`, !!l);
  if (l) for (const sp of o.spa || []) check(`offers.json ${o.id}: Square has ${o.square_id} at ${sp}`, l.locations.includes(sp), l.locations.join(','));
}
check('services.json has Square ids to check', dataIds.size >= 30, dataIds.size);

// ---------------------------------------------------------------- 2. built links
if (!existsSync(dist)) {
  check(`dist exists (run npm run build first): ${dist}`, false);
} else {
  const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
  const files = walk(dist).filter((f) => /\.(html|txt|js|json|xml)$/.test(f));
  let links = 0, deep = 0;
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/https:\/\/book\.squareup\.com\/[^\s"'<>)\\`&]+/g)) {
      const u = m[0].replace(/[.,;]+$/, '').split(/[?#]/)[0].replace(/\/$/, '');
      links++;
      const where = `${'/' + relative(dist, f)}: ${u}`;
      const base = BASES.find((b) => u === b.url || u.startsWith(b.url + '/'));
      check(`Square link uses a known booking base (${where})`, !!base);
      if (!base || u === base.url) continue;
      deep++;
      const id = u.slice(base.url.length + 1);
      const l = LOCK.get(id);
      check(`Square link id is in square-lock.json (${where})`, /^[A-Z0-9]{24}$/.test(id) && !!l, id);
      check(`Square link id is in services.json or offers.json (${where})`, dataIds.has(id), id);
      if (l) check(`Square link item is offered at ${base.spa} (${where})`, l.locations.includes(base.spa), l.locations.join(','));
    }
  }
  check('built site has Square deep links to check', deep >= 20, deep);
  console.log(`  (${links} Square links in dist, ${deep} deep links)`);
}

console.log(fail ? `\n✗ Square ids: ${fail} failed, ${pass} passed` : `✓ Square ids: ${pass} passed (every deep link's service id is in the catalog and offered at that spa)`);
process.exit(fail ? 1 : 0);
