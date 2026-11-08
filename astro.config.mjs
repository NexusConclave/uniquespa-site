// @ts-check
import { defineConfig } from 'astro/config';
import postbuild from './integrations/postbuild.mjs';
import site from './src/data/site.json' with { type: 'json' };
import { buildMode, assertLaunchAssets } from './src/lib/launch.mjs';
import manifest from './src/data/asset-manifest.json' with { type: 'json' };

// One launch switch: site.json "launch" (false = staging host, noindex; true = uniquespahouse.com).
// LAUNCH=1 / LAUNCH=0 override it for a test build. PREVIEW=1 renders draft offers and unapproved reviews (staging only).
const MODE = buildMode(site);
// Review #3: a launch build fails while any image slot is still temp:true (lists the slots). Staging/PREVIEW unaffected.
assertLaunchAssets(MODE, manifest);

export default defineConfig({
  site: MODE.url,
  output: 'static',
  // Tests build extra copies elsewhere (scripts/test-tracking.mjs); normal builds go to dist/.
  outDir: process.env.ASTRO_OUT_DIR || './dist',
  trailingSlash: 'ignore',
  build: { format: 'directory', inlineStylesheets: 'auto' },
  prefetch: { prefetchAll: false },
  devToolbar: { enabled: false },
  integrations: [postbuild({ site: MODE.url, launch: MODE.launch })],
});
