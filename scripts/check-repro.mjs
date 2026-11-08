// Reproducible build check (npm run test:repro): builds the site twice into dist-repro/a and dist-repro/b and
// compares every file byte for byte. Fails if anything differs (e.g. a random id sneaking back into a component).
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

const root = new URL('..', import.meta.url).pathname;
const out = join(root, 'dist-repro');
const walk = (d) => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
const sums = (dir) => new Map(walk(dir).map((f) => [relative(dir, f), createHash('sha256').update(readFileSync(f)).digest('hex')]));

rmSync(out, { recursive: true, force: true });
const runs = ['a', 'b'].map((n) => {
  const dir = join(out, n);
  execFileSync('npx', ['astro', 'build', '--silent'], { cwd: root, env: { ...process.env, ASTRO_OUT_DIR: dir }, stdio: ['ignore', 'ignore', 'inherit'] });
  return sums(dir);
});
const [a, b] = runs;
const diff = [...new Set([...a.keys(), ...b.keys()])].filter((k) => a.get(k) !== b.get(k));
const all = createHash('sha256').update([...a].sort().map(([k, v]) => k + v).join('\n')).digest('hex').slice(0, 16);
rmSync(out, { recursive: true, force: true });
console.log(diff.length ? `✗ builds differ in ${diff.length} file(s):\n  ${diff.slice(0, 20).join('\n  ')}` : `✓ reproducible: two builds identical (${a.size} files, fingerprint ${all})`);
process.exit(diff.length ? 1 : 0);
