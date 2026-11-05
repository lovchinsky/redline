import { describe, expect, it } from 'vitest';
import { appError, appErrorSchema, toAppError } from './errors';

describe('AppError', () => {
  it('omits details when none are given', () => {
    expect(appError('not-found', 'missing')).toStrictEqual({
      code: 'not-found',
      message: 'missing',
    });
  });

  it('normalizes thrown Error instances', () => {
    expect(toAppError(new TypeError('bad'), 'storage')).toStrictEqual({
      code: 'storage',
      message: 'bad',
      details: { name: 'TypeError' },
    });
  });

  it('normalizes non-error throwables', () => {
    expect(toAppError('plain')).toStrictEqual({ code: 'internal', message: 'plain' });
    expect(toAppError(42)).toStrictEqual({ code: 'internal', message: 'Unknown error' });
  });

  it('validates the serialized shape', () => {
    expect(appErrorSchema.safeParse(appError('quota', 'full', { bytes: 1 })).success).toBe(true);
    expect(appErrorSchema.safeParse({ code: 'nope', message: 'x' }).success).toBe(false);
  });
});
