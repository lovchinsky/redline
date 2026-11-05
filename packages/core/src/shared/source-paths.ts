/** Folders source trees usually start at: the path from there is what a repository shows. */
const SOURCE_ROOTS = ['src', 'app', 'pages', 'components', 'styles', 'lib', 'packages'];

/**
 * A source path as a repository shows it: dev servers and debug builds record absolute paths
 * (`/Users/maria/work/acme/src/Card.tsx`), whose prefix is machine-specific and personal.
 * URLs keep only their path. Without a known root, the last three segments remain.
 */
export const projectRelative = (path: string): string => {
  let pathname = path;
  if (/^[a-z][\w+.-]*:\/\//i.test(path)) {
    try {
      pathname = new URL(path).pathname;
    } catch {
      // Not a URL after all: use as is.
    }
  }
  const segments = pathname
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment !== '');
  const start = segments.findIndex((segment) => SOURCE_ROOTS.includes(segment));
  return start === -1 ? segments.slice(-3).join('/') : segments.slice(start).join('/');
};
