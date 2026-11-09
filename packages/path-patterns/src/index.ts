/**
 * Globs over repository paths, with one meaning wherever a pattern is read: the receiver judges
 * a change by them, and the agent is stopped by them before it writes. `*` stays within a
 * directory, `**` spans directories and `?` is one character. A pattern without a slash names a
 * file or directory at any depth (`CLAUDE.md` matches `web/CLAUDE.md`); a pattern with one is
 * anchored at the root. A match covers everything under it: `.claude` covers
 * `.claude/settings.json`.
 */
export type PathMatcher = (path: string) => boolean;

const escapeRegex = (text: string) => text.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/** Compiles one pattern into a matcher of repository paths (relative, `/`-separated). */
export const pathMatcher = (pattern: string): PathMatcher => {
  const anchored = pattern.includes('/');
  let source = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern.charAt(i);
    if (char === '*' && pattern.charAt(i + 1) === '*') {
      const slash = pattern.charAt(i + 2) === '/';
      source += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += escapeRegex(char);
  }
  const regex = new RegExp(`^${anchored ? '' : '(?:.*/)?'}${source}(?:/.*)?$`);
  return (path) => regex.test(path);
};

/** The first of `patterns` that matches `path`, or null. */
export const firstMatch = (patterns: readonly string[], path: string): string | null =>
  patterns.find((pattern) => pathMatcher(pattern)(path)) ?? null;
