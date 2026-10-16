/**
 * Single source of truth for the marketing routes, so the router and the navbar
 * highlighting can never drift apart.
 *
 * `id` is the tab name the landing pages already speak; `path` is the URL.
 * Lives in its own module rather than in LandingShell so that file only exports
 * a component (fast refresh requirement).
 */
export const LANDING_TABS = [
  { id: 'home', path: '/' },
  { id: 'about', path: '/about' },
  { id: 'services', path: '/services' },
  { id: 'corporate', path: '/corporate' },
  { id: 'partner', path: '/partner' },
  { id: 'driver', path: '/drive-with-us' },
  { id: 'advertise', path: '/advertise' },
  { id: 'contact', path: '/contact' },
];

export const pathForTab = (id) => LANDING_TABS.find((t) => t.id === id)?.path ?? '/';

export const tabForPath = (path) => LANDING_TABS.find((t) => t.path === path)?.id ?? 'home';
