// GEO / AI-assistant visibility checks over the built site (npm run test:geo; also part of npm test).
//   1. /llms.txt: llmstxt.org shape, links are built pages, every price matches the owner's facts file
//      (facts/facts.public.json, the public subset made by scripts/make-public-facts.mjs; FACTS_JSON=path overrides,
//      e.g. the owner's full file) in both directions, no gated treatment names.
//   2. JSON-LD on every page parses; no AggregateRating/Review; every {"@id"} reference resolves on the page;
//      FAQPage questions are visible on the page; every Offer price matches facts.json; Organization and DaySpa
//      name/address/phone are identical everywhere (from site.json).
//   3. Name/address/phone: no old or wrong variants anywhere a visitor or crawler reads (HTML, llms.txt).
//   4. Answer-first blocks ([data-geo="answers"]) on the key pages, each question in that page's FAQPage, every $
//      amount a facts.json price; the About entity block shows the exact NAP.
//   5. robots.txt: launch names the AI crawlers with Allow (never Disallow: /); staging stays "Disallow: /" for all.
//   6. Wording: no result or medical claims, no "free / value / save / regular price" in what GEO adds
//      (llms.txt, robots.txt, JSON-LD outside FAQ answers, answer and entity blocks).
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { buildMode, stagingUrl } from '../src/lib/launch.mjs';
import { guidesLive, guidePaths } from '../src/lib/guides-switch.mjs';

const root = new URL('..', import.meta.url).pathname;
const dist = process.env.DIST || join(root, 'dist');
const site = JSON.parse(readFileSync(join(root, 'src/data/site.json'), 'utf8'));
const services = JSON.parse(readFileSync(join(root, 'src/data/services.json'), 'utf8')).services;
const MODE = buildMode(site);
const BASE = MODE.url;

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else { fail++; console.log(`✗ ${name}${detail ? ' — ' + String(detail).slice(0, 300) : ''}`); } };
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const read = (f) => readFileSync(f, 'utf8');
const files = walk(dist);
const htmlFiles = files.filter((f) => f.endsWith('.html'));
const rel = (f) => '/' + relative(dist, f).replace(/\\/g, '/').replace(/index\.html$/, '');
const pageFor = (urlPath) => {
  const p = decodeURIComponent(urlPath.split(/[?#]/)[0]);
  return [join(dist, p, 'index.html'), join(dist, p)].find((c) => existsSync(c) && statSync(c).isFile());
};
const decode = (t) => t.replace(/&#39;|&#x27;|&apos;/g, "'").replace(/&quot;|&#34;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;|&#160;/g, ' ');
const visibleText = (h) => decode(h.replace(/<script\b[\s\S]*?<\/script>/gi, ' ').replace(/<style\b[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').replace(/ ([,.;:!?)])/g, '$1');

// ---------------------------------------------------------------- facts (the owner's one source of prices)
// The repo holds only the public subset (facts/facts.public.json). FACTS_JSON=path checks against another copy,
// e.g. the owner's full file. Both have the same services / special / policies / gift_cards shape.
const factsPath = process.env.FACTS_JSON || join(root, 'facts', 'facts.public.json');
const facts = existsSync(factsPath) ? JSON.parse(read(factsPath)) : null;
if (!facts) console.log(`! facts.json not found at ${factsPath} (set FACTS_JSON): price checks fall back to src/data/services.json`);

/** Site display name → facts.json service ids. A new live service must be added here, or the checks fail. */
const NAME_TO_FACTS = {
  'Swedish massage': ['swedish'], 'Deep tissue massage': ['deep-tissue'], 'Therapeutic massage': ['therapeutic'],
  'Sports massage': ['sports', 'sports-stretching'], 'Lymphatic drainage massage': ['lymphatic'], 'Relaxing massage': ['relaxing'],
  'Hot stone massage': ['hot-stone'], 'Thai massage': ['tai'], 'Prenatal massage': ['prenatal'], 'Postnatal massage': ['postnatal'],
  'Anti-cellulite massage': ['anti-cellulite'], 'Foot massage': ['foot'], 'Couples massage': ['couples-60', 'couples-90'],
  'Massage with Katy, owner': ['katy-any-massage'], 'Brazilian butt massage': ['brazilian-butt'], 'Liposuction massage': ['liposuction-massage'],
  'BABOR Sculpt & Lift ritual': ['babor-sculpt-lift'], 'BABOR Deep Cleanse & Glow ritual': ['babor-deep-cleanse-glow'],
  'Signature custom facial': ['signature-custom-facial'], 'Pure Cleanse and Rebalance facial': ['pure-cleanse-rebalance'],
  'Deep express hydration': ['deep-express-hydration'], 'Sculpture face massage': ['ciocco-sculpture-face-massage'],
  'Face massage sculpture and lifting': ['face-massage-sculpture-lifting'], 'Wrap Me Up body wrap': ['wrap-me-up', 'wrap-me-up-massage'],
  'Add-on, hot stones or cupping on any massage': ['addon-hot-stones-cupping'],
};
/** facts.json services that llms.txt leaves out on purpose (menu-row-only, or not on the booking menu). */
const LLMS_NOT_LISTED = new Set(['brazilian-butt', 'liposuction-massage', 'addon-aromatherapy']);
const SPA_NAME = { SD: 'San Diego', DM: 'Del Mar' };

/** Flat facts options: { fid, minutes, price, variable, locs:Set } */
function factsOptions() {
  if (facts) {
    return facts.services.flatMap((s) => s.options.map((o) => ({
      fid: s.id, minutes: o.minutes ?? null, price: o.price ?? null,
      variable: !!(o.price_from || /varies/i.test(o.price_note || '')), locs: new Set(o.locations),
    })));
  }
  // fallback: services.json under the facts ids (only the services this test maps)
  const byName = Object.fromEntries(services.map((s) => [s.name, s]));
  return Object.entries(NAME_TO_FACTS).flatMap(([n, fids]) => (byName[n]?.options || []).map((o) => ({ fid: fids[0], minutes: o.minutes, price: o.price, variable: o.price == null, locs: new Set(o.locations) })));
}
const FOPTS = factsOptions();
const FACT_PRICES = new Set(FOPTS.map((o) => o.price).filter((p) => p != null));
const SPECIALS = facts?.special?.items ?? [];
SPECIALS.forEach((i) => FACT_PRICES.add(i.price));
const OTHER_AMOUNTS = new Set([facts?.policies?.cancellation_fee ?? 50, ...(facts?.gift_cards?.amounts ?? [100])]);

/** Minutes a label means: "60 min", "60 min, for two" → 60; "2 hr, with 60 min massage" → 120; "90 min with stretching" → 90. */
function labelMinutes(label) {
  const hr = label.match(/^(\d+)\s*hr(?:\s*(\d+)\s*min)?/);
  if (hr) return Number(hr[1]) * 60 + Number(hr[2] || 0);
  const m = label.match(/^(?:about\s+)?(\d+)\s*(?:to\s*\d+\s*)?(min|hours?)/);
  if (!m) return null;
  return /hour/.test(m[2]) ? Number(m[1]) * 60 : Number(m[1]);
}
/** A facts option with the same minutes, price (or variable) and spas. Marks it used. */
const used = new Set();
function matchFacts(name, label, price, spas) {
  const fids = NAME_TO_FACTS[name];
  if (!fids) return { ok: false, why: `no facts mapping for "${name}"` };
  const mins = labelMinutes(label);
  const cands = FOPTS.filter((o) => fids.includes(o.fid));
  const hit = cands.find((o) => {
    if (price === 'variable') { if (!o.variable) return false; }
    else if (o.price !== price) return false;
    if (o.minutes != null && mins != null && o.minutes !== mins) return false;
    if (spas && [...spas].some((sp) => !o.locs.has(sp))) return false;
    return true;
  });
  if (hit) used.add(hit);
  return hit ? { ok: true, hit } : { ok: false, why: `${name} / ${label} / ${price} / ${spas ? [...spas].join('+') : '-'} not in facts (${cands.map((o) => `${o.minutes}:${o.price}:${[...o.locs].join('+')}`).join(', ')})` };
}

// ---------------------------------------------------------------- wording rules
const BANNED_COMMERCE = /\bfree\b|\bvalue[sd]?\b|\bsav(?:e|es|ed|ing|ings)\b|regular price|\breg\.|\bwas \$|valued at|complimentary/i;
const CLAIMS = /\b(cures?|heal(?:s|ing)?|detox\w*|lose weight|weight[- ]?loss|burns? fat|fat[- ]loss|slimm\w*|inch(?:es)? loss|reduc\w* (?:swelling|cellulite|fat|inflammation|bloating|water retention|puffiness)|boosts? (?:your )?immun\w*|immune system|flush\w* (?:out )?toxins|toxins|guarantee\w*|clinically|proven|lymphedema|lipedema|post-?op\w*|treats? (?:pain|injur\w*|conditions?)|pain relief|relieves? pain|anti-?aging results|medical[- ]grade)\b/i;
const HOLD = /hydro ?facial|glass skin glow|glac[eē]|buccal|\bLPG\b|endermolog/i;
const GATED_NAMES = services.filter((s) => s.status !== 'live').map((s) => s.name);
function wording(where, text, { claims = true } = {}) {
  const c = text.match(BANNED_COMMERCE);
  check(`no free/value/save/regular-price wording in ${where}`, !c, c && text.slice(Math.max(0, c.index - 60), c.index + 60));
  if (claims) {
    const m = text.match(CLAIMS);
    check(`no result or medical claim in ${where}`, !m, m && text.slice(Math.max(0, m.index - 60), m.index + 60));
  }
  const h = text.match(HOLD);
  check(`no on-hold treatment named in ${where}`, !h, h && h[0]);
  for (const n of GATED_NAMES) check(`no gated service name "${n}" in ${where}`, !text.toLowerCase().includes(n.toLowerCase()));
}

// ---------------------------------------------------------------- 1. llms.txt
const llmsPath = join(dist, 'llms.txt');
check('llms.txt exists', existsSync(llmsPath));
const llms = existsSync(llmsPath) ? read(llmsPath) : '';
if (llms) {
  check('llms.txt starts with "# Unique Spa House"', llms.startsWith(`# ${site.name}\n`));
  check('llms.txt has a > summary', /^> .{40,}/m.test(llms));
  check('llms.txt has H2 sections', (llms.match(/^## /gm) || []).length >= 5);
  check('llms.txt is under 20 KB', Buffer.byteLength(llms) < 20000, Buffer.byteLength(llms));
  for (const sp of ['SD', 'DM']) {
    const s = site.spas[sp];
    check(`llms.txt has the ${s.name} address`, llms.includes(`${s.street}, ${s.city}, ${s.region} ${s.postal}`));
  }
  check('llms.txt has the phone', llms.includes(site.phone.display));
  // links: internal ones are built pages on this build's host
  for (const m of llms.matchAll(/\]\((https?:\/\/[^)]+)\)|(?:^|\s)(https?:\/\/\S+)/gm)) {
    const u = (m[1] || m[2]).replace(/[.,)]$/, '');
    if (u.startsWith(BASE + '/')) check(`llms.txt link is a built page: ${u}`, !!pageFor(u.slice(BASE.length)));
    else check(`llms.txt external link is a known host: ${u}`, /^https:\/\/(book\.squareup\.com|app\.squareup\.com|www\.instagram\.com|facebook\.com)\//.test(u));
    if (MODE.launch) check(`llms.txt link not on staging: ${u}`, !u.includes(new URL(stagingUrl(site)).host));
  }
  // prices, both ways
  let lines = 0;
  for (const line of llms.split('\n')) {
    const m = line.match(/^- (?:\[([^\]]+)\]\([^)]+\)|([^:[]+)): (.+?)\. (Both spas|San Diego only|Del Mar only)\./);
    if (!m) continue;
    lines++;
    const name = m[1] || m[2];
    const svcSpas = m[4] === 'Both spas' ? new Set(['SD', 'DM']) : new Set([m[4].startsWith('San') ? 'SD' : 'DM']);
    for (const part of m[3].split(' · ')) {
      const p = part.match(/^(.+?),? (\$[\d,]+|price set at your visit)(?: \((San Diego|Del Mar) only\))?$/);
      check(`llms.txt option parses: ${name} / ${part}`, !!p, part);
      if (!p) continue;
      const price = p[2].startsWith('$') ? Number(p[2].slice(1).replace(/,/g, '')) : 'variable';
      const spas = p[3] ? new Set([p[3] === 'San Diego' ? 'SD' : 'DM']) : svcSpas;
      const r = matchFacts(name, p[1], price, spas);
      check(`llms.txt price matches facts.json: ${name} ${part}`, r.ok, r.why);
    }
  }
  check('llms.txt lists services', lines >= 15, lines);
  if (facts) {
    for (const o of FOPTS.filter((x) => !LLMS_NOT_LISTED.has(x.fid))) {
      check(`facts.json option is in llms.txt: ${o.fid} ${o.minutes ?? ''} ${o.price ?? ''}`, used.has(o));
    }
  }
  // specials: only facts.json specials, inside their dates
  const sp = llms.split(/^## /m).find((x) => x.startsWith("This month's specials"));
  if (sp) for (const m of sp.matchAll(/^- (.+?): \$(\d+), (\d{4}-\d\d-\d\d) to (\d{4}-\d\d-\d\d)/gm)) {
    const hit = SPECIALS.find((i) => i.price === Number(m[2]) && m[3] >= facts.special.start && m[4] <= facts.special.end);
    check(`llms.txt special matches facts.json: ${m[1]}`, !!hit);
  }
  // every $ amount is a facts price, the cancellation fee or a gift card amount
  for (const m of llms.matchAll(/\$(\d[\d,]*)/g)) {
    const n = Number(m[1].replace(/,/g, ''));
    check(`llms.txt amount $${n} comes from facts.json`, FACT_PRICES.has(n) || OTHER_AMOUNTS.has(n));
  }
  wording('llms.txt', llms);
}

// ---------------------------------------------------------------- 2. JSON-LD
const ORG_ID = `${BASE}/#organization`;
const spaIdOf = (sp) => `${BASE}${site.spas[sp].page.replace(/\/?$/, '/')}#spa`;
const ADDR = Object.fromEntries(['SD', 'DM'].map((sp) => { const s = site.spas[sp]; return [sp, { '@type': 'PostalAddress', streetAddress: s.street, addressLocality: s.city, addressRegion: s.region, postalCode: s.postal, addressCountry: 'US' }]; }));
const PHONE = '+1-858-293-8900';
const nodesOf = (data) => (Array.isArray(data) ? data : [data]).flatMap((d) => (d && d['@graph'] ? d['@graph'] : [d]));
function* deepObjects(x) { if (x && typeof x === 'object') { yield x; for (const v of Object.values(x)) yield* deepObjects(v); } }

let ldBlocks = 0, offersChecked = 0, faqPages = 0;
const pageFaq = {};
for (const f of htmlFiles) {
  const h = read(f), r = rel(f);
  const blocks = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const nodes = [];
  for (const b of blocks) {
    ldBlocks++;
    let data = null;
    try { data = JSON.parse(b); } catch (e) { check(`JSON-LD parses on ${r}`, false, e.message); continue; }
    check(`JSON-LD has @context schema.org on ${r}`, data['@context'] === 'https://schema.org');
    nodes.push(...nodesOf(data));
  }
  if (!nodes.length) continue;
  const all = [...deepObjects(nodes)];
  const types = all.map((o) => o['@type']).flat().filter(Boolean);
  check(`no AggregateRating/Review in JSON-LD on ${r}`, !types.some((t) => /Rating|Review/.test(t)) && !all.some((o) => 'aggregateRating' in o || 'review' in o || 'ratingValue' in o));
  const ids = new Set(all.filter((o) => Object.keys(o).length > 1 && o['@id']).map((o) => o['@id']));
  for (const o of all) {
    if (Object.keys(o).length === 1 && o['@id']) check(`@id reference resolves on ${r}: ${o['@id']}`, ids.has(o['@id']));
  }
  for (const id of ids) check(`@id on this build's host (${r}): ${id}`, id.startsWith(BASE + '/'));
  // Organization + DaySpa: identical NAP everywhere
  for (const o of all.filter((x) => x['@type'] === 'Organization')) {
    check(`Organization @id/name/phone on ${r}`, o['@id'] === ORG_ID && o.name === site.name && o.telephone === PHONE, JSON.stringify([o['@id'], o.name, o.telephone]));
    check(`Organization has email and both profiles on ${r}`, o.email === site.email && JSON.stringify(o.sameAs) === JSON.stringify([site.social.instagram, site.social.facebook]));
    check(`Organization has no alternate (old) name on ${r}`, !('alternateName' in o) && !('legalName' in o));
  }
  for (const o of all.filter((x) => x['@type'] === 'DaySpa')) {
    const sp = ['SD', 'DM'].find((k) => o['@id'] === spaIdOf(k));
    check(`DaySpa @id is a known spa on ${r}`, !!sp, o['@id']);
    if (!sp) continue;
    check(`DaySpa ${sp} name on ${r}`, o.name === `${site.name}, ${site.spas[sp].name}`, o.name);
    check(`DaySpa ${sp} phone on ${r}`, o.telephone === PHONE, o.telephone);
    check(`DaySpa ${sp} address = site.json on ${r}`, JSON.stringify(o.address) === JSON.stringify(ADDR[sp]), JSON.stringify(o.address));
    check(`DaySpa ${sp} belongs to the Organization on ${r}`, o.parentOrganization?.['@id'] === ORG_ID);
    const target = o.potentialAction?.target?.urlTemplate || '';
    check(`DaySpa ${sp} ReserveAction goes to its own Square page on ${r}`, o.potentialAction?.['@type'] === 'ReserveAction' && target.startsWith('https://book.squareup.com/') && target.includes(sp === 'SD' ? 'LWTMBRFFB1D7G' : 'LXYVNKXTR50S3'), target);
    check(`DaySpa ${sp} hours only when known on ${r}`, site.spas[sp].hours ? !!o.openingHoursSpecification : !o.openingHoursSpecification);
  }
  // Offers: price matches facts.json for that spa
  for (const o of all.filter((x) => x['@type'] === 'Offer')) {
    offersChecked++;
    const sp = ['SD', 'DM'].find((k) => o.availableAtOrFrom?.['@id'] === spaIdOf(k));
    const name = Object.keys(NAME_TO_FACTS).filter((n) => o.name === n || o.name.startsWith(n + ', ')).sort((a, b) => b.length - a.length)[0];
    const price = Number(o.price);
    check(`Offer in USD with a spa on ${r}: ${o.name}`, o.priceCurrency === 'USD' && !!sp);
    if (!name) {
      const special = SPECIALS.find((i) => i.price === price && (i.aliases || []).concat(i.name).some((a) => o.name.toLowerCase().includes(a.toLowerCase().replace(/, \d+ min$/, ''))));
      check(`Offer is a facts.json special on ${r}: ${o.name}`, !!special);
      continue;
    }
    const label = o.name.slice(name.length + 2);
    const res = matchFacts(name, label, price, sp ? new Set([sp]) : null);
    check(`Offer price matches facts.json on ${r}: ${o.name} $${price} ${sp}`, res.ok, res.why);
  }
  // FAQPage: visible questions only
  const vis = visibleText(h);
  for (const fq of all.filter((x) => x['@type'] === 'FAQPage')) {
    faqPages++;
    pageFaq[r] = fq.mainEntity.map((q) => q.name);
    for (const q of fq.mainEntity) {
      check(`FAQ question visible on ${r}: ${q.name}`, vis.includes(q.name));
      const a = (q.acceptedAnswer?.text || '').replace(/\s+/g, ' ').replace(/ ([,.;:!?)])/g, '$1');
      check(`FAQ answer visible on ${r}: ${q.name}`, vis.includes(a.slice(0, 60)), a.slice(0, 60));
    }
    check(`FAQ questions unique on ${r}`, new Set(pageFaq[r]).size === pageFaq[r].length);
  }
  // Wording of the JSON-LD the GEO work adds (everything except FAQ answers, which repeat visible page copy)
  const nonFaq = nodes.filter((n) => n['@type'] !== 'FAQPage' && n['@type'] !== 'Service');
  wording(`JSON-LD (entity nodes) on ${r}`, JSON.stringify(nonFaq));
  const svc = nodes.filter((n) => n['@type'] === 'Service').map((n) => [n.name, n.description, ...(n.alternateName || [])].join(' ')).join(' ');
  if (svc) wording(`JSON-LD (Service names/descriptions) on ${r}`, svc, { claims: false });
}
check('JSON-LD found', ldBlocks >= 12, ldBlocks);
check('Offers checked against facts.json', offersChecked >= 30, offersChecked);

// ---------------------------------------------------------------- 3. NAP variants anywhere a visitor or crawler reads
const WRONG = [/Unique Med Spa/i, /Unique Massage LLC/i, /Camino del Rio S\b|Camino del Rio South/i, /Camino Del Rio North/, /2667 Camino/i, /\b92101\b/];
const PHONE_RE = /\(\d{3}\)\s?\d{3}-\d{4}|\b\d{3}[-.]\d{3}[-.]\d{4}\b/g;
for (const f of [...htmlFiles, llmsPath].filter((x) => existsSync(x))) {
  let t = f.endsWith('.html') ? visibleText(read(f)) : read(f);
  // Gift kit fix 6: /gift-cards may name Square's legal name in exactly this one sentence (site.json square_gift_name).
  if (site.square_gift_name && rel(f).startsWith('/gift-cards')) t = t.split(`It shows the name ${site.square_gift_name}.`).join('');
  // Owner decision 7 Nov 2026 (Ian and Katy; lawyer review pending): /med-spa/ may name the separate business
  // Unique Med Spa (Unique Med Spa Aesthetics Inc). Exact, case-sensitive strings on that one page only;
  // "Unique Med Spa" anywhere else is still a wrong NAP variant of Unique Spa House.
  if (rel(f) === '/med-spa/') t = t.split('Unique Med Spa Aesthetics Inc').join('').split('Unique Med Spa').join('');
  for (const re of WRONG) { const m = t.match(re); check(`no wrong NAP variant ${re} in ${rel(f)}`, !m, m && t.slice(Math.max(0, m.index - 40), m.index + 40)); }
  const phones = [...new Set(t.match(PHONE_RE) || [])];
  check(`only the spa phone number in ${rel(f)}`, phones.every((p) => p === site.phone.display), phones.join(', '));
  if (f.endsWith('.html')) {
    const tels = [...new Set([...read(f).matchAll(/href="tel:([^"]+)"/g)].map((m) => m[1]))];
    check(`tel: links all +18582938900 in ${rel(f)}`, tels.every((x) => x === '+18582938900'), tels.join(', '));
  }
}

// ---------------------------------------------------------------- 4. answer-first and entity blocks
const GUIDES_ON = guidesLive(site);
const GUIDE_PAGES = GUIDES_ON ? guidePaths(JSON.parse(read(join(root, 'src/data/guides.json')))).slice(1) : [];
const ANSWER_PAGES = ['/', '/massage/lymphatic-drainage/', '/locations/san-diego/', '/locations/del-mar/', ...GUIDE_PAGES];
for (const p of ANSWER_PAGES) {
  const f = pageFor(p);
  check(`page exists ${p}`, !!f);
  if (!f) continue;
  const h = read(f);
  const block = (h.match(/<div class="qa"[^>]*data-geo="answers"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>\s*<\/section>/) || h.match(/data-geo="answers"[\s\S]*?<\/section>/) || [''])[0];
  check(`answer-first block on ${p}`, !!block);
  const qs = [...block.matchAll(/<h3 class="qa__q"[^>]*>([\s\S]*?)<\/h3>/g)].map((m) => decode(m[1].replace(/<[^>]+>/g, '')).trim());
  check(`answer-first block has 2+ questions on ${p}`, qs.length >= 2, qs.length);
  for (const q of qs) check(`answer-first question is in FAQPage on ${p}: ${q}`, (pageFaq[p] || []).includes(q));
  const text = visibleText(block);
  for (const m of text.matchAll(/\$(\d[\d,]*)/g)) {
    const n = Number(m[1].replace(/,/g, ''));
    check(`answer amount $${n} on ${p} comes from facts.json`, FACT_PRICES.has(n) || OTHER_AMOUNTS.has(n));
  }
  wording(`answer-first block on ${p}`, text);
}
// Service guides (only while live): the whole guide body follows the answer-block rules, every $ amount is a
// facts.json price, it has an FAQPage that matches the visible FAQ, a dated WebPage node, and 900–1,400 words.
for (const p of GUIDE_PAGES) {
  const f = pageFor(p);
  if (!f) continue;
  const h = read(f);
  const main = (h.match(/<main[^>]*>([\s\S]*)<\/main>/) || ['', ''])[1];
  const text = visibleText(main);
  wording(`guide body on ${p}`, text);
  for (const m of text.matchAll(/\$(\d[\d,]*)/g)) {
    const n = Number(m[1].replace(/,/g, ''));
    check(`guide amount $${n} on ${p} comes from facts.json`, FACT_PRICES.has(n) || OTHER_AMOUNTS.has(n));
  }
  check(`guide has an FAQPage on ${p}`, (pageFaq[p] || []).length >= 6, (pageFaq[p] || []).length);
  const words = visibleText(main.replace(/<table\b[\s\S]*?<\/table>/g, ' ')).split(/\s+/).filter(Boolean).length;
  check(`guide length 900–1,400 words on ${p}`, words >= 900 && words <= 1400, words);
  const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => nodesOf(JSON.parse(m[1])));
  check(`guide WebPage node with dateModified on ${p}`, ld.some((n) => n['@type'] === 'WebPage' && n.url === `${BASE}${p}` && /^\d{4}-\d\d-\d\d$/.test(n.dateModified || '')));
  check(`guide date matches its visible Last reviewed on ${p}`, ld.some((n) => n['@type'] === 'WebPage' && h.includes(`datetime="${n.dateModified}"`)));
  check(`guide has a Book link to Square on ${p}`, /href="https:\/\/book\.squareup\.com\//.test(main));
  check(`guide links to its service hub on ${p}`, /href="\/(massage|facials)\/?[^"]*"/.test(main));
}
if (GUIDES_ON) check('guides checked', GUIDE_PAGES.length >= 3, GUIDE_PAGES.length);

{
  const f = pageFor('/about/');
  const h = f ? read(f) : '';
  const block = (h.match(/data-geo="entity"[\s\S]*?<\/dl>/) || [''])[0];
  check('About has the entity block', !!block);
  const t = visibleText('<div ' + block);
  check('entity block: name', t.includes(site.name));
  for (const sp of ['SD', 'DM']) { const s = site.spas[sp]; check(`entity block: ${s.name} address`, t.includes(`${s.street}, ${s.city}, ${s.region} ${s.postal}`)); }
  check('entity block: phone', t.includes(site.phone.display));
  check('entity block: email', t.includes(site.email));
  wording('About entity block', t);
  const ld = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].flatMap((m) => nodesOf(JSON.parse(m[1])));
  check('About JSON-LD has AboutPage, Organization and both DaySpa nodes', ['AboutPage', 'Organization'].every((t2) => ld.some((n) => n['@type'] === t2)) && ld.filter((n) => n['@type'] === 'DaySpa').length === 2);
}

// ---------------------------------------------------------------- 5. robots.txt
const robots = existsSync(join(dist, 'robots.txt')) ? read(join(dist, 'robots.txt')) : '';
const groups = [];
{
  let cur = null, lastWasUA = false;
  for (const raw of robots.split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const [k, ...v] = line.split(':');
    const key = k.trim().toLowerCase(), val = v.join(':').trim();
    if (key === 'user-agent') { if (!lastWasUA) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(val.toLowerCase()); lastWasUA = true; }
    else { lastWasUA = false; if (cur && (key === 'allow' || key === 'disallow')) cur.rules.push([key, val]); }
  }
}
const groupFor = (ua) => groups.find((g) => g.agents.includes(ua.toLowerCase())) || groups.find((g) => g.agents.includes('*'));
const AI = ['OAI-SearchBot', 'ChatGPT-User', 'GPTBot', 'Claude-SearchBot', 'Claude-User', 'ClaudeBot', 'PerplexityBot', 'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'Bingbot'];
if (MODE.launch) {
  for (const ua of AI) {
    const g = groups.find((x) => x.agents.includes(ua.toLowerCase()));
    check(`launch robots.txt names ${ua}`, !!g);
    check(`launch robots.txt lets ${ua} read the site`, !!g && g.rules.some(([k, v]) => k === 'allow' && v === '/') && !g.rules.some(([k, v]) => k === 'disallow' && v === '/'));
    check(`launch robots.txt keeps ${ua} out of /api/`, !!g && g.rules.some(([k, v]) => k === 'disallow' && v === '/api/'));
  }
  check('launch robots.txt mentions /llms.txt', robots.includes('/llms.txt'));
} else {
  check('staging robots.txt has one group, for *', groups.length === 1 && groups[0].agents.join() === '*', JSON.stringify(groups));
  for (const ua of AI) {
    const g = groupFor(ua);
    check(`staging robots.txt blocks ${ua}`, !!g && g.rules.some(([k, v]) => k === 'disallow' && v === '/') && !g.rules.some(([k]) => k === 'allow'));
  }
}
wording('robots.txt', robots, { claims: false });

console.log(fail
  ? `\n✗ GEO checks: ${fail} failed, ${pass} passed (${MODE.mode} build, ${BASE})`
  : `✓ GEO checks: ${pass} passed (${MODE.mode} build, ${BASE}; ${ldBlocks} JSON-LD blocks, ${offersChecked} offers and llms.txt priced against ${facts ? relative(root, factsPath) : 'services.json'}, ${faqPages} FAQ pages)`);
process.exit(fail ? 1 : 0);
