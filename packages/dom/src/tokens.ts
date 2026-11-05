/**
 * Heuristics for telling author-written identifiers from build-generated ones
 * (CSS-in-JS hashes, CSS Modules suffixes, framework scoping attributes).
 */

const GENERATED_PREFIXES = [
  /^css-[a-z0-9]+/i, // emotion
  /^sc-[a-z0-9]+/i, // styled-components
  /^jsx-\d+/, // styled-jsx
  /^svelte-[a-z0-9]+/i, // svelte scoping
  /^_?ng(content|host)-/, // angular emulated encapsulation
  /^ng-(star-inserted|tns-)/, // angular runtime state
  /^ember\d+$/, // ember view ids
  /^:r[0-9a-z]+:$/, // React useId
  /^«r[0-9a-z]+»$/, // React 19 useId
];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A token segment that looks like a hash: alphanumeric only, mixing letters and digits, 5+ chars. */
const isHashSegment = (segment: string): boolean =>
  segment.length >= 5 &&
  /^[a-z0-9]+$/i.test(segment) &&
  /\d/.test(segment) &&
  /[a-z]/i.test(segment);

const isNumericSegment = (segment: string): boolean => /^\d+$/.test(segment);

/** True when the whole token is machine-generated and carries no authored meaning. */
export const isGeneratedToken = (token: string): boolean =>
  UUID.test(token) ||
  GENERATED_PREFIXES.some((pattern) => pattern.test(token)) ||
  semanticPart(token) === null;

/**
 * Authored part of a class name or id with generated segments removed,
 * e.g. `Card_title__a8F3x` → `Card_title`, `_title_1x2y3_5` → `title`, `mt-4` → `mt-4`.
 * Returns null when nothing authored remains.
 */
export const semanticPart = (token: string): string | null => {
  if (UUID.test(token) || GENERATED_PREFIXES.some((pattern) => pattern.test(token))) return null;
  const segments = token.split(/_+/);
  if (!segments.some(isHashSegment)) return token;
  const authored = segments.filter((s) => s !== '' && !isHashSegment(s) && !isNumericSegment(s));
  return authored.length === 0 ? null : authored.join('_');
};

/** Authored class names of an element, generated ones stripped. */
export const semanticClasses = (element: Element): string[] =>
  Array.from(element.classList)
    .map(semanticPart)
    .filter((part): part is string => part !== null);
