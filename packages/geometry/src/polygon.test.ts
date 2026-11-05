import { describe, expect, it } from 'vitest';
import { pathLength, polygonContains, windingNumber } from './polygon';
import { rectPolygon } from './shapes';

const square = rectPolygon({ x: 0, y: 0, width: 10, height: 10 });

describe('polygonContains', () => {
  it('detects points inside and outside a simple polygon', () => {
    expect(polygonContains(square, { x: 5, y: 5 })).toBe(true);
    expect(polygonContains(square, { x: 15, y: 5 })).toBe(false);
  });

  it('treats both lobes of a figure-eight as inside', () => {
    const figureEight = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(polygonContains(figureEight, { x: 2, y: 5 })).toBe(true);
    expect(polygonContains(figureEight, { x: 18, y: 5 })).toBe(true);
  });

  it('treats an area circled twice as inside (non-zero rule)', () => {
    const twice = [...square, ...square];
    expect(Math.abs(windingNumber(twice, { x: 5, y: 5 }))).toBe(2);
    expect(polygonContains(twice, { x: 5, y: 5 })).toBe(true);
  });

  it('needs at least three points', () => {
    expect(polygonContains(square.slice(0, 2), { x: 1, y: 1 })).toBe(false);
  });
});

describe('pathLength', () => {
  it('measures open and closed outlines', () => {
    expect(pathLength(square, false)).toBe(30);
    expect(pathLength(square, true)).toBe(40);
  });
});
