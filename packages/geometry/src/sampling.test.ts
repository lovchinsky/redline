import { describe, expect, it } from 'vitest';
import { coverage, samplePolygon, sampleRect } from './sampling';
import { ellipsePolygon, rectPolygon } from './shapes';
import { polygonContains } from './polygon';

describe('sampleRect', () => {
  it('never exceeds the sample budget', () => {
    expect(
      sampleRect({ x: 0, y: 0, width: 5000, height: 3000 }, 1, 256).length,
    ).toBeLessThanOrEqual(256);
  });

  it('returns nothing for empty rectangles', () => {
    expect(sampleRect({ x: 0, y: 0, width: 0, height: 10 }, 1, 10)).toEqual([]);
  });
});

describe('samplePolygon', () => {
  it('returns only points inside the polygon, within budget', () => {
    const polygon = ellipsePolygon({ x: 0, y: 0, width: 800, height: 400 });
    const samples = samplePolygon(polygon);
    expect(samples.length).toBeGreaterThan(50);
    expect(samples.length).toBeLessThanOrEqual(400);
    expect(samples.every((p) => polygonContains(polygon, p))).toBe(true);
  });

  it('samples small shapes densely enough to hit small elements', () => {
    const samples = samplePolygon(rectPolygon({ x: 0, y: 0, width: 40, height: 40 }));
    expect(samples.length).toBeGreaterThanOrEqual(16);
  });
});

describe('coverage', () => {
  const rect = { x: 100, y: 100, width: 200, height: 100 };

  it('is 1 for a rectangle fully inside the lasso', () => {
    expect(coverage(rect, rectPolygon({ x: 50, y: 50, width: 300, height: 200 }))).toBe(1);
  });

  it('is 0 for a rectangle outside the lasso', () => {
    expect(coverage(rect, rectPolygon({ x: 0, y: 0, width: 50, height: 50 }))).toBe(0);
  });

  it('approximates partial overlap', () => {
    const half = rectPolygon({ x: 0, y: 0, width: 200, height: 400 });
    expect(coverage(rect, half)).toBeCloseTo(0.5, 1);
  });

  it('is about π/4 for the ellipse inscribed in the rectangle', () => {
    expect(coverage(rect, ellipsePolygon(rect))).toBeCloseTo(Math.PI / 4, 1);
  });
});
