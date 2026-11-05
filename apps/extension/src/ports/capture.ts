/** Ports the capture use cases need from the platform. Implemented in adapters. */
import type { ViewportSnapshot } from '@redline/capture';
import type { AppError, CaptureUnavailableReason, Result, StepCapture } from '@redline/core';
import type { CaptureStartResponse, ImageDerivationRequest, StepRecord } from '@redline/rpc';

/** Puts the capture content script into a tab. Idempotent: the script starts once per document. */
export interface CaptureScriptInjector {
  inject(tabId: number): Promise<Result<void, AppError>>;
}

/** Talks to the capture content script running in a tab. */
export interface TabCaptureClient {
  start(tabId: number): Promise<Result<CaptureStartResponse, AppError>>;
}

/** Tells the user, outside the page, why capture did not start in a tab. */
export interface CaptureUnavailableNotice {
  show(tabId: number, reason: CaptureUnavailableReason): Promise<void>;
  clear(tabId: number): Promise<void>;
}

/** A captured viewport image with its pixel size. */
export interface CapturedImage {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

/** Screenshots the visible viewport of a tab. */
export interface ViewportCapturer {
  capture(tabId: number): Promise<Result<CapturedImage, AppError>>;
}

/** Crops, outlines, masks and re-encodes an image. */
export interface ImageDeriver {
  derive(source: Blob, request: ImageDerivationRequest): Promise<Result<CapturedImage, AppError>>;
}

/** A stored step: domain facts plus the collected context. */
export interface CaptureRecord {
  readonly id: string;
  readonly createdAt: number;
  readonly step: StepRecord;
  readonly capture: StepCapture;
}

export interface CaptureRepository {
  put(record: CaptureRecord): Promise<Result<void, AppError>>;
  get(id: string): Promise<Result<CaptureRecord, AppError>>;
}

/** Hands a captured step to the service worker for storage. */
export interface StepCommitter {
  commit(step: StepRecord, capture: StepCapture): Promise<Result<{ captureId: string }, AppError>>;
}

/** Takes a snapshot of the current viewport (without the overlay; the caller hides it). */
export interface ViewportSnapshots {
  take(): Promise<Result<ViewportSnapshot, AppError>>;
}
