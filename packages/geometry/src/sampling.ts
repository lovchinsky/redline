import { polygonContains } from './polygon';
import { boundsOf, intersectRects, rectArea } from './rect';
import type { Point, Polygon, Rect } from './types';

/** Centres of a cols × rows grid laid over the rectangle. */
const gridCentres = (rect: Rect, cols: number, rows: number): Point[] => {
  const stepX = rect.width / cols;
  const stepY = rect.height / rows;
  const points: Point[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      points.push({ x: rect.x + (col + 0.5) * stepX, y: rect.y + (row + 0.5) * stepY });
    }
  }
  return points;
};

/** Grid of roughly `step`-spaced points over the rectangle, never more than `maxPoints`. */
export const sampleRect = (rect: Rect, step: number, maxPoints: number): Point[] => {
  if (rectArea(rect) === 0) return [];
  const effectiveStep = Math.max(step, Math.sqrt(rectArea(rect) / maxPoints));
  const cols = Math.max(1, Math.min(Math.round(rect.width / effectiveStep), maxPoints));
  const rows = Math.max(
    1,
    Math.min(Math.round(rect.height / effectiveStep), Math.floor(maxPoints / cols)),
  );
  return gridCentres(rect, cols, rows);
};

export interface PolygonSamplingOptions {
  /** Densest spacing between samples, in CSS pixels. */
  readonly minStep: number;
  /** Sparsest spacing between samples, in CSS pixels. */
  readonly maxStep: number;
  /** Upper bound on samples taken over the polygon's bounding box. */
  readonly maxSamples: number;
}

export const DEFAULT_POLYGON_SAMPLING: PolygonSamplingOptions = {
  minStep: 8,
  maxStep: 24,
  maxSamples: 400,
};

/**
 * Evenly spaced points inside the polygon. Spacing scales with the polygon size
 * (√area / 40, clamped to [minStep, maxStep]) and grows further to respect `maxSamples`.
 */
export const samplePolygon = (
  polygon: Polygon,
  options: PolygonSamplingOptions = DEFAULT_POLYGON_SAMPLING,
): Point[] => {
  const bounds = boundsOf(polygon);
  if (bounds === null || polygon.length < 3) return [];
  const step = Math.min(
    options.maxStep,
    Math.max(options.minStep, Math.sqrt(rectArea(bounds)) / 40),
  );
  return sampleRect(bounds, step, options.maxSamples).filter((point) =>
    polygonContains(polygon, point),
  );
};

/**
 * Fraction (0..1) of the rectangle that lies inside the polygon, estimated on a sample grid
 * of at most `maxSamples` points. Sampling (rather than exact clipping) stays correct for
 * self-crossing lassos under the non-zero rule.
 */
export const coverage = (rect: Rect, polygon: Polygon, maxSamples = 256): number => {
  const polygonBounds = boundsOf(polygon);
  if (polygonBounds === null || rectArea(rect) === 0) return 0;
  if (intersectRects(rect, polygonBounds) === null) return 0;
  const samples = sampleRect(rect, 1, maxSamples);
  const inside = samples.filter((point) => polygonContains(polygon, point)).length;
  return samples.length === 0 ? 0 : inside / samples.length;
};
