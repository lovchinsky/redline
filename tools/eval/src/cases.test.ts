import { describe, expect, it } from 'vitest';
import { outcomesOf, slicesOf, solvedShare, type ScoredCase } from './cases';
import type { CorpusApp } from './corpus';

const app = (name: string, framework: CorpusApp['framework']): CorpusApp =>
  ({ name, framework, styling: 'plain-css', i18n: false }) as CorpusApp;

/** A case on one build, its useful anchor at `rank` (1-based), or none. */
const build = (
  on: CorpusApp,
  id: string,
  mode: ScoredCase['mode'],
  rank: number | null,
): ScoredCase =>
  ({
    app: on,
    mode,
    case: { id, circle: 'p', expect: [] },
    score: {
      hit: rank !== null,
      verdicts: Array.from({ length: 5 }, (_, i) => ({ hit: i + 1 === rank })),
    },
  }) as unknown as ScoredCase;

describe('outcomesOf', () => {
  const react = app('shop', 'react');
  const vue = app('admin', 'vue');

  it('counts a case once, solved only when every build solves it', () => {
    const outcomes = outcomesOf([
      build(react, 'cart', 'development', 1),
      build(react, 'cart', 'production', 3),
      build(react, 'menu', 'development', 2),
      build(react, 'menu', 'production', null),
    ]);
    expect(outcomes.map((o) => [o.id, o.solved, o.rank])).toEqual([
      ['cart', true, 3],
      ['menu', false, null],
    ]);
    expect(solvedShare(outcomes)).toBe(0.5);
  });

  it('keeps each slice visible on its own', () => {
    const outcomes = outcomesOf([
      build(react, 'cart', 'development', 1),
      build(vue, 'users', 'development', null),
    ]);
    const shares = Object.fromEntries(
      slicesOf(outcomes).map(([slice, group]) => [slice, solvedShare(group)]),
    );
    expect(shares).toMatchObject({ 'framework: react': 1, 'framework: vue': 0 });
  });
});
