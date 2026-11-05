import type { ResolvedRegion } from '@redline/dom';
import type { Point, Polygon, Rect, Size } from '@redline/geometry';
import type { AssetRef } from '@redline/core';

export interface PageInfo {
  readonly url: string;
  readonly title: string;
  readonly viewport: Size;
  readonly devicePixelRatio: number;
  readonly scroll: Point;
  readonly language: string | null;
  readonly colorScheme: 'light' | 'dark';
}

/** The page as it looked when a shape was drawn, without the overlay. */
export interface ViewportSnapshot {
  readonly asset: AssetRef;
  readonly scroll: Point;
  readonly viewport: Size;
  readonly devicePixelRatio: number;
  /** Areas (viewport CSS px) whose pixels must never leave the device, e.g. password fields. */
  readonly sensitiveRects: readonly Rect[];
}

export interface ShapeSubject {
  readonly id: string;
  readonly source: 'lasso' | 'click' | 'keyboard';
  /** Outline in viewport CSS px of `snapshot`. */
  readonly polygon: Polygon;
  readonly region: ResolvedRegion;
  /** Null when the viewport could not be captured (e.g. the tab was not visible). */
  readonly snapshot: ViewportSnapshot | null;
}

/** Everything known about a step at commit time. Holds live elements: content script only. */
export interface StepSubject {
  readonly comment: string;
  readonly shapes: readonly ShapeSubject[];
}
