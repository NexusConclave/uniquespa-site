#!/usr/bin/env bash
# Safe Cloudflare Pages branch name for a pull request preview (review finding 1).
#   preview-alias.sh PR_NUMBER HEAD_BRANCH   -> prints e.g. "pr-12-builder-november-photos"
# Always "pr-<number>-..." (letters, digits, dashes; at most 28 characters), so it can never be the production
# branch: a Pages deploy with --branch=main would go live. Refuses anything that still looks like a production name.
set -euo pipefail
n="${1:?PR number}"; head="${2-}"
[[ "$n" =~ ^[1-9][0-9]{0,6}$ ]] || { echo "::error::bad PR number" >&2; exit 1; }
slug="$(printf '%s' "$head" | tr '[:upper:]' '[:lower:]' | LC_ALL=C tr -c 'a-z0-9-' '-' | sed 's/--*/-/g; s/^-//; s/-$//')"
name="pr-$n${slug:+-$slug}"
name="$(printf '%s' "$name" | cut -c1-28 | sed 's/-$//')"
[[ "$name" =~ ^pr-[0-9]+(-[a-z0-9]+)*$ ]] || { echo "::error::bad preview name '$name'" >&2; exit 1; }
case "$name" in main|master|production|prod|live) echo "::error::refused preview name '$name'" >&2; exit 1 ;; esac
printf '%s\n' "$name"
