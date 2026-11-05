import type { AnchorKind } from './types';

/** A string found on the page that probably also appears in the source code. */
export interface AnchorCandidate {
  readonly kind: AnchorKind;
  readonly value: string;
  readonly attribute: string | null;
  /** The token as it appears in the DOM (classes are matched by their raw token). */
  readonly raw: string;
  readonly element: Element;
}

export interface AnchorContext {
  /** How many elements on the page carry the same anchor; `null` when that is not known. */
  occurrences(candidate: AnchorCandidate): number | null;
}

/** Finds anchor candidates on one element. */
export interface AnchorSource {
  readonly id: string;
  extract(element: Element): readonly AnchorCandidate[];
}

/** Adjusts a candidate's score, or rejects it outright. */
export interface AnchorRule {
  readonly id: string;
  evaluate(candidate: AnchorCandidate, context: AnchorContext): number | 'reject';
}
