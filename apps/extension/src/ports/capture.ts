/** Ports the capture use cases need from the platform. Implemented in adapters. */
import type { ViewportSnapshot } from '@redline/capture';
import type {
  AppError,
  CaptureId,
  CaptureUnavailableReason,
  Result,
  StepCapture,
} from '@redline/core';
import type {
  AppProtocol,
  CaptureStartResponse,
  ImageDerivationRequest,
  ResponseOf,
  StepRecord,
} from '@redline/rpc';

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

/** Context collected for one step. The step's own facts live in its task. */
export interface CaptureRecord {
  readonly id: CaptureId;
  readonly createdAt: number;
  readonly capture: StepCapture;
}

export interface CaptureRepository {
  put(record: CaptureRecord): Promise<Result<void, AppError>>;
  get(id: CaptureId): Promise<Result<CaptureRecord, AppError>>;
  list(): Promise<Result<readonly CaptureRecord[], AppError>>;
  delete(id: CaptureId): Promise<Result<void, AppError>>;
}

export type CommittedStep = ResponseOf<AppProtocol, 'capture.commitStep'>;

/** Hands a captured step to the service worker, which adds it to the active draft. */
export interface StepCommitter {
  commit(step: StepRecord, capture: StepCapture): Promise<Result<CommittedStep, AppError>>;
}

/** Takes a snapshot of the current viewport (without the overlay; the caller hides it). */
export interface ViewportSnapshots {
  take(): Promise<Result<ViewportSnapshot, AppError>>;
}

/** Puts the page runtime into a frame's MAIN world. Idempotent: the runtime starts once. */
export interface PageRuntimeInjector {
  inject(target: {
    readonly tabId: number;
    readonly frameId: number;
  }): Promise<Result<void, AppError>>;
}

/**
 * Starts the page runtime at document_start on the given sites, so errors and failed requests
 * are observed from page load. Replaces the previous set; an empty set removes it.
 */
export interface PageRuntimeRegistration {
  sync(matchPatterns: readonly string[]): Promise<Result<void, AppError>>;
}

/** Which host permissions the user has granted. */
export interface GrantedHosts {
  includes(matchPattern: string): Promise<boolean>;
}
