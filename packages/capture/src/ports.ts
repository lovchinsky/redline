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

/** A component that renders an element, as the framework's build records it. */
export interface ComponentFrame {
  readonly name: string;
  readonly file: string | null;
  readonly line: number | null;
}

/** Components rendering an element, innermost first. */
export interface ComponentTrace {
  readonly framework: 'react' | 'vue' | 'svelte' | 'angular';
  readonly version: string | null;
  readonly mode: 'development' | 'production' | 'unknown';
  readonly components: readonly ComponentFrame[];
}

export interface ObservedError {
  readonly message: string;
  readonly source: string | null;
  readonly count: number;
  readonly lastSeenMsAgo: number;
}

export interface FailedRequest {
  readonly url: string;
  /** 0 when the request failed without a response. */
  readonly status: number;
  readonly initiator: string;
  readonly count: number;
  readonly lastSeenMsAgo: number;
}

export interface RuntimeReport {
  /** Since page load (a bound site), or only since capture started. */
  readonly observedSince: 'page-load' | 'capture-start';
  readonly errors: readonly ObservedError[];
  readonly failedRequests: readonly FailedRequest[];
}

/**
 * What only the page's own JavaScript world can see: framework components and runtime
 * failures. Answers are hints from an untrusted page, already validated and size-capped.
 */
export interface PageRuntimePort {
  /** `null` when no supported framework renders the element (or its build hides names). */
  componentTrace(element: Element): Promise<Result<ComponentTrace | null, AppError>>;
  runtimeReport(): Promise<Result<RuntimeReport, AppError>>;
}
