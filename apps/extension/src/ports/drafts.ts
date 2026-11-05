/** Ports the draft and assembly use cases need from storage. Implemented in adapters. */
import type { Bundle } from '@redline/assembly';
import type { AppError, AssetId, Result, TaskId } from '@redline/core';

/** The latest assembled bundle of a task, frozen, with what it was assembled from. */
export interface StoredBundle {
  readonly taskId: TaskId;
  /** Task revision the bundle was assembled from; any edit makes it stale. */
  readonly revision: number;
  /** Extension version that assembled it; an update may render differently. */
  readonly clientVersion: string;
  readonly bundle: Bundle;
  readonly warnings: readonly string[];
}

export interface BundleRepository {
  get(taskId: TaskId): Promise<Result<StoredBundle | null, AppError>>;
  put(bundle: StoredBundle): Promise<Result<void, AppError>>;
  delete(taskId: TaskId): Promise<Result<void, AppError>>;
  /** Tasks that have a stored bundle, for garbage collection. */
  taskIds(): Promise<Result<readonly TaskId[], AppError>>;
}

/** Lists stored assets for garbage collection. */
export interface AssetInventory {
  idsCreatedBefore(time: number): Promise<Result<readonly AssetId[], AppError>>;
}

/** Read-only access for UI pages to binary data the service worker stored. */
export interface LocalFiles {
  asset(id: AssetId): Promise<Result<Blob, AppError>>;
  /** A file of a task's frozen bundle; fails if the bundle was replaced since `digest`. */
  bundleFile(taskId: TaskId, digest: string, path: string): Promise<Result<Blob, AppError>>;
  /** The whole frozen bundle; fails if it was replaced since `digest`. */
  bundle(taskId: TaskId, digest: string): Promise<Result<Bundle, AppError>>;
}

/** Packs a bundle into one file people can hand over: `manifest.json` plus every file. */
export interface BundleArchiver {
  archive(bundle: Pick<Bundle, 'manifest' | 'files'>): Promise<Result<Blob, AppError>>;
}
