/**
 * Tells hand-written class names and ids from the ones build tools and runtimes generate.
 *
 * Every generator names things by a fixed template: CSS Modules' `[name]_[local]__[hash]`,
 * emotion's `css-[hash]-[label]`, React's `useId`. A token is read against those templates, and
 * only a template can declare it generated or point at the hand-written name inside it. A token
 * no template explains is taken as written. When it is shaped like a digest it is flagged, not
 * dropped: shape alone cannot tell `a8F3x` from `mp3player`.
 */

/** What a class name or id says about its origin. */
export type TokenReading =
  /** Written by a known generator; nothing in it appears in the source. */
  | { readonly kind: 'generated' }
  /** A known template wraps a hand-written name: `Card_title__aBcDe` → `title`. */
  | { readonly kind: 'scoped'; readonly authored: string }
  /** No template applies; taken as written. */
  | { readonly kind: 'plain'; readonly authored: string }
  /** No template applies, but it is shaped like a digest (`_3xK9a`, `x1lliihq`): probably generated. */
  | { readonly kind: 'digest-like'; readonly authored: string };

interface Convention {
  /** Who names tokens this way. */
  readonly source: string;
  readonly pattern: RegExp;
  /** The hand-written part of a match, or null when the generator wrote all of it. */
  readonly authored: (groups: Readonly<Record<string, string | undefined>>) => string | null;
}

const nothing = (): null => null;

/** Runtime values: they never appear verbatim in the source, whatever surrounds them. */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
/** styled-components' component id; see {@link styleNamePositions}. */
/**
 * styled-components' component id. Its hashes are spelled in letters (digits with the compiler
 * plugin), and every `ad` in them is split as `a-d`, which ad blockers leave alone.
 */
const STYLED_COMPONENT_ID =
  /^(?:(?<display>[\w$-]+?)-)?sc-(?:[A-Za-z0-9]|(?<=[aA])-(?=[dD]))+(?:-\d+)?$/;

/** React's `useId`: `:r1:` (18), `«r1»` (19.0–19.1), `_r_1_` (19.2+). */
const REACT_ID = /:r[0-9a-z]+:|«r[0-9a-z]+»|(?:^|-)_r_[0-9a-z]+_(?:-|$)/i;

const CONVENTIONS: readonly Convention[] = [
  { source: 'uuid', pattern: UUID, authored: nothing },
  { source: 'React useId', pattern: REACT_ID, authored: nothing },
  {
    // `css-[hash]`, or `css-[hash]-[label]` when the author (or a library) named the style.
    source: 'emotion',
    pattern: /^css-[0-9a-z]{5,7}(?:-(?<label>[A-Za-z][\w-]*))?$/,
    authored: ({ label }) => label ?? null,
  },
  {
    // The component id, `sc-[hash]`, or `[file]__[Component]-sc-[hash]-[n]` with the compiler
    // plugin, whose display name is the component's variable name.
    source: 'styled-components',
    pattern: STYLED_COMPONENT_ID,
    authored: ({ display }) => display?.split('__').at(-1) ?? null,
  },
  {
    // css-loader and Next.js: `[name]_[local]__[hash:base64:5]`.
    source: 'CSS Modules (css-loader)',
    pattern: /^[A-Za-z0-9-]+_(?<local>[A-Za-z][\w-]*?)__[\w-]{5}$/,
    authored: ({ local }) => local ?? null,
  },
  {
    // postcss-modules before 4: `[name]__[local]___[hash:base64:5]`.
    source: 'CSS Modules (postcss-modules, legacy)',
    pattern: /^[A-Za-z0-9-]+__(?<local>[A-Za-z][\w-]*?)___[\w-]{5}$/,
    authored: ({ local }) => local ?? null,
  },
  {
    // postcss-modules (and so Vite): `_[local]_[hash:base36:5]_[line]`.
    source: 'CSS Modules (postcss-modules)',
    pattern: /^_(?<local>[A-Za-z_][\w-]*?)_[0-9a-z]{1,5}_\d+$/,
    authored: ({ local }) => local ?? null,
  },
  { source: 'styled-jsx', pattern: /^jsx-\d+$/, authored: nothing },
  { source: 'JSS', pattern: /^jss\d+$/, authored: nothing },
  { source: 'Svelte', pattern: /^svelte-[0-9a-z]{5,8}$/, authored: nothing },
  { source: 'Astro', pattern: /^astro-[0-9a-z]{8}$/, authored: nothing },
  {
    source: 'Angular',
    pattern: /^_ng(?:content|host)-|^ng-tns-|^ng-star-inserted$/,
    authored: nothing,
  },
  { source: 'Ember', pattern: /^ember\d+$/, authored: nothing },
];

/**
 * A digest encoded as an identifier: one alphanumeric run with a digit where no author puts
 * one, at the start (css-loader prefixes `_` to make `_3xK9a` a valid class) or between letters.
 */
const DIGEST_LIKE = /^_?(?=[A-Za-z0-9]{5,}$)(?:\d+[A-Za-z]|.*[A-Za-z]\d+[A-Za-z])/;

/** Reads one class name or id against the known naming templates. */
export const readToken = (token: string): TokenReading => {
  for (const convention of CONVENTIONS) {
    const match = convention.pattern.exec(token);
    if (match === null) continue;
    const authored = convention.authored(match.groups ?? {});
    return authored === null ? { kind: 'generated' } : { kind: 'scoped', authored };
  }
  return DIGEST_LIKE.test(token)
    ? { kind: 'digest-like', authored: token }
    : { kind: 'plain', authored: token };
};

/**
 * styled-components builds an element's class list as its component ids (one per level of
 * `styled(Styled…)`), then one style name per level with styles, then the classes it was given.
 * A style name is a 32-bit hash in letters (at most six; `ad` is split as `a-d`), so only its
 * position tells it from a hand-written name.
 */
const STYLE_NAME = /^(?:[A-Za-z]|(?<=[aA])-(?=[dD]))+$/;
const isStyleName = (token: string): boolean =>
  STYLE_NAME.test(token) && token.replaceAll('-', '').length <= 6;

/** Positions in a class list that hold styled-components style names. */
const styleNamePositions = (classes: readonly string[]): Set<number> => {
  const positions = new Set<number>();
  /** Style names still possible after the latest run of ids. */
  let open = 0;
  let previousWasId = false;
  for (const [index, token] of classes.entries()) {
    const isId = STYLED_COMPONENT_ID.test(token);
    if (isId) open = previousWasId ? open + 1 : 1;
    else if (open > 0 && isStyleName(token)) {
      positions.add(index);
      open -= 1;
    } else open = 0;
    previousWasId = isId;
  }
  return positions;
};

export interface ClassToken {
  /** As in the DOM. */
  readonly raw: string;
  /** What the author wrote. */
  readonly authored: string;
  /** How sure that is: see {@link TokenReading}. */
  readonly kind: 'scoped' | 'plain' | 'digest-like';
}

/** Class names of an element that the author wrote, with generated parts stripped. */
export const authoredClassTokens = (element: Element): ClassToken[] => {
  const classes = Array.from(element.classList);
  const styleNames = styleNamePositions(classes);
  return classes.flatMap((raw, index) => {
    if (styleNames.has(index)) return [];
    const reading = readToken(raw);
    return reading.kind === 'generated' ? [] : [{ raw, ...reading }];
  });
};

/** Authored class names of an element, generated ones stripped. */
export const semanticClasses = (element: Element): string[] =>
  authoredClassTokens(element).map((token) => token.authored);
