import { describe, expect, it } from 'vitest';
import { placePanel } from './placement';

const viewport = { width: 1000, height: 800 };
const panel = { width: 300, height: 200 };

describe('placePanel', () => {
  it('places the panel below the anchor, aligned to its left edge', () => {
    expect(placePanel({ x: 100, y: 100, width: 200, height: 100 }, panel, viewport)).toEqual({
      x: 100,
      y: 212,
    });
  });

  it('flips above when there is no room below', () => {
    expect(placePanel({ x: 100, y: 550, width: 200, height: 100 }, panel, viewport).y).toBe(338);
  });

  it('stays inside the viewport for anchors that fill it', () => {
    const position = placePanel({ x: -50, y: 0, width: 1100, height: 800 }, panel, viewport);
    expect(position.x).toBe(8);
    expect(position.y).toBeGreaterThanOrEqual(8);
    expect(position.y + panel.height).toBeLessThanOrEqual(792);
  });

  it('keeps the panel inside on the right edge', () => {
    expect(placePanel({ x: 900, y: 100, width: 50, height: 50 }, panel, viewport).x).toBe(692);
  });
});
