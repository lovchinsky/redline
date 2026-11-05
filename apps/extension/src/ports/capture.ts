/** Ports the capture use cases need from the platform. Implemented in adapters. */
import type { AppError, CaptureUnavailableReason, Result } from '@redline/core';
import type { CaptureStartResponse } from '@redline/rpc';

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
