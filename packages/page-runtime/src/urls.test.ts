import { describe, expect, it } from 'vitest';
import { withoutQuery } from './urls';

const base = 'https://app.acme.io/orders/42';

describe('withoutQuery', () => {
  it.each([
    ['/api/prices?token=abc#x', 'https://app.acme.io/api/prices'],
    ['https://bob:pw@cdn.acme.io/app.js?v=3', 'https://cdn.acme.io/app.js'],
    ['data:image/png;base64,iVBORw0KGgoAAAANSUhEUg', 'data:image/png'],
    ['blob:https://app.acme.io/0f1e2d3c?x=1', 'blob:https://app.acme.io/0f1e2d3c'],
    ['webpack-internal:///./src/App.tsx?abc', 'webpack-internal:///src/App.tsx'],
  ])('%s', (url, expected) => {
    expect(withoutQuery(url, base)).toBe(expected);
  });
});
