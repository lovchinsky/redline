/**
 * Percent-decodes `text`, or returns it unchanged when its escapes are malformed: URLs from
 * pages can carry anything `new URL` accepts, and `decodeURIComponent` throws on some of it.
 */
export const decodeOrKeep = (
  text: string,
  decode: (encoded: string) => string = decodeURIComponent,
): string => {
  try {
    return decode(text);
  } catch {
    return text;
  }
};
