import { describe, expect, it } from 'vitest';
import { isGeneratedToken, semanticPart } from './tokens';

describe('semanticPart', () => {
  it.each([
    ['plans-grid', 'plans-grid'],
    ['mt-4', 'mt-4'],
    ['grid-cols-3', 'grid-cols-3'],
    ['Card_title__a8F3x', 'Card_title'],
    ['_title_1x2y3_5', 'title'],
  ])('keeps the authored part of %s', (token, expected) => {
    expect(semanticPart(token)).toBe(expected);
  });

  it.each([
    'css-1x2y3z',
    'sc-bdVaJa',
    'jsx-1234567',
    'svelte-1kd8x2',
    '_ngcontent-abc-c12',
    'ember42',
    ':r1:',
    '9b2f6c1e-8a4d-4d3e-9f1a-2b3c4d5e6f70',
  ])('treats %s as generated', (token) => {
    expect(isGeneratedToken(token)).toBe(true);
  });
});
