import type { Point, Rect, Size } from '@redline/geometry';
import type { ImageDerivationRequest } from '@redline/rpc';

export interface DerivationPlan {
  /** Source rectangle in image pixels. */
  readonly source: Rect;
  /** Output size in image pixels. */
  readonly output: Size;
  /** Maps a viewport CSS-pixel point onto the output image. */
  readonly toOutput: (point: Point) => Point;
  /** Output pixels per viewport CSS pixel. */
  readonly scale: number;
}

/**
 * Where to read from and how large to write, given a request in viewport CSS pixels and the
 * actual snapshot size. Clamps to the image so rounding or a stale DPR cannot read past it.
 */
export const planDerivation = (
  request: ImageDerivationRequest,
  image: Size,
): DerivationPlan | null => {
  const ratio = request.devicePixelRatio;
  const x = Math.min(Math.max(0, Math.round(request.area.x * ratio)), image.width);
  const y = Math.min(Math.max(0, Math.round(request.area.y * ratio)), image.height);
  const width = Math.min(Math.round(request.area.width * ratio), image.width - x);
  const height = Math.min(Math.round(request.area.height * ratio), image.height - y);
  if (width <= 0 || height <= 0) return null;

  const fit = Math.min(1, request.maxSide / Math.max(width, height));
  const scale = ratio * fit;
  return {
    source: { x, y, width, height },
    output: {
      width: Math.max(1, Math.round(width * fit)),
      height: Math.max(1, Math.round(height * fit)),
    },
    toOutput: (point) => ({ x: point.x * scale - x * fit, y: point.y * scale - y * fit }),
    scale,
  };
};
