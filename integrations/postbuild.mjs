// Post-build step (QA m-11, m-23):
//  1. Trailing slashes: pages are served as /path/index.html, so every internal page link, canonical, og:url and
//     JSON-LD URL gets its trailing slash. Static servers (Caddy file_server) then answer directly instead of
//     redirecting /about → /about/ (one round trip saved per navigation).
//  2. Launch switch (site.json "launch", src/lib/launch.mjs):
//     - launch:  sitemap.xml from the built pages (live services only exist as pages), without /404, /refer and
//                /rewards; production robots.txt pointing at it.
//     - staging: no sitemap.xml; robots.txt stays "Disallow: /" (public/robots.txt); _headers gets X-Robots-Tag noindex.
//  3. _headers: the INLINE_SCRIPT_HASHES placeholder → the sha256 of every inline script in the build (CSP without 'unsafe-inline').
import { readdirSync, readFileSync, writeFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const SKIP_PREFIX = /^\/(_astro|api|chat|fonts)\b/;

function slash(path) {
  if (path === '' || path.endsWith('/')) return path;
  if (SKIP_PREFIX.test(path)) return path;
  const last = path.split('/').pop() || '';
  if (last.includes('.')) return path;          // a file (favicon.svg, robots.txt, 404.html)
  return path + '/';
}

export function addSlashes(html, site) {
  const host = site.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/[.]/g, '\\.');
  // href="/path?x#y" (internal, root-relative)
  html = html.replace(/\b(href)="(\/[^"#?]*)([?#][^"]*)?"/g, (m, attr, p, rest = '') => `${attr}="${slash(p)}${rest}"`);
  // absolute URLs on our own host (canonical, og:url, JSON-LD), up to a quote, #, ?, whitespace or <
  html = html.replace(new RegExp(`(https?://${host})(/[^"'\\s<#?\\\\]*)`, 'g'), (m, origin, p) => origin + slash(p));
  return html;
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** CSP source list for every executable inline <script> (not src=, not JSON/ld+json data blocks), sorted, unique. */
export function inlineScriptHashes(htmlFiles) {
  const set = new Set();
  for (const html of htmlFiles) {
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      const attrs = m[1];
      if (/\ssrc\s*=/i.test(attrs)) continue;
      const type = (attrs.match(/\stype\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
      if (type && !/^(module|text\/javascript|application\/javascript)$/i.test(type)) continue;
      set.add(`'sha256-${createHash('sha256').update(m[2], 'utf8').digest('base64')}'`);
    }
  }
  return [...set].sort();
}

export const STAGING_ROBOTS_HEADER = '  X-Robots-Tag: noindex, nofollow';

/** Finish public/_headers for this build: fill the script hashes; on staging, noindex every response. */
export function finishHeaders(text, hashes, launch) {
  if (!text.includes('{{INLINE_SCRIPT_HASHES}}')) throw new Error('[postbuild] _headers has no {{INLINE_SCRIPT_HASHES}} placeholder');
  let out = text.replaceAll('{{INLINE_SCRIPT_HASHES}}', hashes.join(' '));
  if (!launch) out = out.replace(/^\/\*\n/m, `/*\n${STAGING_ROBOTS_HEADER}\n`);
  for (const line of out.split('\n')) if (line.length > 2000) throw new Error('[postbuild] _headers line over 2,000 characters (Cloudflare limit)');
  return out;
}

/**
 * AI search and answer crawlers, named so they are explicitly welcome (GEO). Each one reads the site the same way as
 * every other crawler: everything except /api/. Sources (checked 3 Nov 2026): OpenAI developers.openai.com/api/docs/bots,
 * Anthropic support.claude.com/en/articles/8896518, Perplexity docs.perplexity.ai (Perplexity crawlers), Google
 * developers.google.com (common crawlers: Google-Extended). Search/answer bots first, then training bots (allowed too,
 * so assistants' built-in knowledge of the spa stays current). Staging never gets this file (public/robots.txt).
 */
export const AI_CRAWLERS = [
  'OAI-SearchBot', 'ChatGPT-User', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot', 'Perplexity-User',
  'Applebot', 'Bingbot', 'DuckAssistBot', 'MistralAI-User',
  'GPTBot', 'ClaudeBot', 'Google-Extended', 'Applebot-Extended', 'Amazonbot', 'Meta-ExternalAgent',
];

export function productionRobots(base) {
  return [
    `# Unique Spa House — ${base}`,
    '# Search engines and AI assistants are welcome to read and cite every public page. Facts for assistants: /llms.txt',
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    '',
    '# AI search, answer and assistant crawlers: same access, named explicitly.',
    ...AI_CRAWLERS.map((ua) => `User-agent: ${ua}`),
    'Allow: /',
    'Disallow: /api/',
    '',
    `Sitemap: ${base}/sitemap.xml`,
    '',
  ].join('\n');
}

export default function postbuild({ site, launch = false }) {
  return {
    name: 'ush-postbuild',
    hooks: {
      'astro:build:done': ({ dir, logger }) => {
        const out = fileURLToPath(dir);
        const html = walk(out).filter((f) => f.endsWith('.html'));
        const pages = [];
        for (const f of html) {
          const text = addSlashes(readFileSync(f, 'utf8'), site);
          writeFileSync(f, text);
          pages.push(text);
        }
        const base = site.replace(/\/$/, '');
        const sitemap = join(out, 'sitemap.xml');
        if (launch) {
          const urls = html
            .map((f) => '/' + f.slice(out.length).replace(/\\/g, '/').replace(/^\//, '').replace(/index\.html$/, ''))
            .filter((u) => !u.endsWith('.html'))
            .filter((u) => !/^\/(refer|rewards)\//.test(u))
            .sort();
          const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
            .map((u) => `  <url><loc>${base}${u}</loc></url>`)
            .join('\n')}\n</urlset>\n`;
          writeFileSync(sitemap, xml);
          writeFileSync(join(out, 'robots.txt'), productionRobots(base));
          logger.info(`LAUNCH build (${base}): indexable; sitemap.xml with ${urls.length} URLs; production robots.txt`);
        } else {
          if (existsSync(sitemap)) rmSync(sitemap);
          logger.info(`STAGING build (${base}): noindex; robots.txt disallows all; no sitemap.xml`);
        }
        const headersFile = join(out, '_headers');
        if (existsSync(headersFile)) {
          const hashes = inlineScriptHashes(pages);
          writeFileSync(headersFile, finishHeaders(readFileSync(headersFile, 'utf8'), hashes, launch));
          logger.info(`_headers: CSP covers ${hashes.length} inline script(s)`);
        }
        logger.info(`trailing slashes added in ${html.length} pages`);
      },
    },
  };
}
