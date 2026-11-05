import { describe, expect, it } from 'vitest';
import { catmullRomPath } from './smoothing';

const points = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('catmullRomPath', () => {
  it('passes through every point of a closed outline', () => {
    const path = catmullRomPath(points, true);
    expect(path?.segments.map((s) => s.end)).toEqual([...points.slice(1), points[0]]);
  });

  it('has one segment fewer for an open stroke', () => {
    expect(catmullRomPath(points, false)?.segments).toHaveLength(3);
  });

  it('returns null without points', () => {
    expect(catmullRomPath([], true)).toBeNull();
  });
});
