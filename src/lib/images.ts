/**
 * Image registry: asset-manifest.json ids → imported source images (for astro:assets) + alt + focal point.
 * Use `asset('massage-1x1')` in components; never hard-code a TEMP path in a page.
 */
import type { ImageMetadata } from 'astro';
import manifest from '../data/asset-manifest.json';

const files = import.meta.glob<{ default: ImageMetadata }>('../assets/**/*.{jpg,jpeg,png,webp}', { eager: true });

export interface Asset {
  id: string;
  src: ImageMetadata;
  alt: string;
  focal: { x: number; y: number };
  temp: boolean;
  replace_with?: string;
  /** Output formats. Default AVIF + WebP; the manifest can drop AVIF where it comes out larger (QA m-17). */
  formats: Array<'avif' | 'webp'>;
}

/** Responsive widths (§ hard rule 8): 640 / 1280 / 1920, capped at the source width. */
export const WIDTHS = [640, 1280, 1920];
export function widthsFor(src: ImageMetadata, list: number[] = WIDTHS): number[] {
  const w = list.filter((x) => x < src.width);
  return [...w, Math.min(src.width, list[list.length - 1])];
}

function entryFor(id: string, variant?: string): Record<string, any> | undefined {
  const entry = (manifest.assets as Array<Record<string, any>>).find((a) => a.id === id);
  if (!entry || !variant) return entry;
  // A slot with one photo per spa (spa-doors): `variants.SD` / `variants.DM` override file, alt and focal.
  const v = entry.variants?.[variant];
  if (!v) throw new Error(`[images] asset "${id}" has no variant "${variant}" in asset-manifest.json`);
  return { ...entry, ...v };
}

function toAsset(id: string, entry: Record<string, any>): Asset {
  const key = '../' + String(entry.file).replace(/^src\//, '');
  const mod = files[key];
  if (!mod) throw new Error(`[images] ${entry.file} is listed in asset-manifest.json but missing on disk`);
  return {
    id,
    src: mod.default,
    alt: entry.alt ?? '',
    focal: entry.focal ?? { x: 50, y: 50 },
    temp: !!entry.temp,
    replace_with: entry.replace_with,
    formats: entry.formats ?? ['avif', 'webp'],
  };
}

export function asset(id: string, variant?: string): Asset {
  const entry = entryFor(id, variant);
  if (!entry || !entry.file) throw new Error(`[images] no image file for asset "${id}"${variant ? ` (${variant})` : ''}`);
  return toAsset(id, entry);
}

/**
 * For slots that have no photo yet (couples-placeholder, spa-doors, gift-card): the photo once its manifest entry has
 * a `file`, else null, so the component keeps its CSS/typographic placeholder. Dropping the photo in
 * src/assets/photos/ and setting `file` (and `alt`, `focal`, `"temp": false`) is the whole change.
 */
export function photoOrNull(id: string, variant?: string): Asset | null {
  const entry = entryFor(id, variant);
  if (!entry) throw new Error(`[images] no asset "${id}" in asset-manifest.json`);
  return entry.file ? toAsset(id, entry) : null;
}

/** CSS object-position from the manifest's focal point. */
export function objectPosition(a: Asset): string {
  return `${a.focal.x}% ${a.focal.y}%`;
}
