#!/usr/bin/env bash
# Rollback drill (local, offline, touches nothing live).
# Proves that "git revert" brings the built site back exactly:
#   1. copy the repo to a temp folder, git init, commit  -> build -> fingerprint A (built twice: stable)
#   2. make a visible change, commit                     -> build -> fingerprint B (must differ)
#   3. git revert the change                             -> build -> fingerprint C (must equal A)
# Usage: bash scripts/rollback-drill.sh            (run from the repo root, after npm ci)
set -euo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/rollback-drill.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

echo "== Drill folder: $WORK"
# Copy the source (no build output, no dependencies, no git history).
tar -C "$SRC" --exclude=./node_modules --exclude=./dist --exclude=./shots --exclude=./.git --exclude=./.astro -cf - . | tar -C "$WORK" -xf -
# Reuse installed dependencies so the drill needs no network.
if [ -d "$SRC/node_modules" ]; then ln -s "$SRC/node_modules" "$WORK/node_modules"; else (cd "$WORK" && npm ci --no-audit --no-fund >/dev/null); fi

cd "$WORK"
git init -q -b main
git config user.name "Rollback drill"
git config user.email "drill@localhost"
git add -A && git commit -qm "Baseline"

# Fingerprint of everything in dist/. ServiceCard, ServiceRow and BookChooser give their radio
# groups a random 5-character suffix on every build (Math.random), so two builds of the SAME
# commit differ only there. The fingerprint maps "<service-id>-<random>" to "<service-id>-RAND";
# every other byte of every file counts.
fingerprint() {
  npm run build >/dev/null 2>&1
  python3 "$WORK/.drill-fingerprint.py"
}
cat > "$WORK/.drill-fingerprint.py" <<'PY'
import hashlib, json, os, re
ids = sorted({s['id'] for s in json.load(open('src/data/services.json', encoding='utf-8'))['services']}, key=len, reverse=True)
rx = re.compile(r'((?:' + '|'.join(map(re.escape, ids)) + r')-)[a-z0-9]{1,5}(?![a-z0-9])')
h = hashlib.sha256()
for root, dirs, files in os.walk('dist'):
    dirs.sort()
    for f in sorted(files):
        p = os.path.join(root, f)
        data = open(p, 'rb').read()
        if p.endswith('.html'):
            data = rx.sub(lambda m: m.group(1) + 'RAND', data.decode('utf-8')).encode('utf-8')
        h.update(p.encode() + b'\0' + hashlib.sha256(data).digest())
print(h.hexdigest()[:16])
PY
echo ".drill-fingerprint.py" >> .git/info/exclude

A="$(fingerprint)";  echo "A  baseline build:          $A  ($(git rev-parse --short HEAD))"
A2="$(fingerprint)"; echo "A2 same commit, rebuilt:    $A2  (must equal A)"
[ "$A" = "$A2" ] || { echo "FAIL: two builds of the same commit differ"; exit 1; }

# A visible change: the San Diego opening-hours text (location page, footer and more).
python3 - <<'PY'
p = 'src/data/site.json'
s = open(p, encoding='utf-8').read()
old_variants = ['9 AM–8 PM', '9 AM\\u20138 PM']
for old in old_variants:
    if old in s:
        s = s.replace(old, old + ' (rollback drill change)', 1)
        break
else:
    raise SystemExit('hours text not found')
open(p, 'w', encoding='utf-8').write(s)
PY
git commit -qam "Drill: change the San Diego hours text"
B="$(fingerprint)"; echo "B  after the change:          $B  ($(git rev-parse --short HEAD))"
n="$(grep -rl "rollback drill change" dist | wc -l)"; echo "   change visible in $n built files"
[ "$n" -gt 0 ] || { echo "FAIL: change not visible in the build"; exit 1; }

git revert --no-edit HEAD >/dev/null
C="$(fingerprint)"; echo "C  after git revert:          $C  ($(git rev-parse --short HEAD))"
if grep -rlq "rollback drill change" dist; then echo "FAIL: change still present after revert"; exit 1; fi
git diff --quiet "$(git rev-list --max-parents=0 HEAD)" HEAD -- . && echo "   source tree after revert = baseline source tree"

git log --oneline | sed 's/^/   /'
if [ "$A" != "$B" ] && [ "$A" = "$C" ]; then
  echo "PASS: the change altered the build, and the revert restored it exactly."
else
  echo "FAIL: A=$A B=$B C=$C"; exit 1
fi
