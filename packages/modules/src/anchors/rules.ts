import { readToken } from '@redline/dom';
import type { AnchorRule } from './candidate';
import type { AnchorKind } from './types';

/** Starting score: how reliably each kind leads to source code. */
export const BASE_SCORES: Readonly<Record<AnchorKind, number>> = {
  'test-id': 100,
  id: 70,
  'custom-tag': 70,
  'aria-label': 60,
  text: 50,
  name: 50,
  placeholder: 50,
  alt: 40,
  title: 40,
  href: 40,
  class: 30,
};

/** Kinds a build tool may have named. Test ids are not among them: people write those for tools. */
const TOKEN_KINDS = new Set<AnchorKind>(['id', 'class', 'name']);
const WORDING_KINDS = new Set<AnchorKind>(['text', 'aria-label', 'title', 'placeholder', 'alt']);

/** Enough to sink a class below the cut and an id below wording. */
const DIGEST_LIKE_PENALTY = -40;

/**
 * Build tools generate ids and classes that never appear in source. A known generator's token
 * is rejected; one merely shaped like a digest is only distrusted, as it may be hand-written.
 */
export const generatedTokenRule: AnchorRule = {
  id: 'generated-token',
  evaluate: ({ kind, raw }) => {
    if (!TOKEN_KINDS.has(kind)) return 0;
    const reading = readToken(raw);
    if (reading.kind === 'generated') return 'reject';
    return reading.kind === 'digest-like' ? DIGEST_LIKE_PENALTY : 0;
  },
};

const GENERIC_WORDS = new Set([
  'ok',
  'cancel',
  'close',
  'submit',
  'save',
  'delete',
  'edit',
  'more',
  'next',
  'back',
  'yes',
  'no',
  'search',
  'menu',
  'login',
  'logout',
  'continue',
  'done',
  'apply',
  'reset',
  'send',
]);

/** Short or stock wording matches too many places in a codebase. */
export const genericWordingRule: AnchorRule = {
  id: 'generic-wording',
  evaluate: ({ kind, value }) => {
    if (!WORDING_KINDS.has(kind)) return 0;
    const normalized = value
      .toLowerCase()
      .replace(/[^\p{L}\p{N} ]/gu, '')
      .trim();
    return normalized.length < 3 || GENERIC_WORDS.has(normalized) ? -60 : 0;
  },
};

/** Wording of a few words is the sweet spot for searching; long passages get truncated. */
export const wordingLengthRule: AnchorRule = {
  id: 'wording-length',
  evaluate: ({ kind, value }) => {
    if (!WORDING_KINDS.has(kind)) return 0;
    if (value.length >= 8 && value.length <= 60) return 10;
    return value.length > 60 ? -10 : 0;
  },
};

/** A value unique on the page is likely unique in the code; one repeated everywhere is not. */
export const uniquenessRule: AnchorRule = {
  id: 'uniqueness',
  evaluate: (candidate, context) => {
    const count = context.occurrences(candidate);
    if (count === 1) return 20;
    return count > 3 ? -20 : 0;
  },
};

const UTILITY_CLASS =
  /^(?:[a-z]+:)*-?(?:p[xytrbl]?|m[xytrbl]?|w|h|min-[wh]|max-[wh]|gap(?:-[xy])?|space-[xy]|text|font|leading|tracking|bg|border(?:-[xytrbl])?|rounded(?:-[a-z]+)?|shadow|opacity|z|top|left|right|bottom|inset|grid-cols|grid-rows|col-span|row-span|order|basis|grow|shrink|items|justify|content|self|place-[a-z]+|overflow(?:-[xy])?|duration|ease|transition|translate-[xy]|scale|rotate)(?:-[\w./[\]%#]+)*$|^(?:flex|grid|block|inline|inline-block|inline-flex|hidden|contents|relative|absolute|fixed|sticky|static|truncate|underline|uppercase|lowercase|capitalize|italic|container|sr-only|shrink-0|grow-0|flex-1|flex-col|flex-row|flex-wrap)$/;

/** Utility classes (Tailwind and similar) describe styling, not a component; they match everywhere. */
export const utilityClassRule: AnchorRule = {
  id: 'utility-class',
  evaluate: ({ kind, value }) => (kind === 'class' && UTILITY_CLASS.test(value) ? -50 : 0),
};

export const DEFAULT_ANCHOR_RULES: readonly AnchorRule[] = [
  generatedTokenRule,
  genericWordingRule,
  wordingLengthRule,
  uniquenessRule,
  utilityClassRule,
];
