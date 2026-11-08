// Analytics + booking-tracking tests (npm run test:tracking; also part of npm test).
//
// 1. Builds the site three times into dist-tracking/ (never touches a server, never uses a real token):
//      off      — no analytics env (what staging ships)
//      off-prev — no analytics env, PREVIEW=1 (draft pages such as /refer included)
//      on       — PUBLIC_CF_ANALYTICS_TOKEN=<fake 32-hex> and PUBLIC_EVENTS_ENDPOINT=/api/event, PREVIEW=1
//    then rebuilds dist/ exactly as the caller's environment would (analytics vars removed), so other tests are unaffected.
// 2. Static checks on every build: every Square booking link, the gift card link, every tel: and sms: link carries
//    data-track with the right event; its props survive the allowlist unchanged; booking links name the right spa;
//    deep links name the service. Uni's link cards carry the same attributes.
// 3. Off builds: nothing analytics-related ships (no beacon, no endpoint). On build: beacon loader and endpoint present.
// 4. Personal data: hostile payloads through sanitizeEvent and through the Pages Function (fake D1): nothing personal
//    can be stored. DNT / GPC, other origins, big bodies and a missing database store nothing.
// 5. Browser (scripts/test-tracking.py, Playwright, all non-local requests blocked): nothing is requested when off;
//    clicks send clean events when on; Global Privacy Control / Do Not Track send nothing.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import {
  EVENTS, PROP_KEYS, sanitizeEvent, cleanProps, cleanPath, cleanRef, cleanUtm, browserOptedOut, makeVocab,
} from '../src/lib/event-schema.mjs';
import * as fn from '../functions/api/event.js';
import * as VOCAB_MOD from '../src/lib/event-vocab.mjs';

const root = new URL('..', import.meta.url).pathname;
const outRoot = join(root, 'dist-tracking');
const FAKE_TOKEN = '0123456789abcdef0123456789abcdef'; // not a real token: shape only
const lock = JSON.parse(readFileSync(join(root, 'src/data/square-lock.json'), 'utf8'));
const LOC_SPA = Object.fromEntries(Object.entries(lock.booking_base).map(([spa, url]) => [url.match(/location\/([A-Z0-9]+)\//)[1], spa]));

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { if (ok) pass++; else { fail++; console.log(`✗ ${name}${detail ? ' — ' + detail : ''}`); } };

// ---------------------------------------------------------------- 1. builds
const baseEnv = { ...process.env };
delete baseEnv.PUBLIC_CF_ANALYTICS_TOKEN; delete baseEnv.PUBLIC_EVENTS_ENDPOINT; delete baseEnv.ASTRO_OUT_DIR;
function build(name, extra) {
  const dir = join(outRoot, name);
  rmSync(dir, { recursive: true, force: true });
  const env = { ...baseEnv, ...extra, ASTRO_OUT_DIR: dir };
  execFileSync('npx', ['astro', 'build', '--silent'], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] });
  return dir;
}
if (!process.env.SKIP_BUILD) {
  mkdirSync(outRoot, { recursive: true });
  execFileSync('node', ['scripts/copy-fonts.mjs'], { cwd: root, stdio: 'ignore' });
  execFileSync('node', ['scripts/gen-event-vocab.mjs'], { cwd: root, stdio: 'ignore' });
  build('off', { PREVIEW: '' });
  build('off-prev', { PREVIEW: '1' });
  build('on', { PREVIEW: '1', PUBLIC_CF_ANALYTICS_TOKEN: FAKE_TOKEN, PUBLIC_EVENTS_ENDPOINT: '/api/event' });
  // Restore dist/ as the caller built it (their PREVIEW setting), with analytics off.
  execFileSync('npx', ['astro', 'build', '--silent'], { cwd: root, env: baseEnv, stdio: ['ignore', 'ignore', 'inherit'] });
}
const BUILDS = ['off', 'off-prev', 'on'].map((n) => ({ name: n, dir: join(outRoot, n) }));
for (const b of BUILDS) check(`build ${b.name} exists`, existsSync(join(b.dir, 'index.html')));

// ---------------------------------------------------------------- helpers
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const decode = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const attr = (tag, name) => { const m = tag.match(new RegExp(`\\s${name}=(?:"([^"]*)"|'([^']*)')`)); return m ? decode(m[1] ?? m[2]) : null; };
const BOOK = /^https:\/\/book\.squareup\.com\/appointments\/[^/]+\/location\/([A-Z0-9]+)\/services(?:\/([A-Z0-9]+))?$/;
const GIFT = /^https:\/\/app\.squareup\.com\/gift\//;
function expectedEvent(href) {
  if (BOOK.test(href)) return 'book_click';
  if (GIFT.test(href)) return 'gift_card_click';
  if (href.startsWith('tel:')) return 'call_click';
  if (href.startsWith('sms:')) return 'text_click';
  return null;
}

// ---------------------------------------------------------------- 2. static link checks
for (const b of BUILDS) {
  const pages = walk(b.dir).filter((f) => f.endsWith('.html'));
  const counts = { book_click: 0, gift_card_click: 0, call_click: 0, text_click: 0 };
  let otherTracked = 0;
  for (const f of pages) {
    const rel = '/' + relative(b.dir, f);
    const html = readFileSync(f, 'utf8');
    for (const m of html.matchAll(/<(a|button)\b[^>]*>/g)) {
      const tag = m[0];
      const href = attr(tag, 'href') || '';
      const want = m[1] === 'a' ? expectedEvent(href) : null;
      const ev = attr(tag, 'data-track');
      const rawProps = attr(tag, 'data-track-props');
      if (!want && !ev) continue;
      if (want) {
        counts[want]++;
        check(`${b.name}${rel}: ${want} link tracked`, ev === want, `href=${href} data-track=${ev}`);
      } else otherTracked++;
      if (ev) check(`${b.name}${rel}: event "${ev}" allowed`, EVENTS.includes(ev));
      let props = {};
      try { props = rawProps ? JSON.parse(rawProps) : {}; } catch { check(`${b.name}${rel}: props JSON`, false, rawProps); continue; }
      const cleaned = cleanProps(props, makeVocab(VOCAB_MOD));
      const kept = Object.fromEntries(Object.entries(props).filter(([, v]) => v != null && v !== ''));
      check(`${b.name}${rel}: props pass the allowlist unchanged`, JSON.stringify(Object.keys(kept).sort()) === JSON.stringify(Object.keys(cleaned).sort())
        && Object.keys(kept).every((k) => String(kept[k]).toLowerCase().replace(/\s+/g, '-') === String(cleaned[k]).toLowerCase()), `${rawProps} → ${JSON.stringify(cleaned)}`);
      const bm = href.match(BOOK);
      if (bm) {
        check(`${b.name}${rel}: booking link names its spa`, props.spa === LOC_SPA[bm[1]], `${href} spa=${props.spa}`);
        if (bm[2]) check(`${b.name}${rel}: deep link names its service`, typeof props.service === 'string' && props.service.length > 0, href);
      }
    }
  }
  check(`${b.name}: found booking, gift and phone links`, counts.book_click > 20 && counts.gift_card_click > 0 && counts.call_click > 10, JSON.stringify(counts));
  console.log(`  ${b.name}: ${pages.length} pages · links checked ${JSON.stringify(counts)} · other tracked elements ${otherTracked}`);
}

// Uni's link cards (public/chat/spa-chat.js): every LINKS entry carries an allowed event, booking cards their spa.
{
  const js = readFileSync(join(root, 'public/chat/spa-chat.js'), 'utf8');
  const entries = [...js.matchAll(/(\w+): \{ label: '[^']*', href: '([^']*)'(?:, ev: '(\w+)')?(?:, spa: '(\w+)')?/g)];
  check('chat: 4 link cards found', entries.length === 4, String(entries.length));
  for (const [, key, href, ev, spa] of entries) {
    check(`chat ${key}: event matches link`, ev === expectedEvent(href), `${ev} vs ${expectedEvent(href)}`);
    const bm = href.match(BOOK);
    if (bm) check(`chat ${key}: spa matches link`, spa === LOC_SPA[bm[1]]);
  }
  check('chat: link cards set data-track', /a\.setAttribute\('data-track', l\.ev\)/.test(js));
  check('chat: lead counted without content', /track\('chat_lead', \{ channel: 'chat' \}\)/.test(js) && /track\('chat_lead', \{ channel: 'voice' \}\)/.test(js));
}

// ---------------------------------------------------------------- 3. off = nothing ships; on = it ships
for (const b of BUILDS) {
  const files = walk(b.dir).filter((f) => /\.(html|js|css|json|xml|txt)$/.test(f) && !f.endsWith('uni-voice.js'));
  const all = files.map((f) => readFileSync(f, 'utf8')).join('\n');
  const privacy = readFileSync(join(b.dir, 'privacy/index.html'), 'utf8');
  if (b.name.startsWith('off')) {
    check(`${b.name}: no Cloudflare beacon anywhere`, !/cloudflareinsights|data-cf-beacon/.test(all));
    check(`${b.name}: no event endpoint anywhere`, !all.includes('/api/event'));
    check(`${b.name}: no token-shaped value in pages`, !all.includes(FAKE_TOKEN));
    check(`${b.name}: privacy says no analytics`, /Visit statistics:<\/strong> none at the moment/.test(privacy) && !/Cloudflare:<\/strong>/.test(privacy));
  } else {
    const pages = files.filter((f) => f.endsWith('.html'));
    const withBeacon = pages.filter((f) => readFileSync(f, 'utf8').includes('static.cloudflareinsights.com/beacon.min.js'));
    check('on: beacon loader on every page', withBeacon.length === pages.length, `${withBeacon.length}/${pages.length}`);
    check('on: beacon loader checks DNT and GPC first', /globalPrivacyControl === true \|\| n\.doNotTrack === '1'/.test(readFileSync(pages[0], 'utf8')));
    check('on: event endpoint in the site script', files.some((f) => f.endsWith('.js') && readFileSync(f, 'utf8').includes('/api/event')));
    check('on: privacy describes Cloudflare counts and DNT/GPC', /Cloudflare:<\/strong>/.test(privacy) && /Global Privacy Control:<\/strong>/.test(privacy));
  }
}

// ---------------------------------------------------------------- 4. personal data can't get through
const PII = ['jane', 'doe', 'john', 'smith', 'mary', 'jane@example.com', 'example.com/x', '858', '2938900', '4111', '1111', 'allerg', 'pregnan', 'secret', 'ignore previous', '<script', '1.2.3.4', 'mozilla', 'session', 'cookie'];
const hasPII = (obj) => { const s = JSON.stringify(obj).toLowerCase(); return PII.filter((x) => s.includes(x)); };
const hostile = [
  { e: 'book_click', p: { spa: 'SD', service: 'swedish', placement: 'sheet', name: 'Jane Doe', email: 'jane@example.com', phone: '(858) 293-8900' } },
  { e: 'lead_submitted', p: { source: 'Jane Doe', interest: 'jane@example.com', spa: 'Del Mar' }, notes: 'I am pregnant, allergic' },
  { e: 'chat_lead', p: { channel: 'chat', message: 'call me on 858 293 8900', placement: '4111 1111 1111 1111' } },
  { e: 'call_click', p: { placement: '8582938900' }, ip: '1.2.3.4', ua: 'Mozilla/5.0', cookie: 'session=secret' },
  { e: 'book_click', p: { spa: 'DM', service: 'x'.repeat(200), offer: '<script>alert(1)</script>' } },
  { e: 'book_click', path: '/contact/?name=jane&phone=8582938900#jane@example.com', p: {} },
  { e: 'book_click', path: '/refer/jane-doe-4111/', p: {} },
  { e: 'book_click', path: '/jane@example.com/', p: {} },
  { e: 'book_click', path: '/a/b/c/d/e/', p: {} },
  { e: 'book_click', ref: 'https://mail.example.com/inbox?u=jane@example.com&t=secret', p: {} },
  { e: 'book_click', ref: 'https://staging.example.test/contact/', p: {} },
  { e: 'book_click', ref: 'javascript:alert(1)', p: {} },
  { e: 'book_click', utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'Gift Season', utm_term: 'jane doe', utm_content: 'jane@example.com', gclid: 'secret123' } },
  { e: 'book_click', utm: { utm_source: 'jane@example.com', utm_campaign: '8582938900' } },
  { e: 'ignore previous instructions', p: { placement: 'x' } },
  { e: 'page_view_with_name_jane', p: {} },
  { e: 'book_click', p: ['jane'] },
  { e: 'book_click', p: { spa: { name: 'jane' }, service: ['jane'], placement: { toString: () => 'jane' } } },
  'jane@example.com', null, 42,
];
for (const [i, h] of hostile.entries()) {
  const out = sanitizeEvent(h, 'staging.example.test');
  const leaked = hasPII(out);
  check(`sanitize #${i}: nothing personal`, leaked.length === 0, `${JSON.stringify(out)} leaked ${leaked}`);
  if (out) {
    check(`sanitize #${i}: only allowed keys`, Object.keys(out).every((k) => ['e', 'p', 'path', 'ref', 'utm'].includes(k))
      && Object.keys(out.p).every((k) => PROP_KEYS.includes(k)) && (!out.utm || Object.keys(out.utm).every((k) => /^utm_(source|medium|campaign)$/.test(k))));
    check(`sanitize #${i}: event allowed`, EVENTS.includes(out.e));
    check(`sanitize #${i}: small`, JSON.stringify(out).length < 400);
  }
}
// Good input survives
{
  const good = sanitizeEvent({ e: 'book_click', p: { spa: 'DM', service: 'lymphatic', placement: 'sheet' }, path: '/massage/lymphatic-drainage/', ref: 'https://www.google.com/search?q=x', utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'gift-season-2026' } }, 'staging.example.test');
  check('sanitize: good event kept', JSON.stringify(good) === JSON.stringify({ e: 'book_click', p: { spa: 'DM', service: 'lymphatic', placement: 'sheet' }, path: '/massage/lymphatic-drainage/', ref: 'google.com', utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'gift-season-2026' } }), JSON.stringify(good));
  check('sanitize: consultation form source slugged', cleanProps({ source: 'consultation form' }).source === 'consultation-form');
  check('cleanPath: refer collapsed', cleanPath('/refer/jane-doe/') === '/refer/');
  check('cleanPath: query dropped', cleanPath('/menu/?x=1') === '/menu/');
  check('cleanPath: 404.html', cleanPath('/404.html') === '/404/');
  check('cleanRef: own host dropped', cleanRef('https://staging.example.test/x', 'staging.example.test') === null);
  check('cleanUtm: from query string', JSON.stringify(cleanUtm('?utm_source=Google&utm_medium=cpc&utm_campaign=Gift%20Season&utm_term=jane')) === '{"utm_source":"google","utm_medium":"cpc","utm_campaign":"gift-season"}');
  check('opt-out: GPC', browserOptedOut({ globalPrivacyControl: true }, {}) === true);
  check('opt-out: DNT', browserOptedOut({ doNotTrack: '1' }, {}) === true);
  check('opt-out: neither', browserOptedOut({ doNotTrack: 'unspecified' }, {}) === false);
}

// The Pages Function with a fake D1 database
function fakeDb() {
  const rows = [], deletes = [];
  return {
    rows, deletes,
    prepare(sql) { return { bind: (...v) => ({ run: async () => { if (/^INSERT/.test(sql)) rows.push(v); else deletes.push(v); return { success: true }; } }) }; },
  };
}
async function call(body, { headers = {}, db = fakeDb(), method = 'POST', raw } = {}) {
  const text = raw ?? JSON.stringify(body);
  const req = new Request('https://uniquespahouse.com/api/event', { method, body: method === 'POST' ? text : undefined, headers: { Origin: 'https://uniquespahouse.com', 'Content-Type': 'application/json', ...headers } });
  const waits = [];
  const res = method === 'POST' ? await fn.onRequestPost({ request: req, env: db ? { EVENTS_DB: db } : {}, waitUntil: (p) => waits.push(p) }) : fn.onRequest({ request: req });
  await Promise.all(waits);
  return { res, db };
}
{
  for (const [i, h] of hostile.entries()) {
    if (h == null || typeof h !== 'object') continue;
    const { res, db } = await call(h);
    check(`function #${i}: 204`, res.status === 204, String(res.status));
    const leaked = hasPII(db.rows);
    check(`function #${i}: stored nothing personal`, leaked.length === 0, `${JSON.stringify(db.rows)} leaked ${leaked}`);
    for (const r of db.rows) check(`function #${i}: 16 columns, short values`, r.length === 16 && r.every((v) => v == null || typeof v === 'number' || String(v).length <= 60));
  }
  let r = await call({ e: 'book_click', p: { spa: 'SD', service: 'swedish', placement: 'sheet' }, path: '/menu/', utm: { utm_source: 'google', utm_medium: 'cpc', utm_campaign: 'gift-season' } });
  const row = r.db.rows[0] || [];
  check('function: good event stored', r.db.rows.length === 1 && row[2] === 'book_click' && row[3] === 'SD' && row[4] === 'swedish' && row[5] === 'sheet' && row[11] === '/menu/' && row[15] === 'gift-season', JSON.stringify(row));
  check('function: LA day stamp', /^\d{4}-\d{2}-\d{2}$/.test(row[1] || ''));
  r = await call({ e: 'book_click', p: { placement: 'jane-doe', service: 'jane-smith', interest: 'john', offer: 'mary-jones', spa: 'SD' } });
  check('function: names shaped like slugs are not in the vocabulary', r.db.rows.length === 1 && hasPII(r.db.rows).length === 0 && r.db.rows[0][3] === 'SD' && r.db.rows[0][4] === null && r.db.rows[0][5] === null, JSON.stringify(r.db.rows));
  r = await call({ e: 'book_click', p: {} }, { headers: { DNT: '1' } });
  check('function: DNT stores nothing', r.res.status === 204 && r.db.rows.length === 0);
  r = await call({ e: 'book_click', p: {} }, { headers: { 'Sec-GPC': '1' } });
  check('function: GPC stores nothing', r.res.status === 204 && r.db.rows.length === 0);
  r = await call({ e: 'book_click', p: {} }, { headers: { Origin: 'https://evil.example' } });
  check('function: other origin refused', r.res.status === 403 && r.db.rows.length === 0);
  r = await call(null, { raw: JSON.stringify({ e: 'book_click', p: { placement: 'x'.repeat(2000) } }) });
  check('function: big body refused', r.res.status === 413 && r.db.rows.length === 0);
  r = await call(null, { raw: 'name=jane' });
  check('function: non-JSON refused', r.res.status === 400 && r.db.rows.length === 0);
  r = await call({ e: 'book_click', p: {} }, { db: null });
  check('function: no database = off (204)', r.res.status === 204);
  r = await call(null, { method: 'GET' });
  check('function: GET refused', r.res.status === 405);
  const src = readFileSync(join(root, 'functions/api/event.js'), 'utf8');
  check('function: never reads IP, user agent or cookies', !/CF-Connecting-IP|X-Forwarded-For|User-Agent|Cookie|request\.cf/i.test(src.replace(/^\s*\/\/.*$/gm, '')));
}

// ---------------------------------------------------------------- 5. browser
if (!process.env.SKIP_BROWSER) {
  const py = spawnSync('python3', [join(root, 'scripts/test-tracking.py'), ...BUILDS.map((b) => b.dir)], { cwd: root, stdio: 'inherit' });
  check('browser tests (scripts/test-tracking.py)', py.status === 0, `exit ${py.status}`);
}

console.log(fail ? `\n✗ tracking: ${fail} failed, ${pass} passed` : `✓ tracking: ${pass} checks passed`);
process.exit(fail ? 1 : 0);
