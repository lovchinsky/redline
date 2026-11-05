import type { Point, Polygon } from './types';

const isLeft = (a: Point, b: Point, p: Point): number =>
  (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);

/**
 * Winding number of the polygon around `point` (Sunday's algorithm).
 * Non-zero means inside under the non-zero rule, which treats every lobe of a
 * self-crossing lasso, and areas circled twice, as inside.
 */
export const windingNumber = (polygon: Polygon, point: Point): number => {
  let winding = 0;
  const count = polygon.length;
  for (let i = 0; i < count; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % count];
    if (a === undefined || b === undefined) continue;
    if (a.y <= point.y) {
      if (b.y > point.y && isLeft(a, b, point) > 0) winding += 1;
    } else if (b.y <= point.y && isLeft(a, b, point) < 0) {
      winding -= 1;
    }
  }
  return winding;
};

export const polygonContains = (polygon: Polygon, point: Point): boolean =>
  polygon.length >= 3 && windingNumber(polygon, point) !== 0;

/** Length of the outline; `closed` adds the segment from the last point back to the first. */
export const pathLength = (points: readonly Point[], closed: boolean): number => {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    if (a !== undefined && b !== undefined) length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  const first = points[0];
  const last = points.at(-1);
  if (closed && first !== undefined && last !== undefined && points.length > 2) {
    length += Math.hypot(first.x - last.x, first.y - last.y);
  }
  return length;
};
