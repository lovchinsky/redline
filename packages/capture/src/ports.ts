import type { AppError, AssetRef, Result } from '@redline/core';
import type { Polygon, Rect } from '@redline/geometry';

export interface ImageDerivation {
  readonly source: AssetRef;
  /** Area to keep, in viewport CSS px of the snapshot. */
  readonly area: Rect;
  /** Outline drawn over the image, in viewport CSS px of the snapshot. */
  readonly outline: Polygon;
  readonly smoothOutline: boolean;
  /** Areas to paint over, in viewport CSS px of the snapshot. */
  readonly masks: readonly Rect[];
  readonly devicePixelRatio: number;
  readonly format: 'image/png' | 'image/webp';
  /** Longest side of the output, in image pixels. */
  readonly maxSide: number;
}

export interface DerivedImage {
  readonly asset: AssetRef;
  readonly width: number;
  readonly height: number;
}

/** Produces derived images (crops, overviews) from stored snapshots. */
export interface ImagePort {
  derive(request: ImageDerivation): Promise<Result<DerivedImage, AppError>>;
}
