import { describe, expect, it } from 'vitest';
import { AssetId } from '../ports/asset-store';

describe('branded ids', () => {
  it('accepts non-empty strings', () => {
    expect(AssetId.parse('a1')).toBe('a1');
  });

  it('rejects empty strings', () => {
    expect(AssetId.safeParse('').success).toBe(false);
  });
});
