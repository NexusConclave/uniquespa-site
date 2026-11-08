/**
 * Service guides (/guides/): answer-first pages for local and AI search, built but switched off until Katy approves.
 * Everything that builds, links or lists a guide asks this file, so "off" means off everywhere:
 * not built (getStaticPaths returns nothing), not linked (guideHref → null), not in llms.txt or sitemap.xml.
 */
import { site } from './site';
import data from '../data/guides.json';
import { guidesLive } from './guides-switch.mjs';

export interface Guide { slug: string; component: string; label: string; summary: string; services: string[]; related_pages: string[] }

export const GUIDES_LIVE: boolean = guidesLive(site);
export const GUIDES: Guide[] = data.guides as Guide[];
export const GUIDES_HUB = '/guides';

export function guideBySlug(slug: string): Guide {
  const g = GUIDES.find((x) => x.slug === slug);
  if (!g) throw new Error(`[guides] unknown guide "${slug}"`);
  return g;
}

/** Link target for a guide, or null while guides are off (callers render nothing). */
export function guideHref(slug: string): string | null {
  return GUIDES_LIVE ? `/guides/${guideBySlug(slug).slug}` : null;
}

/** Guides to show while live; [] while off. */
export function liveGuides(): Guide[] {
  return GUIDES_LIVE ? GUIDES : [];
}
