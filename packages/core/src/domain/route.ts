/** Recognizes a path segment that is data (an id), not part of the route itself. */
export interface RouteRule {
  readonly id: string;
  matches(segment: string): boolean;
}

export const PARAM = ':param';

export const DEFAULT_ROUTE_RULES: readonly RouteRule[] = [
  {
    id: 'uuid',
    matches: (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s),
  },
  { id: 'number', matches: (s) => /^\d+$/.test(s) },
  { id: 'date', matches: (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) },
  { id: 'hex-id', matches: (s) => /^[0-9a-f]{8,}$/i.test(s) && /\d/.test(s) && /[a-f]/i.test(s) },
  {
    id: 'opaque-token',
    matches: (s) =>
      s.length >= 16 && /^[\w-]+$/.test(s) && /\d/.test(s) && /[a-z]/i.test(s) && !s.includes('-'),
  },
];

const normalizePath = (path: string, rules: readonly RouteRule[]): string => {
  const segments = path
    .split('/')
    .filter((segment) => segment !== '')
    .map((segment) => {
      const decoded = decodeURIComponent(segment);
      return rules.some((rule) => rule.matches(decoded)) ? PARAM : segment;
    });
  return `/${segments.join('/')}`;
};

/**
 * The route a URL belongs to, with ids replaced by `:param` and the query dropped,
 * e.g. `/orders/1042/items?tab=2` → `/orders/:param/items`. Hash routes (`#/…`) are kept.
 */
export const routePatternOf = (
  url: URL,
  rules: readonly RouteRule[] = DEFAULT_ROUTE_RULES,
): string => {
  const path = normalizePath(url.pathname, rules);
  return url.hash.startsWith('#/')
    ? `${path}#${normalizePath(url.hash.slice(1).split('?')[0] ?? '', rules)}`
    : path;
};
