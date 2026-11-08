// Holiday gift card offer check (gift kit fix 1 + fixes 2, 5–8). Run after a build: node scripts/check-gift-offer.mjs
// Reads the option the build used (env GIFT_OFFER, else site.json gift_offer.option) and checks /gift-cards, Home
// and /policies in dist:
//   1. Only the chosen option's wording ships (A: none at all; B: its lines + the $225 tile badge; C: its lines, no badge),
//      and none of the other option's lines, nor the old unapproved draft ("Pay $200", "Give a 90-minute escape",
//      "including bulk orders", "group gift cards").
//   2. B and C show their start and end dates.
//   3. No "free", "value", "save" or "bonus" on those pages.
//   4. Unconfirmed claims (confirm.json): production never states "never expire", "no fees", "covers a whole visit" or
//      "good at / used at both spas / either spa"; PREVIEW may, but each carries "Needs owner confirmation".
//   5. Fix 6 (Square name note), fix 7 (link-preview description), fix 8 ("pick an amount or type your own").
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const dist = process.env.DIST || join(root, 'dist');
const site = JSON.parse(readFileSync(join(root, 'src/data/site.json'), 'utf8'));
const offers = JSON.parse(readFileSync(join(root, 'src/data/offers.json'), 'utf8')).offers;
const claims = JSON.parse(readFileSync(join(root, 'src/data/confirm.json'), 'utf8')).claims;
const gift = offers.find((o) => o.kind === 'gift');
const cfg = site.gift_offer;
const OPTION = (process.env.GIFT_OFFER || cfg.option || 'A').toUpperCase();
const STARTS = process.env.GIFT_STARTS || cfg.starts;
const ENDS = process.env.GIFT_ENDS || cfg.ends;
const PREVIEW = process.env.PREVIEW === '1';

let pass = 0;
const fails = [];
const check = (name, ok, detail = '') => { if (ok) pass++; else fails.push(`${name}${detail ? ` — ${detail}` : ''}`); };

const read = (p) => readFileSync(join(dist, p), 'utf8');
const decode = (s) => s.replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
// Visible copy (hidden-until-start elements included: the client reveals them on their start date).
const text = (html) => decode(html.replace(/<(script|style|template)[^>]*>[\s\S]*?<\/\1>/g, ' ').replace(/<\/?(em|strong)>/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
const longDate = (iso) => new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(iso + 'T12:00:00Z'));

const PAGES = { gift: 'gift-cards/index.html', home: 'index.html', policies: 'policies/index.html' };
// Scope: the whole gift page; on Home the gift card article of the offers band; on /policies the Gift cards section.
const SCOPE = { gift: null, home: /<article class="gift[^"]*"[^>]*>[\s\S]*?<\/article>/, policies: /<section id="gift-cards"[\s\S]*?<\/section>/ };
const html = {}, txt = {};
for (const [k, p] of Object.entries(PAGES)) {
  check(`${p} exists`, existsSync(join(dist, p)));
  const full = read(p);
  const m = SCOPE[k] ? full.match(SCOPE[k]) : [full];
  check(`${k}: gift section found`, !!m);
  html[k] = m ? m[0] : '';
  txt[k] = text(html[k]);
}
const giftFull = read(PAGES.gift);

// Distinctive fixed phrases per option (the parts of the wording with no {tokens}).
const fixed = (s) => (s || '').split(/\{\w+\}/).map((x) => x.trim()).filter((x) => x.length >= 12);
const phrases = (opt) => {
  const c = gift.options[opt];
  return [...new Set([c.title, ...fixed(c.deal), ...fixed(c.small)].filter(Boolean))]; // the tile badge is checked below
};
const OLD_DRAFT = ['Pay $200', 'Give a 90-minute escape', 'including bulk orders', 'group gift cards', 'Holiday gifting'];

check(`option is A, B or C`, ['A', 'B', 'C'].includes(OPTION), OPTION);
for (const k of Object.keys(PAGES)) {
  for (const p of OLD_DRAFT) check(`${k}: old draft wording gone ("${p}")`, !txt[k].includes(p));
  for (const opt of ['B', 'C']) {
    const own = opt === OPTION;
    for (const p of phrases(opt)) {
      check(`${k}: option ${opt} line ${own ? 'present' : 'absent'} ("${p}")`, txt[k].includes(p) === own);
    }
  }
  check(`${k}: data-gift-option ${OPTION === 'A' ? 'absent' : OPTION}`,
    OPTION === 'A' ? !html[k].includes('data-gift-option') : html[k].includes(`data-gift-option="${OPTION}"`));
  if (OPTION !== 'A' && STARTS && ENDS) {
    check(`${k}: start date shown (${longDate(STARTS)})`, txt[k].includes(longDate(STARTS)));
    check(`${k}: end date shown (${longDate(ENDS)})`, txt[k].includes(longDate(ENDS)));
  }
  const banned = txt[k].match(/\bfree\b|\bvalue[sd]?\b|\bsav(?:e|es|ed|ing|ings)\b|\bbonus\b|complimentary/i);
  check(`${k}: no free/value/save/bonus wording`, !banned, banned && txt[k].slice(Math.max(0, banned.index - 50), banned.index + 50));
}

// $225 tile badge: B only, and it carries the end date.
const badge = html.gift.match(/<span class="gc-tile__deal[^>]*>([\s\S]*?)<\/span>/);
if (OPTION === 'B') {
  check('gift: $225 tile badge present', !!badge);
  check('gift: tile badge reads "$200 until <end>"', !!badge && /^\$200 until [A-Z][a-z]{2} \d{1,2}(, \d{4})?$/.test(text(badge[1]).trim()), badge && text(badge[1]));
} else {
  check(`gift: no $225 tile badge for option ${OPTION}`, !badge);
}
if (OPTION === 'C' && !PREVIEW) check('C: no [bracket] placeholders in production', !/\[(X|use dates|Your limits\.|start|end|Start date|end date)\]/.test(txt.gift + txt.home + txt.policies));

// Unconfirmed claims.
const CLAIMS = [
  { id: 'gift-never-expire', re: /never expire/gi },
  { id: 'g0-gift-no-fees', re: /no fees|covers a whole visit|card covers a 90/gi },
  { id: 'gift-both-spas', re: /good at both spas|used at both spas|at either spa/gi },
];
for (const k of Object.keys(PAGES)) {
  for (const c of CLAIMS) {
    if (claims[c.id]?.resolved) continue;
    const hits = [...txt[k].matchAll(c.re)];
    if (!PREVIEW) check(`${k}: unconfirmed "${c.id}" not stated in production`, hits.length === 0, hits[0] && txt[k].slice(Math.max(0, hits[0].index - 40), hits[0].index + 60));
    else for (const h of hits) {
      const after = txt[k].slice(h.index, h.index + 220);
      check(`${k}: "${h[0]}" carries its confirmation label`, after.includes('Needs owner confirmation'), after.slice(0, 120));
    }
  }
}
// The link-preview description never carries a claim, in any build.
const desc = (giftFull.match(/<meta name="description" content="([^"]*)"/) || [])[1];
check('fix 7: gift page description is the safe wording', decode(desc || '') === 'Unique Spa House eGift cards, from $100 or your own amount. Send by text or email, today or on a date you choose.', desc);
const ogDesc = (giftFull.match(/<meta property="og:description" content="([^"]*)"/) || [])[1];
if (ogDesc) check('fix 7: og:description has no claim', !/never expire|no fees/i.test(ogDesc), ogDesc);
// Fix 6 / fix 8.
if (site.square_gift_name) check('fix 6: Square name note under the hero button', txt.gift.includes(`Our secure gift card page is run by Square. It shows the name ${site.square_gift_name}.`));
else check('fix 6: no Square name note once renamed', !txt.gift.includes('It shows the name'));
check('fix 8: "pick an amount or type your own"', txt.gift.includes('On the next page, pick an amount or type your own.'));
check('fix 8: old "You choose the amount" line gone', !txt.gift.includes('You choose the amount on the next page'));
// Fix 5: tile labels say where the TREATMENT is offered.
check('fix 5: tiles say "Offered at both spas"', txt.gift.includes('Offered at both spas'));

if (fails.length) {
  console.error(`✗ gift offer (option ${OPTION}${PREVIEW ? ', PREVIEW' : ''}): ${fails.length} failed, ${pass} passed`);
  for (const f of fails) console.error('  FAIL ' + f);
  process.exit(1);
}
console.log(`✓ gift offer: ${pass} checks passed (option ${OPTION}${PREVIEW ? ', PREVIEW' : ''}${OPTION !== 'A' ? `, ${STARTS} to ${ENDS}` : ''})`);
