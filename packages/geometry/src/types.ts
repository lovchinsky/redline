export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/** Axis-aligned rectangle; `x`/`y` is the top-left corner. */
export interface Rect extends Point, Size {}

/** Closed outline: the last point connects back to the first. */
export type Polygon = readonly Point[];

export interface CubicSegment {
  readonly control1: Point;
  readonly control2: Point;
  readonly end: Point;
}

/** A path made of cubic Bézier segments starting at `start`. */
export interface BezierPath {
  readonly start: Point;
  readonly segments: readonly CubicSegment[];
  readonly closed: boolean;
}
