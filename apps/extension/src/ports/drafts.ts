/** Ports the draft and assembly use cases need from storage. Implemented in adapters. */
import type { Bundle } from '@redline/assembly';
import type { AppError, AssetId, Result, Task, TaskId } from '@redline/core';

export interface TaskRepository {
  get(id: TaskId): Promise<Result<Task, AppError>>;
  list(): Promise<Result<readonly Task[], AppError>>;
  save(task: Task): Promise<Result<void, AppError>>;
  delete(id: TaskId): Promise<Result<void, AppError>>;
}

/** Remembers which draft new steps go to. Survives browser restarts. */
export interface ActiveDraftStore {
  get(): Promise<Result<TaskId | null, AppError>>;
  set(id: TaskId | null): Promise<Result<void, AppError>>;
}

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
}
