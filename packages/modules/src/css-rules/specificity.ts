/** Selector specificity as (ids, classes, types), compared left to right. */
export type Specificity = readonly [number, number, number];

const ZERO: Specificity = [0, 0, 0];

export const compareSpecificity = (a: Specificity, b: Specificity): number =>
  a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

const add = (a: Specificity, b: Specificity): Specificity => [
  a[0] + b[0],
  a[1] + b[1],
  a[2] + b[2],
];

/** Pseudo-elements still written with one colon. */
const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-line', 'first-letter']);
/** Pseudo-classes that count as their most specific argument. */
const BY_ARGUMENT = new Set(['is', 'not', 'has', 'matches', '-webkit-any', '-moz-any']);

const IDENT = /^(?:[\w-]|\\.|[^\p{ASCII}])+/u;

/** Splits a selector list at top-level commas (not inside `:is(…)` or attribute values). */
export const splitSelectors = (list: string): string[] => {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < list.length; i += 1) {
    const char = list[i];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') depth -= 1;
    else if (char === ',' && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(list.slice(start).trim());
  return parts.filter((part) => part !== '');
};

/** Index just past the bracket that closes the one at `open`, skipping quoted text. */
const closing = (text: string, open: number): number => {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i += 1) {
    const char = text[i];
    if (quote !== null) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth += 1;
    else if (char === ')' || char === ']') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
};

/**
 * Specificity of one complex selector, per Selectors Level 4: `:where()` counts nothing,
 * `:is()`, `:not()` and `:has()` count as their most specific argument, every other
 * pseudo-class as a class. The universal selector and combinators count nothing.
 */
export const specificityOf = (selector: string): Specificity => {
  let total: Specificity = ZERO;
  let i = 0;
  while (i < selector.length) {
    const char = selector[i];
    const rest = selector.slice(i + 1);
    if (char === '#') {
      total = add(total, [1, 0, 0]);
      i += 1 + (IDENT.exec(rest)?.[0].length ?? 0);
    } else if (char === '.') {
      total = add(total, [0, 1, 0]);
      i += 1 + (IDENT.exec(rest)?.[0].length ?? 0);
    } else if (char === '[') {
      total = add(total, [0, 1, 0]);
      i = closing(selector, i);
    } else if (char === ':') {
      const element = selector[i + 1] === ':';
      const start = i + (element ? 2 : 1);
      const name = IDENT.exec(selector.slice(start))?.[0] ?? '';
      let end = start + name.length;
      const argument =
        selector[end] === '(' ? selector.slice(end + 1, closing(selector, end) - 1) : null;
      if (argument !== null) end = closing(selector, end);
      const lower = name.toLowerCase();
      if (element || LEGACY_PSEUDO_ELEMENTS.has(lower)) total = add(total, [0, 0, 1]);
      else if (lower === 'where') total = add(total, ZERO);
      else if (BY_ARGUMENT.has(lower) && argument !== null) {
        const most = splitSelectors(argument)
          .map(specificityOf)
          .reduce((best, next) => (compareSpecificity(next, best) > 0 ? next : best), ZERO);
        total = add(total, most);
      } else total = add(total, [0, 1, 0]);
      i = end;
    } else if (IDENT.test(selector.slice(i))) {
      // A type selector (or a namespace prefix, rare enough to count alike).
      total = add(total, [0, 0, 1]);
      i += IDENT.exec(selector.slice(i))?.[0].length ?? 1;
    } else {
      i += 1; // whitespace, combinators, `*`, `|`, `&`
    }
  }
  return total;
};
