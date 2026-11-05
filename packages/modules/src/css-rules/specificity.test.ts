import { describe, expect, it } from 'vitest';
import { compareSpecificity, specificityOf, splitSelectors } from './specificity';

describe('specificityOf', () => {
  it.each([
    ['*', [0, 0, 0]],
    ['li', [0, 0, 1]],
    ['ul li', [0, 0, 2]],
    ['ul > li.active', [0, 1, 2]],
    ['#nav .item:hover', [1, 2, 0]],
    ['a[href^="https://x.io/#a.b"]', [0, 1, 1]],
    ['p::first-line', [0, 0, 2]],
    ['p:before', [0, 0, 2]],
    [':where(#nav .item) a', [0, 0, 1]],
    [':is(#nav, .item) a', [1, 0, 1]],
    ['button:not(.primary, [disabled])', [0, 1, 1]],
    ['.card:has(> img)', [0, 1, 1]],
    ['li:nth-child(2n + 1)', [0, 1, 1]],
    ['.btn\\:hover', [0, 1, 0]],
  ] as const)('%s → %j', (selector, expected) => {
    expect(specificityOf(selector)).toEqual(expected);
  });

  it('orders ids over classes over types', () => {
    expect(compareSpecificity(specificityOf('#a'), specificityOf('.a.b.c.d'))).toBeGreaterThan(0);
    expect(compareSpecificity(specificityOf('.a'), specificityOf('div p span'))).toBeGreaterThan(0);
    expect(compareSpecificity(specificityOf('.a'), specificityOf('.b'))).toBe(0);
  });

  it('splits lists only at top-level commas', () => {
    expect(splitSelectors('a, :is(b, c), [data-x="1,2"]')).toEqual([
      'a',
      ':is(b, c)',
      '[data-x="1,2"]',
    ]);
  });
});
