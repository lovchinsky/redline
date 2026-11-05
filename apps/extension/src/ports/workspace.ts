/**
 * The service worker's workspace: drafts, sent tasks and which draft new steps go to. Reads
 * go through the repositories; writes only through a unit of work, applied all together.
 */
import type { AppError, Draft, Result, Task, TaskId } from '@redline/core';

export interface DraftRepository {
  get(id: TaskId): Promise<Result<Draft, AppError>>;
  list(): Promise<Result<readonly Draft[], AppError>>;
}

/** Tasks that were sent. */
export interface TaskRepository {
  get(id: TaskId): Promise<Result<Task, AppError>>;
  list(): Promise<Result<readonly Task[], AppError>>;
}

/** Which draft new steps go to. Survives browser restarts. */
export interface ActiveDraftStore {
  get(): Promise<Result<TaskId | null, AppError>>;
}

/** One write of a unit of work; `null` deletes. */
export type WorkspaceWrite =
  | { readonly kind: 'draft'; readonly id: TaskId; readonly value: Draft | null }
  | { readonly kind: 'task'; readonly id: TaskId; readonly value: Task | null }
  | { readonly kind: 'active'; readonly id: TaskId | null };

/** Applies a unit of work's writes all together, or none of them. */
export interface WorkspaceStore {
  apply(writes: readonly WorkspaceWrite[]): Promise<Result<void, AppError>>;
}
