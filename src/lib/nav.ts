/**
 * Navigation (§4.0). The nav never changes by season (WCAG 3.2.3). Refer and Rewards appear only once live (site.json flags).
 * Header, MobileMenu and Footer all read from here so they mirror each other.
 */
import { site } from './site';

export interface NavLink { label: string; href: string }

export const TREATMENTS: NavLink[] = [
  { label: 'Massage', href: '/massage' },
  { label: 'Facials', href: '/facials' },
  { label: 'Body', href: '/body' },
  { label: 'Full menu', href: '/menu' },
];

export const SPAS_LINKS: NavLink[] = [
  { label: 'San Diego (Mission Valley)', href: '/locations/san-diego' },
  { label: 'Del Mar', href: '/locations/del-mar' },
];

export function offerLinks(): NavLink[] {
  const l: NavLink[] = [{ label: 'This month', href: '/specials' }];
  if (site.flags.refer_live) l.push({ label: 'Refer a friend', href: '/refer' });
  if (site.flags.rewards_live) l.push({ label: 'Rewards', href: '/rewards' });
  l.push({ label: 'Gift cards', href: '/gift-cards' });
  return l;
}

/** "Our spas" goes to the paired doors on Home (each door links on to its spa page). */
export const OUR_SPAS_HREF = '/#spas';

export function isCurrent(path: string, href: string): boolean {
  const clean = (p: string) => p.replace(/\/+$/, '') || '/';
  return clean(path) === clean(href);
}
