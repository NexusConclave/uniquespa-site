/** Reviews: first name + last initial only; render only when approved (or in PREVIEW, marked as drafts). */
import data from '../data/reviews.json';
import { PREVIEW } from './site';

export interface Review { id: string; name: string; text: string; use: string; about: string; approved: boolean; owner_confirm: string }
const ALL = data.reviews as Review[];

export function review(id: string): Review | null {
  const r = ALL.find((x) => x.id === id);
  return r && (r.approved || PREVIEW) ? r : null;
}

export function reviewsFor(use: string): Review[] {
  return ALL.filter((r) => r.use === use && (r.approved || PREVIEW));
}
