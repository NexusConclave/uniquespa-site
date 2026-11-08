#!/usr/bin/env node
/**
 * Photo intake: puts the shoot photos live in one command.
 *
 *   node scripts/photo-intake.mjs <folder> [--crop] [--allow-small] [--dry-run] [--keep-temp]
 *
 * <folder> holds one photo per slot, named by slot id (any of .jpg .jpeg .png .webp .tif .tiff):
 *   hero-desktop  hero-4x5  lymphatic-4x5  hands-4x5  massage-1x1  facial-1x1
 *   couples-placeholder  spa-doors-sd  spa-doors-dm  gift-card  wrap-me-up
 * plus an optional alt.json:
 *   { "hero-desktop": "A therapist's hands ...",
 *     "spa-doors-sd": { "alt": "The entrance to our San Diego spa.", "focal": { "x": 50, "y": 60 } } }
 *
 * For each photo it:
 *   - refuses a file whose name matches no slot;
 *   - checks orientation, aspect ratio (±2 %) and minimum size for that slot (--crop crops to the slot's
 *     aspect around the focal point instead of refusing; --allow-small turns "too small" into a warning);
 *   - applies the camera rotation, then strips ALL metadata (EXIF, GPS location, camera serials, XMP, IPTC),
 *     converts to sRGB and writes a progressive JPEG (the format the site's sources use; the build makes
 *     the AVIF/WebP that actually ship) at the slot's size, at most 2 MB, to src/assets/photos/<slot>.jpg;
 *   - updates src/data/asset-manifest.json: file, alt (from alt.json; gift-card stays "" = decorative),
 *     focal (default centre 50/50), "temp": false (spa-doors only once both doors are in), and removes
 *     "alt_todo" when a new alt is given;
 *   - deletes the replaced TEMP file from src/assets/temp/ unless --keep-temp;
 *   - prints a summary and the slots that are still temp (the launch gate's list).
 *
 * It cannot see what is IN a photo: before committing, look at every photo for prices, text on the image,
 * screens showing prices, and faces without a signed release (CLAUDE.md rule 16).
 * Exit code 1 if any file was refused (the good ones are still written).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, unlinkSync, statSync } from 'node:fs';
import { join, extname, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { tempAssets } from '../src/lib/launch.mjs';

/**
 * Slot specs from SP/decision-packs/PHOTO-SHOT-LIST.md §1 (crop / min size). `w`×`h` is both the minimum
 * accepted and the size written (bigger photos are scaled down to it). `variant` = per-spa photo of one slot.
 */
export const SLOTS = {
  'hero-desktop':        { id: 'hero-desktop',        w: 1800, h: 2400, shot: '#1 lymphatic hero (3:4)' },
  'hero-4x5':            { id: 'hero-4x5',            w: 1440, h: 1800, shot: '#1 tighter frame (4:5)' },
  'lymphatic-4x5':       { id: 'lymphatic-4x5',       w: 1920, h: 2400, shot: '#3 lymphatic hands (4:5)' },
  'hands-4x5':           { id: 'hands-4x5',           w: 1920, h: 2400, shot: '#2 Katy portrait or hands (4:5)' },
  'massage-1x1':         { id: 'massage-1x1',         w: 1920, h: 1920, shot: '#4 deep-tissue forearm (1:1)' },
  'facial-1x1':          { id: 'facial-1x1',          w: 1920, h: 1920, shot: '#5 BABOR facial detail (1:1)' },
  'couples-placeholder': { id: 'couples-placeholder', w: 1920, h: 1920, shot: '#8 couples room (1:1)' },
  'spa-doors-sd':        { id: 'spa-doors', variant: 'SD', w: 1600, h: 1856, shot: '#9 San Diego entrance (5:5.8)' },
  'spa-doors-dm':        { id: 'spa-doors', variant: 'DM', w: 1600, h: 1856, shot: '#10 Del Mar entrance (5:5.8)' },
  'gift-card':           { id: 'gift-card', decorative: true, w: 1920, h: 1211, shot: '#12 gift card flat-lay (1.586:1), NO price' },
  'wrap-me-up':          { id: 'wrap-me-up',          w: 1920, h: 1440, shot: '#11 Wrap Me Up (4:3)' },
};

const EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff']);
const ASPECT_TOLERANCE = 0.02;
const MAX_BYTES = 2 * 1024 * 1024;

const orientation = (w, h) => (Math.abs(w / h - 1) <= ASPECT_TOLERANCE ? 'square' : w > h ? 'landscape' : 'portrait');
const ratio = (w, h) => (w / h).toFixed(3);

/** JSON in the manifest's own style: 2-space indent, short arrays of plain values on one line. */
export function formatManifest(m) {
  return JSON.stringify(m, null, 2).replace(/\[\n\s+([^\[\]{}]*?)\n\s+\]/g, (_, i) => '[' + i.split(/,\n\s+/).join(', ') + ']') + '\n';
}

function readAltFile(folder) {
  const p = join(folder, 'alt.json');
  if (!existsSync(p)) return {};
  const raw = JSON.parse(readFileSync(p, 'utf8'));
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    const key = k.toLowerCase();
    out[key] = typeof v === 'string' ? { alt: v } : { alt: v?.alt, focal: v?.focal };
  }
  return out;
}

function checkFocal(f) {
  if (f == null) return null;
  const ok = (n) => typeof n === 'number' && n >= 0 && n <= 100;
  if (!ok(f.x) || !ok(f.y)) throw new Error('focal must be { "x": 0-100, "y": 0-100 }');
  return { x: f.x, y: f.y };
}

/** Crop box of the slot's aspect, as large as possible, centred on the focal point (clamped to the image). */
function cropBox(w, h, target, focal) {
  let cw = w, ch = Math.round(w / target);
  if (ch > h) { ch = h; cw = Math.round(h * target); }
  const left = Math.min(Math.max(Math.round((focal.x / 100) * w - cw / 2), 0), w - cw);
  const top = Math.min(Math.max(Math.round((focal.y / 100) * h - ch / 2), 0), h - ch);
  return { left, top, width: cw, height: ch };
}

async function encode(pipeline, spec) {
  for (const quality of [86, 80, 74, 68]) {
    const buf = await pipeline.clone()
      .resize(spec.w, spec.h, { fit: 'cover', withoutEnlargement: true })
      .toColourspace('srgb')
      .jpeg({ quality, progressive: true, mozjpeg: true })
      .toBuffer();  // sharp writes no metadata unless asked (no keepMetadata/withExif): EXIF, GPS, XMP, IPTC, ICC are dropped
    if (buf.length <= MAX_BYTES) return { buf, quality };
  }
  throw new Error('could not get the photo under 2 MB');
}

export async function intake(folder, opts = {}) {
  const root = resolve(opts.root || join(dirname(fileURLToPath(import.meta.url)), '..'));
  const manifestPath = join(root, 'src/data/asset-manifest.json');
  const photosDir = join(root, 'src/assets/photos');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const log = opts.log || console.log;
  const alts = readAltFile(folder);
  const done = [], refused = [], warnings = [], deleted = [];
  const seen = new Map();

  for (const name of readdirSync(folder).sort()) {
    const path = join(folder, name);
    if (name.startsWith('.') || name.toLowerCase() === 'alt.json' || !statSync(path).isFile()) continue;
    const ext = extname(name).toLowerCase();
    const key = basename(name, extname(name)).toLowerCase();
    const spec = SLOTS[key];
    if (!EXTS.has(ext)) { refused.push({ name, why: `not a photo type the tool takes (${[...EXTS].join(' ')})` }); continue; }
    if (!spec) { refused.push({ name, why: `no slot is called "${key}". Valid names: ${Object.keys(SLOTS).join(', ')}` }); continue; }
    if (seen.has(key)) { refused.push({ name, why: `two files for slot "${key}" (${seen.get(key)} and ${name}); keep one` }); continue; }
    seen.set(key, name);

    const entry = manifest.assets.find((a) => a.id === spec.id);
    if (!entry) { refused.push({ name, why: `slot "${spec.id}" is not in asset-manifest.json` }); continue; }

    const given = alts[key] || {};
    let focal;
    try { focal = checkFocal(given.focal) || { x: 50, y: 50 }; } catch (e) { refused.push({ name, why: `alt.json: ${e.message}` }); continue; }
    const alt = spec.decorative ? '' : (given.alt ?? '').trim();
    if (spec.decorative && given.alt) warnings.push(`${key}: alt ignored; this photo is decorative (alt stays "")`);
    if (/\$|\b\d+\s*(dollars|usd)\b/i.test(alt)) { refused.push({ name, why: 'alt text mentions a price; photos and their alt never show prices' }); continue; }
    const target = spec.variant ? entry.variants?.[spec.variant] : entry;
    if (!target) { refused.push({ name, why: `slot "${spec.id}" has no variant "${spec.variant}" in asset-manifest.json` }); continue; }
    const keptAlt = target.alt || entry.alt || '';
    if (!spec.decorative && !alt && !keptAlt) { refused.push({ name, why: `needs alt text: add "${key}": "..." to alt.json` }); continue; }

    let img, meta;
    try {
      img = sharp(path, { failOn: 'error' }).rotate(); // apply the camera's orientation flag before measuring
      meta = await sharp(path).metadata();
    } catch (e) { refused.push({ name, why: `can't read the image (${e.message})` }); continue; }
    const swap = (meta.orientation || 1) >= 5;
    let w = swap ? meta.height : meta.width, h = swap ? meta.width : meta.height;
    const want = spec.w / spec.h;

    const wantO = orientation(spec.w, spec.h), gotO = orientation(w, h);
    const aspectOff = Math.abs(w / h / want - 1) > ASPECT_TOLERANCE;
    if (aspectOff && !opts.crop) {
      const why = gotO !== wantO
        ? `${gotO} photo, slot needs ${wantO} (${spec.w}×${spec.h}); retake/re-export, or run with --crop`
        : `aspect ${ratio(w, h)} but slot needs ${ratio(spec.w, spec.h)} (${spec.w}×${spec.h}); re-export, or run with --crop`;
      refused.push({ name, why }); continue;
    }
    if (aspectOff) {
      const box = cropBox(w, h, want, focal);
      img = img.extract(box);
      warnings.push(`${key}: cropped ${w}×${h} → ${box.width}×${box.height} around focal ${focal.x}/${focal.y}%; check the framing`);
      w = box.width; h = box.height;
    }
    if (w < spec.w || h < spec.h) {
      const why = `${w}×${h} is smaller than the slot's ${spec.w}×${spec.h}`;
      if (!opts.allowSmall) { refused.push({ name, why: `${why}; send the full-size original, or run with --allow-small` }); continue; }
      warnings.push(`${key}: ${why} (allowed by --allow-small)`);
    }

    let out;
    try { out = await encode(img, spec); } catch (e) { refused.push({ name, why: e.message }); continue; }
    const outName = `${key}.jpg`;
    const rel = `src/assets/photos/${outName}`;
    const oldFile = target.file;

    if (!opts.dryRun) {
      mkdirSync(photosDir, { recursive: true });
      writeFileSync(join(photosDir, outName), out.buf);
    }
    target.file = rel;
    target.focal = focal;
    if (!spec.decorative) target.alt = alt || keptAlt;
    else target.alt = '';
    if (!alt && !spec.decorative) warnings.push(`${key}: no alt in alt.json, kept the old alt "${keptAlt}"; check it describes the NEW photo`);
    if (alt && entry.alt_todo && !spec.variant) delete entry.alt_todo;
    if (!spec.variant) {
      entry.temp = false;
      entry.source_row = null;
      entry.source_file = name;
    }
    if (oldFile && oldFile !== rel && /\/TEMP-[^/]+$/.test(oldFile)) {
      const stillUsed = manifest.assets.some((a) => a.file === oldFile || Object.values(a.variants || {}).some((v) => v.file === oldFile));
      if (!stillUsed && !opts.keepTemp && !opts.dryRun && existsSync(join(root, oldFile))) { unlinkSync(join(root, oldFile)); deleted.push(oldFile); }
    }
    const outMeta = await sharp(out.buf).metadata();
    done.push({ key, name, size: `${outMeta.width}×${outMeta.height}`, kb: Math.round(out.buf.length / 1024), quality: out.quality, file: rel });
  }

  // Per-spa slots go live only when every variant has its photo.
  for (const a of manifest.assets) {
    if (!a.variants) continue;
    const all = Object.values(a.variants).every((v) => v.file);
    if (all && a.temp) { a.temp = false; a.source_row = null; }
    if (!all && Object.values(a.variants).some((v) => v.file)) {
      const missing = Object.entries(a.variants).filter(([, v]) => !v.file).map(([k]) => `${a.id}-${k.toLowerCase()}`);
      warnings.push(`${a.id}: stays temp until ${missing.join(', ')} is in too`);
    }
  }

  if (!opts.dryRun && done.length) writeFileSync(manifestPath, formatManifest(manifest));

  const remaining = tempAssets(manifest);
  log(`\nPhoto intake${opts.dryRun ? ' (DRY RUN: nothing written)' : ''}: ${done.length} placed, ${refused.length} refused`);
  for (const d of done) log(`  OK       ${d.name.padEnd(28)} → ${d.file}  ${d.size}, ${d.kb} KB (q${d.quality}), metadata/GPS stripped`);
  for (const r of refused) log(`  REFUSED  ${r.name.padEnd(28)} ${r.why}`);
  for (const d of deleted) log(`  deleted  ${d}`);
  if (warnings.length) { log('\nCheck:'); for (const w of warnings) log(`  - ${w}`); }
  log(`\nStill temp (${remaining.length}):${remaining.length ? '' : ' none: every slot has its real photo'}`);
  for (const t of remaining) log(`  - ${t.id.padEnd(20)} ${t.file}  → ${t.replace_with}`);
  if (done.length) {
    log('\nBefore you commit, look at every photo: no prices (gift card, screens, menus), no text on the photo,');
    log('no client faces without a signed release, no AI edits (CLAUDE.md rule 16). Then: npm run build && npm test.');
  }
  return { done, refused, warnings, deleted, remaining, manifest };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const folder = args.find((a) => !a.startsWith('--'));
  const known = ['--crop', '--allow-small', '--dry-run', '--keep-temp'];
  const bad = [...flags].filter((f) => !known.includes(f));
  if (!folder || bad.length || !existsSync(folder) || !statSync(folder).isDirectory()) {
    console.error(`${bad.length ? `Unknown option ${bad.join(' ')}\n` : folder ? `Not a folder: ${folder}\n` : ''}` +
      'Usage: node scripts/photo-intake.mjs <folder> [--crop] [--allow-small] [--dry-run] [--keep-temp]\n' +
      `Name each photo by slot: ${Object.keys(SLOTS).join(', ')} (+ optional alt.json).`);
    process.exit(2);
  }
  const res = await intake(folder, {
    crop: flags.has('--crop'), allowSmall: flags.has('--allow-small'), dryRun: flags.has('--dry-run'), keepTemp: flags.has('--keep-temp'),
  });
  process.exit(res.refused.length ? 1 : 0);
}
