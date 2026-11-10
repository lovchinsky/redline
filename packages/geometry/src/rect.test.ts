import { describe, expect, it } from 'vitest';
import { boundsOf, inflateRect, intersectRects, rectDistance } from './rect';

describe('rect helpers', () => {
  it('computes bounds of points', () => {
    expect(boundsOf([])).toBeNull();
    expect(
      boundsOf([
        { x: 3, y: 4 },
        { x: -1, y: 10 },
      ]),
    ).toEqual({ x: -1, y: 4, width: 4, height: 6 });
  });

  it('intersects rectangles', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(intersectRects(a, { x: 5, y: 5, width: 10, height: 10 })).toEqual({
      x: 5,
      y: 5,
      width: 5,
      height: 5,
    });
    expect(intersectRects(a, { x: 10, y: 0, width: 5, height: 5 })).toBeNull();
  });

  it('measures distance between rectangles', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectDistance(a, { x: 13, y: 14, width: 1, height: 1 })).toBe(5);
    expect(rectDistance(a, { x: 5, y: 5, width: 1, height: 1 })).toBe(0);
  });

  it('inflates on every side', () => {
    const a = { x: 10, y: 10, width: 10, height: 10 };
    expect(inflateRect(a, 2)).toEqual({ x: 8, y: 8, width: 14, height: 14 });
  });
});
