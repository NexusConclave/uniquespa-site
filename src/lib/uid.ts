/**
 * Deterministic ids for repeated components (radio groups, disclosure panels): the same build input always gives
 * the same HTML, so builds are reproducible (ROLLBACK.md drill) and diffs show only real changes.
 * Ids are unique per page: the first use of a base is `base`, the next `base-2`, `base-3`, … in render order.
 * The counter lives on Astro.locals, which is fresh for every page render.
 */
export function pageUid(locals: object, base: string): string {
  const store = locals as { __ushUids?: Map<string, number> };
  const seen = (store.__ushUids ??= new Map<string, number>());
  const n = (seen.get(base) ?? 0) + 1;
  seen.set(base, n);
  return n === 1 ? base : `${base}-${n}`;
}
