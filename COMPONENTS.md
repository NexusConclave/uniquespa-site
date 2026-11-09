# Unique Spa House — components and data (phase A)

Shared pieces for devs B and C. Everything here follows `research/manager/blueprint-final.md` (§4.0 chrome, §5 design system, §6 motion) and `site-data/BUILD-BRIEF.md`. If you need something that isn't here, add it as a component and document it below rather than styling one page by hand.

## Ground rules (read first)

- **Prices, minutes and booking links come only from `src/lib/catalog.ts`.** Never type a price, a Square id or a booking URL into a page.
- **Status gate:** `getService(id)` throws at build time for anything that isn't `live`. `hold`, `consult` and `hidden` items must never be named, priced or linked. `npm run test:leak` fails the build output if one slips through.
- **One filled Book per screen.** The header pill (desktop) and the bottom bar (mobile) are the filled Book. In-page Book buttons are `outline`.
- **Sentence case, no tracked caps, left-aligned body.** Italics only for one accent word in an H1/H2 (`<em>`).
- **Text never sits on a photo.** No star glyphs. No "reg.", "valued at", or "free" inside a paid offer.
- **Arches** (`ArchFrame`, `SpaDoor`, `DoorStage`) are for people and the two spas only, and only one arch moment in view at a time. The animated one is Home only.
- **Booking links open in a new tab** with a screen-reader hint, and carry `data-track="book_click"` + `{spa, service, placement}`.
- Builds: `PREVIEW=1 npm run build` for staging (draft offers and unapproved quotes render, each marked as a draft). `BUILD_DATE=YYYY-MM-DD` fakes "today" to preview a future month.

## Data (`src/data/`)

| File | What | Who edits |
|---|---|---|
| `services.json` | Site catalog: id, name, group, `status` (live/hold/consult/hidden), `medical`, options (square_id, price, minutes, locations), summary, flagship URL | Dev (status changes need owner/counsel answers) |
| `square-lock.json` | Square snapshot (2026-10-23): ids, prices, minutes, locations, `booking_base` per spa, `gift_card_url`. **Prices are read from here** and override services.json | Sync job only |
| `offers.json` | Every offer in the plan (§8) with `starts`/`ends`, `spa`, `square_id?`, `approved:false`, `owner_confirm`; plus `bar_gift_windows` (Gift replaces Call in the bar) | Owner (via CMS later) |
| `site.json` | Phone, SMS, email, both spas (addresses, `hours_text`, `hours` or `null`, page, directions, review link), rating line + `rating_checked`, social, feature flags (`refer_live`, `rewards_live`, `first_visit_live`, `google_booking_live`) | Owner/dev |
| `reviews.json` | Quotes, first name + last initial, `approved:false` (render only in PREVIEW) | Owner (with each reviewer's OK) |
| `confirm.json` | Unconfirmed facts and promises (QA M7/M8): `claims.{id}` with `owner_confirm`, `resolved`, `what`. See `Confirm` below | Owner (dev flips `resolved`) |
| `asset-manifest.json` | Every shipped image: file, source row, use, `temp`, `replace_with` (shoot #), focal point, alt | Dev/photo |

## Helpers (`src/lib/`)

```ts
import { liveServices, getService, findLiveService, getOption, bookUrl, spaBookingUrl, giftUrl,
         formatPrice, formatMinutes, spokenMinutes, optionPriceText, spasFor, isSingleSpa,
         NO_PRICE_TEXT, VARIABLE_PRICE_TEXT, SPAS, type Spa } from '../lib/catalog';
```

- `liveServices(group?)` — live services in `massage | facials | body`, menu order (dated offer items excluded).
- `getService(id)` — one live service (throws for gated ids). `findLiveService(id)` returns null instead.
- `getOption(service, minutes | label)` — one option, e.g. `getOption(getService('swedish'), 60)`.
- `bookUrl(squareId, spa)` — `booking_base[spa] + "/" + squareId`, or **null** if the item isn't offered at that spa (never a Del Mar link to a San Diego-only item) or isn't live.
- `spaBookingUrl(spa)`, `giftUrl()` — the spa's Square service list; the Square eGift page.
- `optionPriceText(option)` — `$150`, or "Price set at your visit" for Square's variable price (Signature custom facial). `formatPrice(null)` → "Pricing at consultation".
- `formatMinutes(60)` → `60 min`; `formatMinutes(135, 'visit')` → `2 hr 15 min`. `spokenMinutes(60)` → `60 minutes`.

```ts
import { activeOffers, upcomingOffers, monthSpecial, offerBookUrl, isDraft, giftBarActive } from '../lib/offers';
```

- `activeOffers({ kind?, spa?, today? })` — offers that render today: `(approved || PREVIEW) && starts <= today <= ends` (Los Angeles dates). Featured first.
- `upcomingOffers({ kind?, days })` — about to start; render them `hidden` with `data-starts` + `data-reveal-on-start` and the client reveals them on the day.
- `monthSpecial(spa)` — "this month's special" for the Book sheet. `offerBookUrl(offer, spa)` — its Square special-price item (no codes), or **null** when the offer has no `square_id` of its own. A special is never linked to the general booking page.
- `needsSquareItem(offer)` — true for a special, series or first-visit offer without its own `square_id`. Production builds don't render such an offer (and log a warning); PREVIEW shows the card with "Needs its own Square item before it can be booked" and no Book button. Don't reuse another month's item (Royal Foot & Glow in November must get its own).
- Anything you render from an offer must carry `data-ends="{offer.ends}"` (and `data-starts`) so it hides client-side after its end date.

```ts
import { site, spa, PREVIEW, ratingVisible, addressLine } from '../lib/site';
import { review, reviewsFor } from '../lib/reviews';        // null / [] unless approved or PREVIEW
import { asset, widthsFor, objectPosition } from '../lib/images';  // asset('massage-1x1') → { src, alt, focal }
import { TREATMENTS, SPAS_LINKS, offerLinks, isCurrent } from '../lib/nav';
import { todayLA, shortDate, longDate } from '../lib/dates';
```

Images: always go through `asset(id)` + `astro:assets` `<Picture formats={['avif','webp']} widths={widthsFor(src)} …>`. Widths 640/1280/1920 (capped at the source). Nothing over 200 KB ships (the test checks). Pass `formats={a.formats}`: a manifest entry can set `"formats": ["webp"]` where AVIF comes out larger (the facial frame does). New TEMP images: add a crop to `scripts/make-temp-images.py`, name it `TEMP-*.jpg`, list it in the manifest.

## Layout

### `BaseLayout` (`src/layouts/BaseLayout.astro`)
Every page. Head (title, description, robots meta and canonical from the launch switch — staging: `noindex, nofollow` + `<staging host>{path}`; launch: `index, follow` + `https://uniquespahouse.com{path}` — OG basics, Instrument Serif preload, Pause-motion pre-paint script), `ClientRouter`, skip link → `#main`, Header, `<main id="main">`, Footer, BottomBar, BookSheet, MobileMenu and the persisted Uni host.

| Prop | Type | Notes |
|---|---|---|
| `title` | string | ≤ 60 chars, no "med spa" (§11). Only exception: `/med-spa/` may use "Unique Med Spa" (owner decision 7 Nov 2026, lawyer review pending; see `scripts/check-leaks.mjs` `MED_SPA_ALLOW`) |
| `description` | string? | defaults to the site description |
| `path` | string? | canonical path; defaults to the URL |
| `jsonLd` | object? | emitted as one `<script type="application/ld+json">`; use an `@graph`. No AggregateRating |
| `ogImage` | string? | root-relative or absolute |
| `bodyClass` | string? | |

Slots: default; `head` for extra head tags.

```astro
<BaseLayout title="Couples Massage in San Diego | Unique Spa House" description="…" jsonLd={graph}>
  …
</BaseLayout>
```

After every ClientRouter navigation focus moves to `main h1` (give each page exactly one H1) and the router announces the title.

## Chrome (already in BaseLayout — don't add again)

- **`Header`** — desktop (≥1024px): logo · Treatments ▾ · Our spas · Offers ▾ · About | Gift cards · Ask Uni · **Book** (filled pill). Sticky, solid. Dropdowns are click/Enter disclosures (`button[aria-expanded]` + `[data-disclosure]`), never hover. Mobile: logo + Menu, not sticky. Offers lists This month + Gift cards, and Refer/Rewards once their `site.json` flags are on. The nav never changes by season.
- **`MobileMenu`** — `<dialog id="mobile-menu">`; Book, Call, Text us, Ask Uni first (QA m-18), then Treatments, Our spas, Offers (expanded), About, Contact, and Pause motion at the foot.
- **`Footer`** — dark brown; both addresses, hours, Book/See the spa/Directions per spa, Google review link (San Diego), phone, Text us, email, Explore, Offers (mirrors the nav) + "Change or cancel a booking" (→ `/policies#canceling`; there is no Square self-serve link), Policies/Privacy/Accessibility/Terms, Instagram/Facebook, Pause motion.
- **`BottomBar`** (<1024px) — Book (filled) · Call · Ask Uni. Fixed and solid from first paint; un-sticks below 500px tall; `html { scroll-padding-bottom }` = its height. Gift replaces Call inside `offers.json` `bar_gift_windows`. After hours at a spa with known hours, Call opens "Call and leave a message · Text us · Ask Uni · Book online"; Del Mar (hours unknown) always dials.
- **`BookSheet`** — `<dialog id="book-sheet">`. Spa radio group (remembered in `localStorage['ush-spa']`, then shown as "Booking at Del Mar · Change"), six Square deep links per spa (§4.0 table; this month's special replaces its own service's row or row 6, with the regular row as a client-side fallback after `ends`), "Full menu" last. Rows read "Swedish massage, 60 minutes, $150, San Diego". Rows are defined in `src/lib/booksheet.ts`.
- **`UniHost`** — `<div id="uni" transition:persist="uni">`. The widget (`public/chat/spa-chat.js` + `.css`, adapted from `bot/chat/`) loads on the first Ask Uni tap and is never auto-opened. Text chat is a true modal (aria-modal, focus trap, inert background, full screen on mobile) with a tap-to-start AI notice; voice asks first (recording notice) and a live call can be minimised to a non-modal call strip that survives page changes. `window.UniChat.open(opener)` / `.close()` / `.isOpen()` / `.inCall()`.

### Opening things from your pages

| Attribute | Effect |
|---|---|
| `data-open="book"` | opens the Book sheet (any Book not tied to a service). Put it on `<a href="/menu">` (Button does this for `open="book"`), so Book works without JS; the opener runs in the capture phase, ahead of ClientRouter, and leaves modifier-clicks alone |
| `data-open="uni"` | loads + opens Uni (use for every "Ask Uni" / "Not sure? Ask Uni") |
| `data-open="menu"` | mobile menu |
| `data-track="event"` + `data-track-props='{"spa":"SD","service":"swedish","placement":"flagship"}'` | calls `window.track(event, props)` (a no-op stub until analytics is chosen). Events: `book_click`, `call_click`, `text_click`, `gift_card_click`, `chat_open`, `voice_start`, `lead_submitted`, `offer_view` (auto for `[data-offer-view]`) |
| `data-ends="YYYY-MM-DD"` / `data-starts` | hidden client-side outside the window (LA date) |
| `data-hide-after="YYYY-MM-DD"` | hidden after that date (rating line) |

## Content components (`src/components/`)

### `Button`
```astro
<Button open="book" track="book_click" trackProps={{ placement: 'flagship' }}>Book a visit</Button>
<Button href={giftUrl()} external icon="gift" track="gift_card_click">Buy a gift card</Button>
<Button href="/menu" variant="outline" iconEnd="arrow-right">See prices</Button>
```
Props: `href?`, `variant` (`outline` default | `filled` — reserved for the one Book per screen, or a modal's own primary), `size` (`md`|`sm`), `block`, `external` (new tab + sr hint), `open` (`book`|`uni`|`menu`), `icon`/`iconEnd` (Icon names), `track`, `trackProps`, any other attribute passes through. Utility classes also exist: `.btn .btn--outline`, `.link-quiet` (text button, 44px target), `.link-arrow` (text link + arrow).

### `Section`
```astro
<Section tone="paper" labelledby="faq-title" width="narrow">…</Section>
```
Props: `id`, `tone` (`cream` default | `paper` | `sand` | `brown` — one brown band per page plus the footer), `width` (`default` 1200 | `wide` 1360 | `narrow` 760 | `full`), `pad` (`default` | `tight` | `none`), `reveal` (default true: one fade-and-rise per section as it enters; see Motion), `labelledby`/`label`, `class`, `innerClass`. Note: page-scoped CSS can't reach a component's root — style `class` you pass with `:global(.your-class)`.

### `ServiceCard`
A live service with duration radio chips, price announced via `aria-live`, location chips and one "Book in {city}" per spa.
```astro
<ServiceCard service="lymphatic" />                                   <!-- card -->
<ServiceCard service="katy" variant="feature" defaultMinutes={90} />  <!-- flagship summary box: serif price 40–56px -->
<ServiceCard service="deep-tissue" onlySpa="DM" />                    <!-- Del Mar view: only Del Mar options/links -->
```
Props: `service` (id, required), `variant` (`card`|`feature`), `defaultMinutes`, `onlySpa` (`SD`|`DM`), `headingLevel` (2–4, default 3), `title`, `summary` (`null` hides it), `showTitle`, `placement` (analytics), `class`; default slot appends content. Single-spa services show an outline chip with the Phosphor Light-style map pin, "San Diego only" (no emoji), and only "Book in San Diego". Options offered at one spa only (e.g. Deep tissue 120) switch the chips and hide the other spa's button when chosen.

### `ServiceRow`
Same behaviour as ServiceCard, laid out as a menu row with a hairline divider (for `/menu` and hub lists).
```astro
{liveServices('massage').map((s) => <ServiceRow service={s.id} />)}
```
Props: `service`, `onlySpa`, `headingLevel`, `title`, `summary`, `placement` (default `menu`), `class`.

### `BookChooser`
A service-tied Book for one option. One spa → direct "Book in San Diego". Both → a disclosure button (e.g. "Book lymphatic ▾") revealing one deep link per spa.
```astro
<BookChooser service="lymphatic" minutes={60} label="Book lymphatic" placement="flagship" />
```
Props: `service`, `minutes?`, `label`, `placement`, `align` (`start`|`end` panel), `class`.

### `NoPriceCard`
For anything without a published price: label "Pricing at consultation", primary "Call to book a consultation" (tel:), secondary Text us · Ask Uni. **Neutral titles only — never name a gated treatment.**
```astro
<NoPriceCard title="Start with a consultation" body="Leave your name and number and we'll call or text you." />
```
Props: `title`, `body?`, `headingLevel`, `class`; slot for extra content.

### `SpecialCard`
One dated offer: "Ends Oct 31" pill, includes list (or body), minutes + offer price, location chips, Book per spa (special-price item), "Give it as a gift". Carries `data-ends`/`data-starts`/`data-offer-view`. Drafts show "Draft offer — needs owner approval".
```astro
{activeOffers({ kind: 'special' }).map((o) => <SpecialCard offer={o} />)}
```
Props: `offer` (from `offers.ts`), `spa?` (`SD`|`DM`: on a spa page, show only that spa's Book button), `headingLevel`, `variant` (`card`|`compact`), `showGift` (default true), `placement`, `class`. No `square_id` → no Book button (see `needsSquareItem`). Show "Save $X vs booking separately" only when every part is a menu item at that spa (put it in the offer's `body` in offers.json once checked); never a former price.

### `PullQuote`
```astro
<PullQuote review="anna-k" size="large" tone="dark" />   <!-- on the brown band -->
<PullQuote review="jessica-m" />                         <!-- small, on light grounds -->
```
Props: `review` (id or object), `size` (`large`|`small`), `tone` (`dark`|`light`), `class`. The opening quote hangs into the margin from 640px up only. Renders nothing unless approved (or PREVIEW → "Draft quote — needs owner and reviewer OK"). Never next to an incentive or a review ask; no carousels.

### `RatingLine`
"4.7 on Google · 103 reviews · San Diego" — plain 14px, no stars. Renders only while `rating_checked` ≤ 45 days old (and hides client-side after). Props: `tone` (`light`|`dark`), `class`.

### `ArchFrame` (static arch)
```astro
<ArchFrame asset="hands-4x5" ratio="4 / 5" sizes="(min-width: 900px) 34vw, 80vw" />
```
`clip-path: inset(0 round 50cqi 50cqi 0 0)` on the image — a true semicircle at any width. Props: `asset` (manifest id or Asset), `ratio`, `sizes`, `alt` (overrides manifest), `loading`, `class`. People and the two spas only.

### `SpaDoor`
The CSS arch-outline door for one spa (no photo until shoots #9/#10): name, address, hours, "See the spa" and Directions. Use two side by side (stack on mobile) — the pair is one arch moment.
```astro
<div class="doors"><SpaDoor spa="SD" /><SpaDoor spa="DM" /></div>
```
Props: `spa`, `headingLevel`, `class`.

### `GiftCardVisual`
Decorative CSS gift card (aria-hidden) until shoot #12. Props: `amount?` (e.g. "$225"), `class`.

### `DoorStage` (Home only)
The "Come in" signature moment (§6.1). Put the hero H1 block in its slot. Landscape ≥768px: H1 block left, arch right; 0–20% the block rises 24px and fades (then `visibility:hidden`), 15–55% the arch opens, then holds. Phones and **all portrait screens** (QA M5): H1 block above, arch widens 0–55%. Never upscaled (QA M4): srcsets stop at the source width, the opened door is capped at the source width (900px, centred) and the 4:5 crop at 720×900; lift the caps when the shoot delivers 2560px frames. Static (reduced motion, Pause motion, < 500px tall, no `animation-timeline`): no sticky, no dead scroll. With JS on, the photo also settles from scale 1.06 to 1 on load, in every browser. Props: `desktop`/`mobile` manifest ids, `titleId`. Don't reuse on other pages.

### `StubPage`
Placeholder used by the phase-A stubs (title, H1, "Coming soon", Book/Uni/Home). Delete the import when you build the real page.

### Small pieces
- `Icon name="pin|phone|message|gift|calendar|clock|arrow-right|arrow-up-right|chevron-down|close|menu|instagram|facebook|check|pause|play"` — inline line icons, `aria-hidden` unless `label` is passed.
- `LotusMark` — the lotus (logo and Uni's mark only). Interim drawing until the P0 SVG.
- `MotionToggle` — Pause motion (aria-pressed, `localStorage['ush-motion']`); already in the footer and mobile menu.
- `JsonLd data={…}` — one JSON-LD block (BaseLayout's `jsonLd` prop uses it).
- **`Confirm` / `ConfirmNote`** (`lib/confirm.ts`) — for a claim listed in `confirm.json`: `<Confirm id="gift-both-spas">claim<Fragment slot="fallback">safe wording</Fragment></Confirm>`, or `claimVisible(id)` in frontmatter plus `<ConfirmNote id />` after the claim. Resolved → shown. Pending + PREVIEW → shown with "Needs owner confirmation (…)". Pending in production → the fallback (or nothing), logged; `CONFIRM_STRICT=1` fails the build.

### Launch switch (`src/data/site.json` → `"launch"`, read by `src/lib/launch.mjs`)
One line flips the whole site from staging to live. `false` (default) = staging: canonical = the staging host (`urls.staging`, or env `STAGING_URL`), every page `noindex, nofollow`, `robots.txt` disallows all, no `sitemap.xml`, `_headers` adds `X-Robots-Tag: noindex` to every response. `true` = live: canonical `https://uniquespahouse.com`, pages `index, follow`, production `robots.txt` + `sitemap.xml`; `*.pages.dev` previews still answer `X-Robots-Tag: noindex`. Test builds: `LAUNCH=1` / `LAUNCH=0` override; `PREVIEW=1` always builds staging. `refer_live` needs the launch switch on.

### Hosting files (`public/_redirects`, `public/_headers`, Cloudflare Pages)
`_redirects`: the old Duda addresses → new pages, 301 (medical/device pages → `/consultations/`). `_headers`: CSP (own files, ElevenLabs voice, Cloudflare Web Analytics; inline scripts by sha256, which the postbuild fills in), HSTS, nosniff, frame denial, referrer and permissions policy, long cache for `/_astro/*`.

### Deterministic ids (`src/lib/uid.ts`)
`pageUid(Astro.locals, base)` gives repeated components (ServiceCard, ServiceRow, BookChooser) ids unique per page in render order (`base`, `base-2`, …). No `Math.random()`: two builds of the same commit are byte-identical (`npm run test:repro`).

### Build output (`integrations/postbuild.mjs`)
After the build: internal `href`s, canonical/`og:url` and JSON-LD URLs get the trailing slash the static server uses (no redirect hop); on a launch build `sitemap.xml` (every page except 404, /refer and /rewards) and the production `robots.txt` are written; `_headers` gets its CSP script hashes (and, on staging, the noindex header). `/rewards` lives at `src/pages/rewards/[...path].astro` and exists only when `site.flags.rewards_live` or PREVIEW.

### Dev C additions (backward compatible)
- **`DocPage`** — long-form text pages (`/policies`, `/privacy`, `/accessibility`, `/terms`): hero (eyebrow, H1, lede, `dateLine`), a PREVIEW-only `draftNote`, an "On this page" `toc` (sticky side column ≥1024px, wrapped links below) and prose styles for the slot. Each section is `<section id aria-labelledby><h2 id>…</h2>…</section>`; toc ids must match (link check).
- **`SpecialCard`** — default `<slot />` (rendered after the Book buttons, before the draft note; `/specials` puts per-card terms there) and an automatic "Save $X vs booking separately (A $a + B $b)" line from `offerSaving()`. Both render nothing for existing callers.
- **`lib/offers.ts`** — `offerById(id)` (renderable offer, dates not checked) and `offerSaving(offer)`: needs `parts: [{ service, minutes | label }]` in offers.json; returns null unless every part is a live, fixed-price menu item offered at every spa of the offer (prices from the catalog). No current offer has `parts`, so no saving line shows today.
- **`Icon`** — `alert` (form errors: always icon + text), `mail`, `copy`, `share`.
- **`/refer`** lives at `src/pages/refer/[...path].astro`: `getStaticPaths` emits it only when offers.json `referral-25` is approved or `PREVIEW=1`; production builds without approval have no /refer at all. Linked only once `site.flags.refer_live` is on.
- **Forms and ClientRouter:** the router listens for `submit` on `document` and turns any form it reaches first into a GET navigation (the visitor's name and phone in the URL). Register form handlers in the **capture phase** (`addEventListener('submit', fn, true)`), call `preventDefault()` first, and add `data-astro-reload` to the `<form>`. `/contact` does both; `scripts/test-c.py` asserts the URL never changes on submit.
- Tests: `python3 scripts/test-c.py` (or `DIST=… python3 scripts/test-c.py`) — dev C pages: screenshots → `shots/C-*.png`, axe, /specials and /gift-cards date gates (fake clock), /contact payloads and thank-you states with `/api/lead` mocked, /refer share box.

## Motion (`src/styles/motion.css`, `src/scripts/motion.ts`)

The effect list, and where each one appears, is in `shots/motion/EFFECTS.md`. Rules for new pages:

- **You rarely need to do anything.** Reveals attach by selector:
  - `Section` content, every `main h2` (word by word), images in `figure`, `.card__media` or `.b-media`
  - `.b-cards`, `.b-duo`, `.b-ticks`, `.b-rows` and `.b-steps` children
  - spa doors and the gift card
- **Adding a new list or grid that should stagger:** add its selector to the `rise` group in `motion.ts`.
- **Only below-the-fold elements are armed** (`[data-rv="kind"]`, hidden until `.is-in`). Anything on the first screen is left alone. With JS off, reduced motion or Pause motion, nothing is armed or hidden.
- **The head script sets `html[data-fx]`**, which allows the CSS load sequences, and `data-fx-intro` on the first page of a visit, which draws the header lotus once.
- **Never animate the H1.** Hero photos only scale; they never fade, because they're LCP candidates.
- **H2 word split:** the original text stays in `.fx-sr` for assistive tech, and the visual copy is `aria-hidden`. Headings that contain a link, button or icon are skipped.
- **Moving content needs a pause control.** `TreatmentTicker` (Home band) has a visible Pause/Play button, pauses on hover and focus, takes its names from `liveServices()`, and is a static list when motion is off.
- **Parallax:** `<ArchFrame parallax>` or `data-parallax` on a figure. Use at most two per page.
- **Allowed properties:** transform/translate/scale/rotate, opacity, clip-path and stroke only, at 400–900 ms. Nothing loops except the ticker.
- **Tests:** `python3 scripts/test-motion.py`, also part of `npm test`, covers:
  - every page at 390 and 1440, with and without scroll-driven CSS
  - reduced motion, Pause motion and JS off
  - accessible names and the ticker
  - CLS and throttled LCP

## Tokens and utilities (`src/styles/global.css`)

Colours `--bg #F2E8DA`, `--paper #FAF6F0`, `--sand #DCCFBF`, `--text #341204`, `--text-muted #694E40`, `--text-soft-lg #80685A` (24px+ only), `--border-ui`, `--focus #B4532A`, `--btn`/`--btn-hover`/`--btn-active`, `--error #9B2C1F`, `--on-dark`, `--on-dark-muted`, `--on-dark-border`, `--hairline`. Type `--fs-h1/h2/h3`, `--fs-body` (17→18), `--fs-label` (15), `--fs-meta` (14, the minimum), `--fs-price` (40→56). Layout `--container 1200`, `--gutter 16→64`, `--section`, `--radius-card 10px`, `--tap 44px`, `--header-h` (72 desktop / 0 mobile), `--bar-total`.

Classes: `.container`, `.container--wide`, `.container--narrow`, `.eyebrow`, `.label`, `.meta` (+ `<b>` for the price), `.lede`, `.price-display`, `.serif`, `.sr-only`, `.tone-*`, `.on-dark`, `.reveal`, `.line-reveal > .line` (keeps phrase breaks; every H2 now reveals word by word), `.hover-zoom`, `.draft-note`.

## Tests

```bash
PREVIEW=1 npm run build
npm run test:leak     # no hold/consult/hidden names, medical terms, former prices, "free", stars; robots meta right for the mode on every page
npm run test:launch   # launch switch: robots/sitemap/canonical per mode, _headers parse + CSP hashes, every _redirects target exists, unique ids
npm run test:repro    # two builds byte-identical (not in npm test: builds twice)
npm run test:links    # 0 dead internal links (incl. #fragments); both checks take DIST=… for a production outDir
python3 scripts/test-home.py   # screenshots → shots/, hero geometry + never-upscaled, first screen, static modes, keyboard, no-JS Book, 320px reflow and 390px text spacing on every page, axe, budgets
npm test                       # widget syntax + leak + links + launch + test-home + motion + tracking
```

## Dev B additions (service and spa pages)

New props (old behaviour unchanged): `ServiceCard`/`ServiceRow` `showWhere={false}` hides the location chips (a spa's own page); `ServiceRow` `linkFlagship` links the name to its flagship, `showAllPrices` adds "60 min $150 · 90 min $200" (with "(San Diego only)" per option), `id`. `SpaDoor` `showLinks={false}`. `serviceView` shows a ranged length ("60 to 120 min") instead of Square's booking block.

| Component | Use |
|---|---|
| `PageIntro` | Breadcrumb + one H1 (`title` may hold one `<em>`) + lede + actions; `aside` slot (summary box, image, arch, door) |
| `Faq` | Visible Q&A list; pair with `faqNode(items)` from `lib/schema.ts` (FAQPage only where the FAQ is visible) |
| `PriceTable` | Every length/price of one service with a Book link per spa per row ("Not offered" otherwise) |
| `SpaPanel` | One spa's address, hours, phone/Text us, Book (a given service/length or the spa page), Directions |
| `SpaServices` | Everything bookable at one spa (`onlySpa`), grouped, then "Only at {spa}" |
| `ConsultForm` | T0 consultation form: name, phone, spa + honeypot `website` → JSON `/api/lead`, source "consultation form"; capture-phase submit + `data-astro-reload`, never a GET |
| `AskUni`, `HealthNote`, `LastReviewed` | "Not sure? Ask Uni" prompt; the standard health note; "Last reviewed {date}" |

`lib/schema.ts` — `graph()`, `orgNode()`, `spaNode(sp)` (no openingHours while hours are unknown), `serviceNode(service)` (Offers at exact lock prices, none for variable prices), `offersFor()`, `breadcrumbNode()`, `faqNode()`. `lib/pageHelpers.ts` — `priceOf`, `priceList`, `lengthsOf`, `servicesAt`, `onlyAt`, `displayName` (claims-log renames, e.g. "Pure Cleanse and Rebalance facial"), `summaryOf` (copy-file one-liners). Shared page CSS: `src/styles/pages-b.css` (`b-` prefix). Tests: `python3 scripts/test-devB.py [dist]`.
