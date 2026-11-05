import type { Point, Rect, Size } from '@redline/geometry';

export interface PlacementOptions {
  /** Space between the anchor and the panel. */
  readonly gap: number;
  /** Minimum space between the panel and the viewport edges. */
  readonly margin: number;
}

export const DEFAULT_PLACEMENT: PlacementOptions = { gap: 12, margin: 8 };

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Top-left position for a floating panel next to an anchor: below it when there is room,
 * otherwise above, otherwise on the roomier side; always kept inside the viewport.
 */
export const placePanel = (
  anchor: Rect,
  panel: Size,
  viewport: Size,
  { gap, margin }: PlacementOptions = DEFAULT_PLACEMENT,
): Point => {
  const below = anchor.y + anchor.height + gap;
  const above = anchor.y - gap - panel.height;
  const fitsBelow = below + panel.height <= viewport.height - margin;
  const fitsAbove = above >= margin;
  const roomBelow = viewport.height - (anchor.y + anchor.height);
  const preferred = fitsBelow || (!fitsAbove && roomBelow >= anchor.y) ? below : above;

  return {
    x: clamp(anchor.x, margin, viewport.width - panel.width - margin),
    y: clamp(preferred, margin, viewport.height - panel.height - margin),
  };
};
