// Tests for the same-origin bridge to Uni's chat Worker (npm run test:uni-proxy; also part of npm test).
// No server, no network: the UNI service binding is a fake that records what it was handed.
// The full browser test (real Worker + Pages in workerd, Playwright) lives in wire-notes/e2e/.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { proxyToUni, UNAVAILABLE } from '../src/lib/uni-proxy.mjs';
import * as chat from '../functions/api/chat.js';
import * as lead from '../functions/api/lead.js';
import * as health from '../functions/api/health.js';
import * as event from '../functions/api/event.js';

let pass = 0;
const t = async (name, fn) => { await fn(); pass++; };
const SITE = 'https://uniquespahouse.com';
function fakeUni(reply = { ok: true }) {
  const seen = [];
  return { seen, fetch: async (req) => { seen.push({ method: req.method, url: req.url, headers: Object.fromEntries(req.headers), body: req.method === 'GET' ? null : await req.text() }); return Response.json(reply); } };
}
const req = (path, init = {}) => new Request(SITE + path, init);

await t('chat: POST is handed to UNI unchanged (method, path, body, CF-Connecting-IP)', async () => {
  const UNI = fakeUni({ reply: 'hi', lead_captured: false });
  const body = JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] });
  const r = await chat.onRequest({ request: req('/api/chat', { method: 'POST', body, headers: { 'Content-Type': 'application/json', Origin: SITE, 'CF-Connecting-IP': '203.0.113.9' } }), env: { UNI } });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { reply: 'hi', lead_captured: false });
  assert.equal(UNI.seen.length, 1);
  assert.equal(UNI.seen[0].method, 'POST');
  assert.equal(UNI.seen[0].url, SITE + '/api/chat');
  assert.equal(UNI.seen[0].body, body);
  assert.equal(UNI.seen[0].headers['cf-connecting-ip'], '203.0.113.9');
});

await t('lead and health route to UNI too', async () => {
  const UNI = fakeUni();
  await lead.onRequest({ request: req('/api/lead', { method: 'POST', body: '{"name":"T"}', headers: { Origin: SITE } }), env: { UNI } });
  await health.onRequest({ request: req('/api/health'), env: { UNI } });
  assert.deepEqual(UNI.seen.map((s) => `${s.method} ${new URL(s.url).pathname}`), ['POST /api/lead', 'GET /api/health']);
});

await t('POST from another site is refused before reaching UNI; no Origin (curl) passes', async () => {
  const UNI = fakeUni();
  const r = await lead.onRequest({ request: req('/api/lead', { method: 'POST', body: '{}', headers: { Origin: 'https://evil.example.com' } }), env: { UNI } });
  assert.equal(r.status, 403);
  assert.equal(UNI.seen.length, 0);
  const ok = await lead.onRequest({ request: req('/api/lead', { method: 'POST', body: '{}' }), env: { UNI } });
  assert.equal(ok.status, 200);
  assert.equal(UNI.seen.length, 1);
});

await t('no binding (staging/local) or a failing Worker -> 503 with the "please call" message the widget shows', async () => {
  for (const env of [{}, undefined, { UNI: { fetch: async () => { throw new Error('down'); } } }]) {
    const r = await proxyToUni({ request: req('/api/chat', { method: 'POST', body: '{}', headers: { Origin: SITE } }), env });
    assert.equal(r.status, 503);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await r.json(), { error: UNAVAILABLE });
  }
});

await t('a Worker that never answers -> 503 after the timeout, not a hung request', async () => {
  const UNI = { fetch: () => new Promise(() => {}) };
  const t0 = Date.now();
  const r = await proxyToUni({ request: req('/api/chat', { method: 'POST', body: '{}', headers: { Origin: SITE } }), env: { UNI } }, { timeoutMs: 50 });
  assert.equal(r.status, 503);
  assert.ok(Date.now() - t0 < 1000);
});

await t('/api/event is untouched: still its own Pages Function, never proxied', async () => {
  assert.equal(typeof event.onRequestPost, 'function');
  assert.ok(!readFileSync(new URL('../functions/api/event.js', import.meta.url), 'utf8').includes('uni-proxy'));
});

await t('the widget and the contact form still use relative same-origin paths (no Worker URL, no old server)', async () => {
  const js = readFileSync(new URL('../public/chat/spa-chat.js', import.meta.url), 'utf8');
  assert.match(js, /var API = '\/api\/chat';/);
  assert.match(js, /var LEAD_API = '\/api\/lead';/);
  // No absolute API host at all (no Worker URL, no old chat server): every call is same-origin.
  assert.ok(!/workers\.dev/.test(js));
  assert.ok(![...js.matchAll(/https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi)].some((m) => !/^(www\.)?(uniquespahouse\.com|book\.squareup\.com|app\.squareup\.com|www\.instagram\.com|(www\.)?facebook\.com|www\.w3\.org)$/i.test(m[1])));
  const contact = readFileSync(new URL('../src/pages/contact.astro', import.meta.url), 'utf8');
  assert.match(contact, /fetch\('\/api\/lead'/);
});

await t('wrangler.toml: production -> uni-chat, previews -> uni-chat-acceptance, EVENTS_DB kept, no secrets', async () => {
  const toml = readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8');
  assert.match(toml, /\[\[services\]\]\s*binding = "UNI"\s*service = "uni-chat"/);
  assert.match(toml, /\[\[env\.preview\.services\]\]\s*binding = "UNI"\s*service = "uni-chat-acceptance"/);
  assert.match(toml, /binding = "EVENTS_DB"/);
  assert.ok(!/api[_-]?key|token\s*=|secret\s*=/i.test(toml));
});

console.log(`uni-proxy: ${pass} passed`);
