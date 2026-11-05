import { describe, expect, it } from 'vitest';
import { andThen, err, map, mapErr, ok, unwrapOr } from './result';

describe('Result', () => {
  it('maps only successful values', () => {
    expect(map(ok(2), (n) => n * 3)).toEqual(ok(6));
    expect(map(err('boom'), (n: number) => n * 3)).toEqual(err('boom'));
  });

  it('maps only errors', () => {
    expect(mapErr(err('boom'), (e) => e.toUpperCase())).toEqual(err('BOOM'));
    expect(mapErr(ok(1), (e: string) => e.toUpperCase())).toEqual(ok(1));
  });

  it('chains computations and short-circuits on the first error', () => {
    const half = (n: number) => (n % 2 === 0 ? ok(n / 2) : err(`odd: ${String(n)}`));
    expect(andThen(ok(8), half)).toEqual(ok(4));
    expect(andThen(ok(3), half)).toEqual(err('odd: 3'));
    expect(andThen(err('earlier'), half)).toEqual(err('earlier'));
  });

  it('falls back on error', () => {
    expect(unwrapOr(ok(1), 0)).toBe(1);
    expect(unwrapOr(err('x'), 0)).toBe(0);
  });

  it('is plain data that survives structured cloning', () => {
    const value = ok({ nested: [1, 2] });
    expect(structuredClone(value)).toEqual(value);
  });
});
