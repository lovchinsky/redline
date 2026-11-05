import { describe, expect, it } from 'vitest';
import { simplifyPath } from './simplify';

describe('simplifyPath', () => {
  it('removes nearly collinear points and keeps corners', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 5, y: 0.5 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expect(simplifyPath(points, 1)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });

  it('keeps short paths unchanged', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(simplifyPath(points, 5)).toEqual(points);
  });

  it('handles long strokes without recursion limits', () => {
    const points = Array.from({ length: 100_000 }, (_, i) => ({ x: i, y: Math.sin(i / 100) * 50 }));
    const simplified = simplifyPath(points, 2);
    expect(simplified.length).toBeGreaterThan(2);
    expect(simplified.length).toBeLessThan(points.length / 10);
  });
});
