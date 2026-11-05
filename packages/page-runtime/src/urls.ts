/** A resource URL without query and fragment: those may carry tokens, and say little. */
export const withoutQuery = (url: string, base: string): string => {
  try {
    const parsed = new URL(url, base);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/)[0] ?? url;
  }
};
