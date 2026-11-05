/**
 * A resource URL without what may carry secrets or bulk: query, fragment and credentials go;
 * a `data:` URL keeps only its media type. Works for opaque URLs (`blob:`, `about:`, bundler
 * schemes) too, whose origin is the string "null".
 */
export const withoutQuery = (url: string, base: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(url, base);
  } catch {
    return url.split(/[?#]/)[0] ?? url;
  }
  if (parsed.protocol === 'data:') return `data:${parsed.pathname.split(/[;,]/)[0] ?? ''}`;
  parsed.search = '';
  parsed.hash = '';
  parsed.username = '';
  parsed.password = '';
  return parsed.href;
};
