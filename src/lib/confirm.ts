/**
 * Unconfirmed claims (src/data/confirm.json; QA M7/M8). Use claimVisible(id) in frontmatter, or <Confirm id> in markup.
 *   resolved            → shown everywhere
 *   pending + PREVIEW   → shown, with "Needs owner confirmation (…)" (staging)
 *   pending, production → hidden (the caller renders its fallback); the build logs it, and CONFIRM_STRICT=1 fails it
 */
import data from '../data/confirm.json';
import { PREVIEW } from './site';

type Claim = { owner_confirm: string; resolved: boolean; what: string };
const CLAIMS = data.claims as Record<string, Claim>;
const logged = new Set<string>();

function get(id: string): Claim {
  const c = CLAIMS[id];
  if (!c) throw new Error(`[confirm] unknown claim "${id}" (add it to src/data/confirm.json)`);
  return c;
}

export function claimPending(id: string): boolean {
  return !get(id).resolved;
}

export function claimVisible(id: string): boolean {
  const c = get(id);
  if (c.resolved) return true;
  if (PREVIEW) return true;
  if (!logged.has(id)) {
    logged.add(id);
    const msg = `[confirm] "${id}" is unconfirmed (${c.owner_confirm}): ${c.what}. Production shows the fallback.`;
    if (process.env.CONFIRM_STRICT === '1') throw new Error(msg);
    console.warn(msg);
  }
  return false;
}

export function claimNote(id: string): string {
  return `Needs owner confirmation (${get(id).owner_confirm})`;
}

/**
 * Gift card copy that would otherwise state a pending claim WITHOUT a draft label (running text, FAQ answers, meta):
 * these return the safe wording until the claim resolves, in every build (PREVIEW included).
 *   giftCoversVerb(): "covers" once G0 (3% charge) is resolved, else "pays toward".
 *   giftBothSpasConfirmed(): true once O-P5 confirms gift cards are good at both spas.
 */
export function giftCoversVerb(): string {
  return claimPending('g0-gift-no-fees') ? 'pays toward' : 'covers';
}

export function giftBothSpasConfirmed(): boolean {
  return !claimPending('gift-both-spas');
}
