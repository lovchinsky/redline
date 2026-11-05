import { describe, expect, it } from 'vitest';
import { routePatternOf } from './route';

describe('routePatternOf', () => {
  it.each([
    ['https://acme.io/', '/'],
    ['https://acme.io/pricing/', '/pricing'],
    ['https://acme.io/orders/1042/items?tab=2', '/orders/:param/items'],
    ['https://acme.io/u/9b2f6c1e-8a4d-4d3e-9f1a-2b3c4d5e6f70', '/u/:param'],
    ['https://acme.io/p/65f1a2b3c4d5e6f708192a3b', '/p/:param'],
    ['https://acme.io/blog/2026-11-04/launch', '/blog/:param/launch'],
    ['https://acme.io/docs/getting-started', '/docs/getting-started'],
    ['https://acme.io/app#/projects/77/settings?x=1', '/app#/projects/:param/settings'],
  ])('%s → %s', (url, pattern) => {
    expect(routePatternOf(new URL(url))).toBe(pattern);
  });

  it('keeps a segment with malformed escapes instead of failing the step', () => {
    expect(routePatternOf(new URL('https://acme.io/docs/%E0%A4%A/intro'))).toBe(
      '/docs/%E0%A4%A/intro',
    );
  });
});
