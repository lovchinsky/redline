import { describe, expect, it } from 'vitest';
import { err, map, ok } from './result';

describe('Result', () => {
  it('maps only successful values', () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    expect(map(err('boom'), (n: number) => n * 3)).toEqual(err('boom'));
  });

  it('is plain data that survives structured cloning', () => {
    const value = ok({ nested: [1, 2] });
    expect(structuredClone(value)).toEqual(value);
  });
});
