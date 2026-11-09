#!/usr/bin/env node
/**
 * Test for scripts/photo-intake.mjs. Works on a throwaway copy of the manifest and TEMP files in the OS temp
 * dir, with solid-colour photos generated here (with EXIF + GPS embedded). No photo is ever written to the repo.
 */
import { mkdtempSync, mkdirSync, cpSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { intake, SLOTS } from './photo-intake.mjs';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
const realManifest = join(repo, 'src/data/asset-manifest.json');
const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const before = hash(realManifest);

let failed = 0;
const check = (ok, msg) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${msg}`); if (!ok) failed++; };

const tmp = mkdtempSync(join(tmpdir(), 'photo-intake-'));
const root = join(tmp, 'site');
mkdirSync(join(root, 'src/data'), { recursive: true });
cpSync(realManifest, join(root, 'src/data/asset-manifest.json'));
cpSync(join(repo, 'src/assets/temp'), join(root, 'src/assets/temp'), { recursive: true });

const GPS = { GPSLatitudeRef: 'N', GPSLatitude: '32/1 46/1 0/1', GPSLongitudeRef: 'W', GPSLongitude: '117/1 9/1 0/1' };
async function photo(dir, name, w, h, { colour = '#b98a6e', orientation, format = 'jpeg' } = {}) {
  let p = sharp({ create: { width: w, height: h, channels: 3, background: colour } })[format]();
  if (orientation) p = p.withMetadata({ orientation });
  p = p.withExif({ IFD0: { Copyright: 'CAMERA-SERIAL-123' }, IFD3: GPS });
  const buf = await p.toBuffer();
  writeFileSync(join(dir, name), buf);
  return buf;
}
const hasGpsTag = (exif) => !!exif && (exif.includes(Buffer.from([0x88, 0x25])) || exif.includes(Buffer.from([0x25, 0x88])));
const quiet = () => {};

try {
  // Every slot in the manifest has a spec (a new slot must be added to SLOTS).
  const manifest0 = JSON.parse(readFileSync(realManifest, 'utf8'));
  for (const a of manifest0.assets) {
    const keys = a.variants ? Object.keys(a.variants).map((v) => `${a.id}-${v.toLowerCase()}`) : [a.id];
    check(keys.every((k) => SLOTS[k]), `slot ${a.id} has an intake spec`);
  }

  // Run 1: a mixed folder.
  const in1 = join(tmp, 'in1');
  mkdirSync(in1);
  const hero = await photo(in1, 'hero-desktop.jpg', 2400, 3200);
  check(hasGpsTag((await sharp(hero).metadata()).exif), 'generated input really carries GPS EXIF');
  const turned = await photo(in1, 'Hands-4x5.JPG', 2400, 1920, { orientation: 6 });   // stored landscape, camera says rotate 90°
  const tm = await sharp(turned).metadata();
  check(tm.orientation === 6 && hasGpsTag(tm.exif), 'generated rotated input carries orientation 6 + GPS');
  await photo(in1, 'facial-1x1.png', 2000, 2000, { format: 'png' });
  await photo(in1, 'spa-doors-sd.jpg', 1600, 1856);
  await photo(in1, 'gift-card.jpg', 1920, 1211);
  await photo(in1, 'hero-4x5.jpg', 1800, 1440);         // landscape: wrong orientation
  await photo(in1, 'massage-1x1.jpg', 1000, 1000);      // too small
  await photo(in1, 'lobby-wide.jpg', 1920, 1920);       // no such slot
  await photo(in1, 'couples-placeholder.jpg', 1920, 1920); // alt mentions a price
  writeFileSync(join(in1, 'notes.txt'), 'hi');
  writeFileSync(join(in1, 'alt.json'), JSON.stringify({
    'hero-desktop': { alt: 'A therapist\'s hands resting gently on a client\'s shoulders.', focal: { x: 40, y: 60 } },
    'facial-1x1': 'A brush applying product along a client\'s jaw.',
    'spa-doors-sd': 'The entrance to our San Diego spa.',
    'gift-card': 'Should be ignored',
    'couples-placeholder': 'Couples room, $150 for two',
  }));

  const r1 = await intake(in1, { root, log: quiet });
  const placed = r1.done.map((d) => d.key).sort();
  check(JSON.stringify(placed) === JSON.stringify(['facial-1x1', 'gift-card', 'hands-4x5', 'hero-desktop', 'spa-doors-sd']), `placed the 5 good photos (${placed.join(', ')})`);
  const why = (n) => r1.refused.find((r) => r.name === n)?.why || '';
  check(/landscape photo, slot needs portrait/.test(why('hero-4x5.jpg')), 'refuses wrong orientation');
  check(/smaller than/.test(why('massage-1x1.jpg')), 'refuses too-small photo');
  check(/no slot is called "lobby-wide"/.test(why('lobby-wide.jpg')), 'refuses a file with no slot match');
  check(/not a photo type/.test(why('notes.txt')), 'refuses a non-photo file');
  check(/price/.test(why('couples-placeholder.jpg')), 'refuses alt text with a price');

  const m = JSON.parse(readFileSync(join(root, 'src/data/asset-manifest.json'), 'utf8'));
  const get = (id) => m.assets.find((a) => a.id === id);
  const h = get('hero-desktop');
  check(h.file === 'src/assets/photos/hero-desktop.jpg' && h.temp === false, 'hero-desktop: file set, temp false');
  check(h.alt.startsWith('A therapist') && h.focal.x === 40 && h.focal.y === 60, 'hero-desktop: alt and focal from alt.json');
  check(!existsSync(join(root, 'src/assets/temp/TEMP-hero-desktop.jpg')), 'replaced TEMP file deleted');
  check(get('hands-4x5').focal.x === 50 && get('hands-4x5').focal.y === 50, 'focal defaults to centre');
  check(/kept the old alt/.test(r1.warnings.join('\n')), 'warns when the old alt is kept');
  check(get('facial-1x1').temp === false && !('alt_todo' in get('facial-1x1')), 'facial-1x1: new alt removes alt_todo');
  check(get('gift-card').alt === '' && get('gift-card').temp === false, 'gift-card stays decorative (alt "")');
  const doors = get('spa-doors');
  check(doors.variants.SD.file === 'src/assets/photos/spa-doors-sd.jpg' && doors.temp === true, 'spa-doors: SD placed, slot stays temp until DM is in');
  check(get('massage-1x1').temp === true && get('hero-4x5').temp === true, 'refused slots unchanged');
  check(r1.remaining.some((t) => t.id === 'spa-doors') && !r1.remaining.some((t) => t.id === 'hero-desktop'), 'remaining temp list is correct');

  for (const d of r1.done) {
    const buf = readFileSync(join(root, d.file));
    const meta = await sharp(buf).metadata();
    const spec = SLOTS[d.key];
    check(meta.format === 'jpeg' && !meta.exif && !meta.xmp && !meta.iptc && !meta.icc, `${d.key}: JPEG with no EXIF/GPS/XMP/IPTC/ICC`);
    check(!buf.includes('CAMERA-SERIAL-123'), `${d.key}: camera serial not in the file`);
    check(meta.width === spec.w && meta.height === spec.h, `${d.key}: written at ${spec.w}×${spec.h} (got ${meta.width}×${meta.height})`);
    check(buf.length <= 2 * 1024 * 1024, `${d.key}: under 2 MB`);
  }

  // Run 2: the DM door completes spa-doors; --crop fixes a 3:2 camera original for wrap-me-up.
  const in2 = join(tmp, 'in2');
  mkdirSync(in2);
  await photo(in2, 'spa-doors-dm.jpg', 1700, 1972);
  await photo(in2, 'wrap-me-up.jpg', 3000, 2000);
  writeFileSync(join(in2, 'alt.json'), JSON.stringify({ 'spa-doors-dm': 'The way in to our Del Mar treatment room.', 'wrap-me-up': 'A client resting face down, upper back wrapped in a warm body mask.' }));
  const r2no = await intake(in2, { root, log: quiet, dryRun: true });
  check(r2no.refused.some((r) => r.name === 'wrap-me-up.jpg' && /aspect/.test(r.why)), 'wrong aspect refused without --crop');
  const r2 = await intake(in2, { root, log: quiet, crop: true });
  check(r2.refused.length === 0, 'run 2 with --crop: nothing refused');
  const m2 = JSON.parse(readFileSync(join(root, 'src/data/asset-manifest.json'), 'utf8'));
  const d2 = m2.assets.find((a) => a.id === 'spa-doors');
  check(d2.temp === false && d2.variants.DM.file === 'src/assets/photos/spa-doors-dm.jpg', 'spa-doors: temp false once both doors are in');
  const wm = await sharp(join(root, 'src/assets/photos/wrap-me-up.jpg')).metadata();
  check(wm.width === 1920 && wm.height === 1440, 'wrap-me-up cropped to 4:3 and written at 1920×1440');

  // Dry run writes nothing.
  const in3 = join(tmp, 'in3');
  mkdirSync(in3);
  await photo(in3, 'massage-1x1.jpg', 1920, 1920);
  writeFileSync(join(in3, 'alt.json'), JSON.stringify({ 'massage-1x1': 'A forearm working slowly across a back.' }));
  const mBefore = hash(join(root, 'src/data/asset-manifest.json'));
  await intake(in3, { root, log: quiet, dryRun: true });
  check(hash(join(root, 'src/data/asset-manifest.json')) === mBefore && !existsSync(join(root, 'src/assets/photos/massage-1x1.jpg')), '--dry-run writes nothing');
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

check(hash(realManifest) === before, 'real asset-manifest.json untouched');
check(!existsSync(join(repo, 'src/assets/photos/hero-desktop.jpg')), 'no test photo written into the repo');
console.log(failed ? `\nphoto-intake: ${failed} check(s) FAILED` : '\nphoto-intake: all checks passed');
process.exit(failed ? 1 : 0);
