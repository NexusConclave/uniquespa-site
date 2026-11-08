// Copies the self-hosted WOFF2 files from the @fontsource packages into public/fonts with stable names,
// so the layout can preload Instrument Serif by URL. Runs before dev and build.
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
const require = createRequire(import.meta.url);
const serif = dirname(require.resolve('@fontsource/instrument-serif/package.json'));
const sans = dirname(require.resolve('@fontsource-variable/bricolage-grotesque/package.json'));
const out = new URL('../public/fonts/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const files = [
  [join(serif, 'files/instrument-serif-latin-400-normal.woff2'), 'instrument-serif-latin.woff2'],
  [join(serif, 'files/instrument-serif-latin-ext-400-normal.woff2'), 'instrument-serif-latin-ext.woff2'],
  [join(serif, 'files/instrument-serif-latin-400-italic.woff2'), 'instrument-serif-latin-italic.woff2'],
  [join(serif, 'files/instrument-serif-latin-ext-400-italic.woff2'), 'instrument-serif-latin-ext-italic.woff2'],
  // wght 200–800 + wdth 75–100 axes (labels use wdth ≈ 85)
  [join(sans, 'files/bricolage-grotesque-latin-wdth-normal.woff2'), 'bricolage-latin.woff2'],
  [join(sans, 'files/bricolage-grotesque-latin-ext-wdth-normal.woff2'), 'bricolage-latin-ext.woff2'],
];
for (const [from, to] of files) copyFileSync(from, join(out, to));
console.log(`fonts: copied ${files.length} files to public/fonts`);
