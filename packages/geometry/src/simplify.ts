import type { Point } from './types';

const distanceToSegment = (p: Point, a: Point, b: Point): number => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};

/**
 * Ramer–Douglas–Peucker simplification. Iterative, so long strokes cannot overflow the stack.
 * Keeps the first and last points; drops points closer than `epsilon` to the simplified line.
 */
export const simplifyPath = (points: readonly Point[], epsilon: number): Point[] => {
  if (points.length <= 2) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  const ranges: [number, number][] = [[0, points.length - 1]];

  for (let range = ranges.pop(); range !== undefined; range = ranges.pop()) {
    const [start, end] = range;
    const a = points[start];
    const b = points[end];
    if (a === undefined || b === undefined) continue;
    let farthest = -1;
    let maxDistance = epsilon;
    for (let i = start + 1; i < end; i += 1) {
      const p = points[i];
      if (p === undefined) continue;
      const distance = distanceToSegment(p, a, b);
      if (distance > maxDistance) {
        maxDistance = distance;
        farthest = i;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = true;
      ranges.push([start, farthest], [farthest, end]);
    }
  }
  return points.filter((_, index) => keep[index]);
};
