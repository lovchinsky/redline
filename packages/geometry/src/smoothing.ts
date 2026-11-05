import type { BezierPath, CubicSegment, Point } from './types';

/**
 * Converts points into a smooth path through all of them using uniform Catmull-Rom
 * splines expressed as cubic Bézier segments (ready for canvas `bezierCurveTo`).
 */
export const catmullRomPath = (points: readonly Point[], closed: boolean): BezierPath | null => {
  const first = points[0];
  if (first === undefined) return null;
  const count = points.length;
  const at = (index: number): Point => {
    const wrapped = closed
      ? ((index % count) + count) % count
      : Math.max(0, Math.min(count - 1, index));
    return points[wrapped] ?? first;
  };

  const segmentCount = closed ? count : count - 1;
  const segments: CubicSegment[] = [];
  for (let i = 0; i < segmentCount; i += 1) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    segments.push({
      control1: { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
      control2: { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 },
      end: p2,
    });
  }
  return { start: first, segments, closed };
};
