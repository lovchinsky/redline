import type { Point, Rect } from './types';

export const rectArea = (rect: Rect): number => Math.max(0, rect.width) * Math.max(0, rect.height);

export const rectRight = (rect: Rect): number => rect.x + rect.width;

export const rectBottom = (rect: Rect): number => rect.y + rect.height;

export const rectCenter = (rect: Rect): Point => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

/** Smallest rectangle containing every point, or `null` for no points. */
export const boundsOf = (points: readonly Point[]): Rect | null => {
  const [first, ...rest] = points;
  if (first === undefined) return null;
  let minX = first.x;
  let minY = first.y;
  let maxX = first.x;
  let maxY = first.y;
  for (const { x, y } of rest) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/** Overlap of two rectangles, or `null` when they do not overlap with positive area. */
export const intersectRects = (a: Rect, b: Rect): Rect | null => {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(rectRight(a), rectRight(b));
  const bottom = Math.min(rectBottom(a), rectBottom(b));
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
};

export const inflateRect = (rect: Rect, by: number): Rect => ({
  x: rect.x - by,
  y: rect.y - by,
  width: rect.width + by * 2,
  height: rect.height + by * 2,
});

export const rectContainsPoint = (rect: Rect, point: Point): boolean =>
  point.x >= rect.x &&
  point.x <= rectRight(rect) &&
  point.y >= rect.y &&
  point.y <= rectBottom(rect);

export const rectContainsRect = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  rectRight(inner) <= rectRight(outer) &&
  rectBottom(inner) <= rectBottom(outer);

/** Shortest distance between two rectangles; 0 when they touch or overlap. */
export const rectDistance = (a: Rect, b: Rect): number => {
  const dx = Math.max(0, b.x - rectRight(a), a.x - rectRight(b));
  const dy = Math.max(0, b.y - rectBottom(a), a.y - rectBottom(b));
  return Math.hypot(dx, dy);
};

export const translateRect = (rect: Rect, by: Point): Rect => ({
  ...rect,
  x: rect.x + by.x,
  y: rect.y + by.y,
});
