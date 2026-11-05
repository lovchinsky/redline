import type { AppError, Result } from '@redline/core';
import type { CaptureRecord, CaptureReportInput } from '@redline/rpc';

/** Reports from the page how collecting a step went. Never fails the capture. */
export interface CaptureJournal {
  record(report: CaptureReportInput): Promise<void>;
}

/** Where the service worker keeps the Diagnostics journal; local to this browser. */
export interface JournalStore {
  read(): Promise<Result<readonly CaptureRecord[], AppError>>;
  write(records: readonly CaptureRecord[]): Promise<Result<void, AppError>>;
}
