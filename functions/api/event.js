// POST /api/event — first-party booking-intent counter (Cloudflare Pages Function, free plan).
//
// Writes one row per allowed event into the D1 database bound as EVENTS_DB (schema: migrations/0001_events.sql).
// Stores ONLY what ../../src/lib/event-schema.mjs lets through, checked against the closed vocabulary in
// ../../src/lib/event-vocab.mjs: event name, known values (spa, service, placement, source, interest, offer, channel,
// gift amount), the page path, the referring host and utm_source/medium/campaign, plus the
// LA date. It never reads or stores the IP address, user agent, cookies or any visitor id.
//
// Off switches (all answer 204 and store nothing):
//   - no EVENTS_DB binding (staging, previews, local builds);
//   - the browser sends Do Not Track (DNT: 1) or Global Privacy Control (Sec-GPC: 1);
//   - an unknown event name.
// Rejected: other origins (403), bodies over 1 KB (413), non-JSON (400), other methods (405).
// Rows older than 400 days are deleted now and then (about 1 in 50 writes), so nothing piles up.
import { sanitizeEvent, headersOptedOut, makeVocab, MAX_BODY } from '../../src/lib/event-schema.mjs';
import * as VOCAB from '../../src/lib/event-vocab.mjs';

const vocab = makeVocab(VOCAB);

const RETAIN_DAYS = 400;
const NO_CONTENT = () => new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
const fail = (status) => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });

function dayLA(ms) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Same-site only: browsers always send Origin on a POST.
  const origin = request.headers.get('Origin');
  if (!origin || origin !== url.origin) return fail(403);

  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BODY) return fail(413);
  const text = await request.text();
  if (text.length > MAX_BODY) return fail(413);

  if (headersOptedOut(request.headers)) return NO_CONTENT();

  let body;
  try { body = JSON.parse(text); } catch { return fail(400); }
  const ev = sanitizeEvent(body, url.hostname, vocab);
  if (!ev) return NO_CONTENT();

  const db = env && env.EVENTS_DB;
  if (!db) return NO_CONTENT();

  const now = Date.now();
  const p = ev.p, u = ev.utm || {};
  const write = db
    .prepare(
      'INSERT INTO events (ts, day, event, spa, service, placement, source, interest, offer, channel, amount, path, ref, utm_source, utm_medium, utm_campaign) ' +
      'VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)'
    )
    .bind(
      Math.floor(now / 1000), dayLA(now), ev.e,
      p.spa ?? null, p.service ?? null, p.placement ?? null, p.source ?? null, p.interest ?? null, p.offer ?? null, p.channel ?? null, p.amount ?? null,
      ev.path, ev.ref ?? null, u.utm_source ?? null, u.utm_medium ?? null, u.utm_campaign ?? null
    )
    .run();

  const tidy = Math.random() < 0.02
    ? db.prepare('DELETE FROM events WHERE ts < ?1').bind(Math.floor(now / 1000) - RETAIN_DAYS * 86400).run()
    : null;

  try {
    if (context.waitUntil) { context.waitUntil(write); if (tidy) context.waitUntil(tidy); }
    else { await write; if (tidy) await tidy; }
  } catch { /* counting must never break the page */ }
  return NO_CONTENT();
}

export function onRequest() {
  return new Response(null, { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } });
}
