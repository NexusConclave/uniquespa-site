# Unique Spa House website

The website for Unique Spa House (San Diego, Mission Valley and Del Mar). It belongs to Katy: the code lives in her GitHub account and the site is hosted on her Cloudflare account.

## For Katy: how changes happen

**Nothing reaches the live site without your OK.** Every change goes through the same four steps:

1. **Ask or edit.**
   - **Bigger changes** (new page, new wording, a new special): ask the Builder (Claude Code) in plain English, e.g. *"Add the December special from the facts sheet"*.
   - **Small changes** (approve a review, swap a photo, fix a photo description): use the simple editor, **Pages CMS** (app.pagescms.org), on the `katy-edits` branch.
2. **Preview.** A pull request opens. The site is built and checked automatically (compliance words, broken links, mobile layout, accessibility, speed). A note on the pull request asks you to **approve the preview** (Review deployments → preview → Approve); then the **preview link** appears there. Open it on your phone.
3. **Merge.** Happy with the preview? Press **Merge pull request**. Not happy? Write a comment saying what to change.
4. **Approve.** GitHub asks you to approve the **production** deployment (you get an email). Press **Review deployments → Approve**. About two minutes later it's live.

**Made a mistake?** Every live version is kept. See `ROLLBACK.md`: the quickest undo is one button in Cloudflare.

### What you can and can't change in the simple editor
| You can | You can't (on purpose) |
|---|---|
| Approve or edit **client reviews** (real words, first name + last initial) | **Prices**, **specials**, services, Square booking links |
| Replace **photos** and their descriptions | Policies, addresses, hours, phone |

Prices and specials come only from Square, through the facts sheet, so the website, Uni and the booking page always agree. A pull request that changes a price is **blocked** until you or Ian check it against Square and add the `prices-from-facts` label.

### The rules every change follows
- Medical and device treatments: only "starts with a consultation". No treatment names, prices, results or health claims. One exception (owner decision, 7 Nov 2026, Ian and Katy; lawyer review pending before launch): the separate business **Unique Med Spa** (Unique Med Spa Aesthetics Inc, medical director Dr. Steven Groke) may be named on `/med-spa/`, linked as "Med Spa" in the nav, and booked through its Vagaro page. Its wording stays behind the `med-spa-wording` flag in `confirm.json` until the lawyer approves.
- No promises of results. No "free", "value", "save" or "regular price".
- Real photos of the spa only: no before/after photos, no AI-made room photos.
- Real Square prices only.

---

## Technical section

**Stack:** Astro 7 static site, Node 22, no server code. Data in `src/data/*.json`; helpers in `src/lib/`; components documented in `COMPONENTS.md`. Builder rules: `CLAUDE.md`.

```bash
npm ci
npm run dev                 # http://localhost:4321
npm run build               # production build -> dist/ (approved content only)
PREVIEW=1 npm run build     # staging build: draft offers/unapproved reviews render, marked as drafts
BUILD_DATE=2026-12-01 npm run build   # build as if it were another day (offer windows)
npm test                    # widget syntax + compliance/leak check + links + browser tests (Home, motion)
bash scripts/rollback-drill.sh        # local proof that git revert restores the build
```

`npm test` needs Python 3 with Playwright and Chromium (`pip install playwright==1.63.0 && python -m playwright install chromium`). Test screenshots go to `shots/` (ignored by git).

### CI/CD (`.github/workflows/`)
| Workflow | Trigger | What it does |
|---|---|---|
| `pr-checks.yml` | Pull request to `main` | Price guard → `npm ci` → `npm run build` → `npm test` → keeps the built site (`dist`, `functions`, `src/lib`) as an artifact. Runs the PR's code, so it has **no secrets and no environment**. |
| `preview-deploy.yml` | "PR checks" finished OK (`workflow_run`; always main's copy of this file) | Never checks out PR code. Checks the PR (open, this repo, targets `main`, head = the tested commit), downloads the artifact, checks it (`.github/scripts/validate-preview-bundle.sh`: allowed folders only, no `.github`/npm files/symlinks, size limits), swaps in **main's** `wrangler.toml`, names it `pr-<number>-<branch>` (never `main`) → waits for approval in the **`preview`** environment → `wrangler pages deploy` as a preview → comments the URL on the PR |
| `production.yml` | Push to `main`; manual run on `main` with a `ref` (rollback) | The `ref` must already be on `main`; price guard (a price change needs the merged PR's `prices-from-facts` label, or the `prices_checked` tick on a rollback) → build + test again → waits for approval in the **`production`** environment → `wrangler pages deploy --branch=main` |

Secrets: **environment secrets only**, never repository secrets (a pull request's workflow can read repository secrets). `production`: `CLOUDFLARE_API_TOKEN` (Account → Cloudflare Pages → Edit) and `CLOUDFLARE_ACCOUNT_ID`. `preview`: `CLOUDFLARE_PREVIEW_API_TOKEN` (a second token, same rights) and `CLOUDFLARE_ACCOUNT_ID`. Cloudflare can't limit a token to preview deployments (a token that can publish a preview can also publish to production), so **both environments need Katy's approval and allow only `main`** (Settings → Environments → Required reviewers; Deployment branches → Selected → `main`). Optional repository variables: `CF_PAGES_PROJECT` (default `unique-spa-house`), `STAGING_URL` (see below). The Cloudflare Pages project must be a **Direct Upload** project, not Git-connected, so Cloudflare never builds or publishes on its own and the approval gate can't be bypassed.

Actions are pinned to full commit SHAs (the version is in a comment next to each). To update one, look up the new release's commit SHA on GitHub and change both.

### Facts file (prices)
The owner's full `facts.json` (Square-confirmed prices plus internal notes) lives **outside** this repo and is never committed (`.gitignore` blocks `facts/facts.json`). The repo holds only its public subset, `facts/facts.public.json`: services, prices, durations, locations, this month's special, gift card amounts, published policies and hours. After the owner's file changes, regenerate it with `node scripts/make-public-facts.mjs /path/to/facts.json` (and check it with `node scripts/make-public-facts.mjs --check /path/to/facts.json`). `npm test` checks the public file has no internal notes and prices the site against it.

Preview = the production build of the PR branch (built by `pr-checks.yml`, published by `preview-deploy.yml` with main's bindings: previews talk to the acceptance Worker), so what Katy reviews is exactly what would go live. All pages stay `noindex` (enforced by `scripts/check-leaks.mjs`) until the launch PR.

### Simple editor (`.pages.yml`)
Pages CMS edits only `src/data/reviews.json` and `src/data/asset-manifest.json` (+ uploads to `src/assets/photos/`). Edits commit to the `katy-edits` branch; `main` is protected, so they reach the live site only through a PR.

### Shoot photos: one command (`scripts/photo-intake.mjs`)
Put the shoot photos in one folder, each named by its slot, plus an optional `alt.json`, then:
```bash
npm run photos -- ~/Downloads/ush-photos            # add --dry-run to check first, --crop to crop camera originals to the slot
npm run build && npm test
```
- **File names (= slot ids):** `hero-desktop`, `hero-4x5`, `lymphatic-4x5`, `hands-4x5`, `massage-1x1`, `facial-1x1`, `couples-placeholder`, `spa-doors-sd`, `spa-doors-dm`, `gift-card`, `wrap-me-up` (`.jpg` `.png` `.webp` `.tif`). Sizes and shapes: `SLOTS` in the script (from the shot list).
- **`alt.json`:** `{ "hero-desktop": "A therapist's hands ...", "spa-doors-sd": { "alt": "...", "focal": { "x": 50, "y": 60 } } }`. Focal defaults to the centre. `gift-card` stays decorative (alt `""`). A new alt also clears that slot's `alt_todo`.
- **What it does:** refuses files with no slot match, the wrong orientation/aspect (±2 %) or below the slot's size; applies the camera rotation and **strips all metadata (EXIF, GPS location, camera serials)**; writes an sRGB JPEG ≤ 2 MB to `src/assets/photos/<slot>.jpg` (the build makes the AVIF/WebP); updates `asset-manifest.json` (`file`, `alt`, `focal`, `"temp": false`; `spa-doors` only once both doors are in); deletes the replaced `TEMP-*` file; prints a summary and the slots still temp.
- **What it can't check:** what is in the picture. Look at every photo before committing: **no prices** (gift card, screens, menus), **no text on the photo**, no client faces without a signed release, no AI edits (CLAUDE.md rule 16).
- Tested by `scripts/test-photo-intake.mjs` (part of `npm test`) with generated solid-colour images in a temp folder; never commit test photos.

### Known quirks
- `ServiceCard`, `ServiceRow` and `BookChooser` use `Math.random()` for radio-group ids, so two builds of the same commit differ in those ids only. The rollback drill normalises them. A deterministic id would make previews byte-comparable (good first Builder PR).
- Until launch, builds use the **staging host** as their canonical URL: `site.json` `urls.staging` (the Cloudflare Pages project address), or the `STAGING_URL` environment variable / repository variable when a separate staging server is used. Switching to `uniquespahouse.com` is part of the launch PR (with the `noindex` removal and its test rule).
