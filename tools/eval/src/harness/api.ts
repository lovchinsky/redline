import type { RegionSummary } from '@redline/dom';
import type { Rect } from '@redline/geometry';

export interface HarnessAnchor {
  readonly kind: string;
  readonly value: string;
  readonly score: number;
}

export interface HarnessResult {
  /** What the lasso resolved to; null when it caught nothing. */
  readonly region: RegionSummary | null;
  /** Ranked as the collector ranks them, best first. */
  readonly anchors: readonly HarnessAnchor[];
}

/** Exposed as `window.redlineEval` by the harness bundle. */
export interface HarnessApi {
  anchorsAround(rect: Rect): Promise<HarnessResult>;
}
