import * as z from 'zod/mini';
import { appError, type AppError } from '../shared/errors';
import { idSchema } from '../shared/ids';
import { err, ok, type Result } from '../shared/result';

export const ProjectId = idSchema().brand<'ProjectId'>();
export type ProjectId = z.infer<typeof ProjectId>;

/**
 * Which pages belong to a project: a scheme, a host (exact, or `*.` for any subdomain),
 * an optional port and an optional path prefix, e.g. `https://staging.acme.io`,
 * `https://*.acme.io`, `http://localhost:3000/admin`.
 */
export interface BindingPattern {
  readonly protocol: 'http:' | 'https:';
  /** Lower-case host without the wildcard; `wildcard` means any subdomain of it. */
  readonly host: string;
  readonly wildcard: boolean;
  /** Explicit port, '' for the scheme's default. */
  readonly port: string;
  /** '/' or a prefix without a trailing slash, e.g. '/admin'. */
  readonly pathPrefix: string;
}

const PATTERN = /^(https?):\/\/(\*\.)?([^/:?#*]+)(?::(\d{1,5}))?(\/[^?#*]*)?$/i;
const DEFAULT_PORTS: Readonly<Record<string, string>> = { 'http:': '80', 'https:': '443' };

export const parseBindingPattern = (text: string): Result<BindingPattern, AppError> => {
  const match = PATTERN.exec(text.trim());
  const [, scheme, wildcard, rawHost, rawPort, rawPath] = match ?? [];
  if (scheme === undefined || rawHost === undefined) {
    return err(appError('validation', 'Not a site pattern', { pattern: text }));
  }
  const protocol = scheme.toLowerCase() === 'https' ? 'https:' : 'http:';
  let host: string;
  try {
    host = new URL(`${protocol}//${rawHost}`).hostname;
  } catch {
    return err(appError('validation', 'Not a valid host', { pattern: text }));
  }
  if (wildcard !== undefined && !host.includes('.')) {
    return err(
      appError('validation', 'A wildcard needs a domain, e.g. *.acme.io', { pattern: text }),
    );
  }
  const port = rawPort === undefined || rawPort === DEFAULT_PORTS[protocol] ? '' : rawPort;
  const path = (rawPath ?? '/').replace(/\/+$/, '');
  return ok({
    protocol,
    host,
    wildcard: wildcard !== undefined,
    port,
    pathPrefix: path === '' ? '/' : path,
  });
};

export const formatBindingPattern = (pattern: BindingPattern): string =>
  `${pattern.protocol}//${pattern.wildcard ? '*.' : ''}${pattern.host}${
    pattern.port === '' ? '' : `:${pattern.port}`
  }${pattern.pathPrefix === '/' ? '' : pattern.pathPrefix}`;

/**
 * The host permission a binding needs, as a browser match pattern. Match patterns carry no
 * port or path, so this covers every port and path of the host.
 */
export const hostPermissionOf = (pattern: BindingPattern): string =>
  `${pattern.protocol}//${pattern.wildcard ? '*.' : ''}${pattern.host}/*`;

/** The exact-origin pattern of a page, the one created when a user picks a project for it. */
export const originPatternOf = (url: URL): string => `${url.protocol}//${url.host}`;

export const patternMatches = (pattern: BindingPattern, url: URL): boolean => {
  if (url.protocol !== pattern.protocol || url.port !== pattern.port) return false;
  const host = url.hostname;
  const hostMatches = pattern.wildcard ? host.endsWith(`.${pattern.host}`) : host === pattern.host;
  if (!hostMatches) return false;
  const prefix = pattern.pathPrefix;
  return prefix === '/' || url.pathname === prefix || url.pathname.startsWith(`${prefix}/`);
};

/** Higher is more specific: an exact host beats a wildcard, a deeper domain and a longer path win. */
const specificity = (pattern: BindingPattern): readonly number[] => [
  pattern.wildcard ? 0 : 1,
  pattern.host.split('.').length,
  pattern.pathPrefix === '/' ? 0 : pattern.pathPrefix.length,
];

export const bindingSchema = z.readonly(
  z.object({
    /** Canonical pattern (see `formatBindingPattern`); unique across bindings. */
    pattern: z.string().check(z.minLength(1)),
    projectId: ProjectId,
    projectName: z.string().check(z.minLength(1)),
    createdAt: z.number(),
  }),
);
export type Binding = z.infer<typeof bindingSchema>;

/** The binding that applies to a page: the most specific matching pattern, or none. */
export const resolveBinding = (bindings: readonly Binding[], url: URL): Binding | null => {
  let best: { binding: Binding; rank: readonly number[] } | null = null;
  for (const binding of bindings) {
    const pattern = parseBindingPattern(binding.pattern);
    if (!pattern.ok || !patternMatches(pattern.value, url)) continue;
    const rank = specificity(pattern.value);
    if (best === null || compareRanks(rank, best.rank) > 0) best = { binding, rank };
  }
  return best?.binding ?? null;
};

const compareRanks = (a: readonly number[], b: readonly number[]): number => {
  for (let i = 0; i < a.length; i += 1) {
    const difference = (a[i] ?? 0) - (b[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};
