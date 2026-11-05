import type { HarnessAnchor } from './harness/api';

/** Anchors an agent tries, in the collector's order. */
export const TOP_ANCHORS = 5;

export interface AnchorVerdict {
  readonly anchor: HarnessAnchor;
  /** Source files containing the anchor verbatim, as `grep -F` finds them. */
  readonly matches: readonly string[];
  /** The search leads to the right place and nowhere else. */
  readonly hit: boolean;
}

export interface CaseScore {
  readonly verdicts: readonly AnchorVerdict[];
  readonly hit: boolean;
}

export const grep = (sources: ReadonlyMap<string, string>, needle: string): string[] =>
  [...sources].filter(([, text]) => text.includes(needle)).map(([file]) => file);

/**
 * A case is solved when at least one of the top anchors, searched verbatim, matches only files
 * where the change belongs (and at least one of them).
 */
export const scoreCase = (
  anchors: readonly HarnessAnchor[],
  sources: ReadonlyMap<string, string>,
  expected: readonly string[],
): CaseScore => {
  const verdicts = anchors.slice(0, TOP_ANCHORS).map((anchor): AnchorVerdict => {
    const matches = grep(sources, anchor.value);
    return {
      anchor,
      matches,
      hit: matches.length > 0 && matches.every((file) => expected.includes(file)),
    };
  });
  return { verdicts, hit: verdicts.some((verdict) => verdict.hit) };
};
