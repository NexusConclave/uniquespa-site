#!/usr/bin/env bash
# Checks a pull request's preview bundle BEFORE anything with a deploy token touches it (review finding 1).
# Runs from main (preview-deploy.yml); the bundle is untrusted data built from PR code. Nothing in it is executed.
#
#   validate-preview-bundle.sh BUNDLE_DIR
#
# Allowed: dist/ (the static site), functions/ (Pages Functions), src/lib/ (code the functions import) and
# wrangler.toml (ignored: the deploy always uses main's copy). Refused: anything else at the top level, .github,
# .git, node_modules, npm/yarn/pnpm config or lock files, dot-files outside dist/.well-known, symlinks, special
# files, odd file names, dist/_worker.js, function files that aren't .js/.mjs/.ts/.json, and size over the limits.
set -euo pipefail

B="${1:?usage: validate-preview-bundle.sh BUNDLE_DIR}"
MAX_FILES="${MAX_FILES:-3000}"            # Cloudflare Pages allows 20,000; this site has about 100
MAX_TOTAL_KB="${MAX_TOTAL_KB:-61440}"     # 60 MiB in all (this site: about 7 MiB)
MAX_FILE_KB="${MAX_FILE_KB:-10240}"       # 10 MiB a file (Pages limit is 25 MiB; largest here is about 2 MiB)
fail() { echo "::error::preview bundle refused: $*"; exit 1; }

[ -d "$B" ] || fail "no bundle directory"
[ -L "$B" ] && fail "bundle directory is a symlink"
[ -d "$B/dist" ] || fail "no dist/"
[ -f "$B/dist/index.html" ] || fail "no dist/index.html"

# 1. Top level: only the four expected entries.
while IFS= read -r -d '' e; do
  case "${e#"$B"/}" in
    dist|functions|src|wrangler.toml) ;;
    *) fail "unexpected top-level entry: ${e#"$B"/}" ;;
  esac
done < <(find "$B" -mindepth 1 -maxdepth 1 -print0)
if [ -d "$B/src" ]; then
  while IFS= read -r -d '' e; do
    [ "${e#"$B"/}" = "src/lib" ] || fail "unexpected entry under src/: ${e#"$B"/}"
  done < <(find "$B/src" -mindepth 1 -maxdepth 1 -print0)
fi

# 2. Only regular files and directories (no symlinks, devices, fifos, sockets).
odd="$(find "$B" -mindepth 1 ! -type f ! -type d -print | head -5)"
[ -z "$odd" ] || fail "symlink or special file: $odd"

# 3. File names: printable, no control characters, no leading dash, no '..'.
while IFS= read -r -d '' f; do
  rel="${f#"$B"/}"
  case "$rel" in *$'\n'*|*$'\r'*|*$'\t'*) fail "control character in a file name" ;; esac
  printf '%s' "$rel" | LC_ALL=C grep -q '[^[:print:]]' && fail "non-printable file name: $(printf '%q' "$rel")"
  case "/$rel/" in */../*|*/-*) fail "bad path: $rel" ;; esac
  # forbidden names anywhere
  base="$(basename "$rel")"
  case "$base" in
    .github|.git|.gitmodules|node_modules|.npmrc|.yarnrc|.yarnrc.yml|.pnpmfile.cjs|package.json|package-lock.json|npm-shrinkwrap.json|yarn.lock|pnpm-lock.yaml|bun.lockb|.env|.env.*|.dev.vars)
      fail "forbidden file: $rel" ;;
  esac
  # dot-files only as dist/.well-known/...
  case "/$rel" in
    */.*) case "$rel" in dist/.well-known|dist/.well-known/*) ;; *) fail "hidden file or folder: $rel" ;; esac ;;
  esac
done < <(find "$B" -mindepth 1 -print0)

# 4. No advanced-mode worker in dist (it would replace the reviewed functions/ wholesale).
[ -e "$B/dist/_worker.js" ] && fail "dist/_worker.js is not allowed"

# 5. Functions and their library: source files only.
for d in functions src/lib; do
  [ -d "$B/$d" ] || continue
  bad="$(find "$B/$d" -type f ! -name '*.js' ! -name '*.mjs' ! -name '*.ts' ! -name '*.json' -print | head -5)"
  [ -z "$bad" ] || fail "unexpected file type in $d/: $bad"
done

# 6. Size limits.
files="$(find "$B" -type f | wc -l)"
[ "$files" -le "$MAX_FILES" ] || fail "$files files (limit $MAX_FILES)"
total_kb="$(du -sk "$B" | cut -f1)"
[ "$total_kb" -le "$MAX_TOTAL_KB" ] || fail "${total_kb} KiB in all (limit $MAX_TOTAL_KB KiB)"
big="$(find "$B" -type f -size +"${MAX_FILE_KB}"k -print | head -3)"
[ -z "$big" ] || fail "file over $MAX_FILE_KB KiB: $big"

echo "preview bundle OK: $files files, ${total_kb} KiB"
