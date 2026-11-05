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

/**
 * Vite's CSS Modules names, `_<local>_<hash>_<line>`: the hash is five characters that may
 * be letters only, so the shape of the whole name identifies it, not the hash alone.
 */
const VITE_CSS_MODULE = /^_([A-Za-z][\w-]*?)_[A-Za-z0-9]{5}_\d+$/;

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
  const local = VITE_CSS_MODULE.exec(token)?.[1];
  if (local !== undefined) return local;
  const segments = token.split(/_+/);
  if (!segments.some(isHashSegment)) return token;
  const authored = segments.filter((s) => s !== '' && !isHashSegment(s) && !isNumericSegment(s));
  return authored.length === 0 ? null : authored.join('_');
};

const STYLED_COMPONENTS_ID = /^sc-[a-z0-9]+/i;
/** Hand-written names read as words: `card`, `navItem`, `nav-item`, `Card_title`. */
const WORDLIKE = /^(?:[a-z]+(?:[A-Z][a-z]+)*|[A-Z][a-z]+(?:[A-Z][a-z]+)*)$/;

/**
 * styled-components gives every element its component id (`sc-…`) and a style hash of five
 * to seven letters (`hBkjaA`). The hash has no digits, so it only shows next to the id.
 */
const isStyledHash = (token: string, classes: readonly string[]): boolean =>
  /^[a-zA-Z]{5,7}$/.test(token) &&
  !WORDLIKE.test(token) &&
  classes.some((other) => STYLED_COMPONENTS_ID.test(other));

export interface ClassToken {
  /** As in the DOM. */
  readonly raw: string;
  /** What the author wrote. */
  readonly authored: string;
}

/** Class names of an element that the author wrote, with generated parts stripped. */
export const authoredClassTokens = (element: Element): ClassToken[] => {
  const classes = Array.from(element.classList);
  return classes.flatMap((raw) => {
    const authored = isStyledHash(raw, classes) ? null : semanticPart(raw);
    return authored === null ? [] : [{ raw, authored }];
  });
};

/** Authored class names of an element, generated ones stripped. */
export const semanticClasses = (element: Element): string[] =>
  authoredClassTokens(element).map((token) => token.authored);
