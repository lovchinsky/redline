import * as z from 'zod/mini';
import { describe, expect, it } from 'vitest';
import { parseWith } from './schema';

const point = z.object({ x: z.number(), y: z.number() });

describe('parseWith', () => {
  it('returns parsed data on success', () => {
    expect(parseWith(point, { x: 1, y: 2 })).toEqual({ ok: true, value: { x: 1, y: 2 } });
  });

  it('returns a validation error with issue paths on failure', () => {
    const result = parseWith(point, { x: 1, y: 'two' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation');
      expect(result.error.details).toEqual({
        issues: [{ path: 'y', message: expect.any(String) as string }],
      });
    }
  });
});
