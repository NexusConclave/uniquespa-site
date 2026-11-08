// Same-origin bridge from the website to Uni's chat Worker (uni-chat), used by the Pages Functions
// functions/api/chat.js, functions/api/lead.js and functions/api/health.js.
//
// The Pages project has a service binding UNI -> the uni-chat Worker (wrangler.toml). The visitor's request is
// handed to UNI.fetch() unchanged: same method, body and headers, including CF-Connecting-IP, which Cloudflare
// sets at the edge and the Worker uses for its rate limits. A service binding is an internal call inside Katy's
// Cloudflare account: no public hop, no CORS, no Worker route on the domain, and public/chat/spa-chat.js keeps
// calling the relative paths /api/chat and /api/lead.
//
// This file adds only two things:
//   - a same-site check: a POST that carries another site's Origin gets 403 (browsers always send Origin on a
//     POST; curl and health checks send none and pass through);
//   - a friendly 503 when the binding is missing (staging, local builds), the Worker throws, or it hasn't answered
//     within 75 seconds (the Worker gives the AI model 60), in the same { error } shape the Worker uses, so the chat
//     and the contact form show "please call" instead of spinning or breaking.
// It never reads or logs the body.
export const UNAVAILABLE = 'Sorry — the assistant is unavailable right now. Please call (858) 293-8900.';

const json = (status, obj) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });

export const TIMEOUT_MS = 75_000;

export async function proxyToUni(context, { timeoutMs = TIMEOUT_MS } = {}) {
  const { request, env } = context;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== new URL(request.url).origin) return json(403, { error: 'Forbidden' });
  }
  const uni = env && env.UNI;
  if (!uni || typeof uni.fetch !== 'function') return json(503, { error: UNAVAILABLE });
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(json(503, { error: UNAVAILABLE })), timeoutMs); });
  try {
    return await Promise.race([uni.fetch(request), late]);
  } catch {
    return json(503, { error: UNAVAILABLE });
  } finally {
    clearTimeout(timer);
  }
}
