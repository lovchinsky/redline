import type { AppError, Logger, Result, SerialQueue, Task, TaskId } from '@redline/core';

/** One saved change of a task: `before` is `null` for a new task, `after` for a deleted one. */
export interface TaskChange {
  readonly taskId: TaskId;
  readonly before: Task | null;
  readonly after: Task | null;
}

/** Reacts to saved task changes: UI events, the toolbar badge, notifications, wake-ups. */
export interface TaskObserver {
  readonly name: string;
  taskChanged(change: TaskChange): Promise<void>;
}

export interface TaskWriterDeps {
  readonly queue: SerialQueue;
  readonly observers: readonly TaskObserver[];
  readonly logger: Logger;
}

/**
 * The single way task state is written. Writes run one at a time (read → change → save
 * cannot interleave between a step commit, an edit and a delivery), and every saved change
 * is announced to the observers. An observer failing never fails the write.
 */
export class TaskWriter {
  constructor(private readonly deps: TaskWriterDeps) {}

  run<T>(work: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return this.deps.queue.run(work);
  }

  async announce(change: TaskChange): Promise<void> {
    for (const observer of this.deps.observers) {
      try {
        await observer.taskChanged(change);
      } catch (cause) {
        this.deps.logger.error('A task observer failed', {
          observer: observer.name,
          cause: String(cause),
        });
      }
    }
  }
}
