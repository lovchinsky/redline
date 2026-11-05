import {
  ok,
  type AppError,
  type Logger,
  type Result,
  type SerialQueue,
  type Task,
  type TaskId,
} from '@redline/core';
import type { TaskRepository } from '../../ports/drafts';

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
  readonly tasks: TaskRepository;
  readonly queue: SerialQueue;
  readonly observers: readonly TaskObserver[];
  readonly logger: Logger;
}

/** What `update` did: `after` is `before` itself when there was nothing to change. */
export interface TaskUpdate {
  readonly before: Task;
  readonly after: Task;
}

/**
 * The single way task state is written. Writes run one at a time (read → change → save
 * cannot interleave between a step commit, an edit and a delivery), and every saved change
 * is announced to the observers. An observer failing never fails the write.
 */
export class TaskWriter {
  constructor(private readonly deps: TaskWriterDeps) {}

  /** Runs work that writes tasks (with `commit`) and other state in one turn of the queue. */
  run<T>(work: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return this.deps.queue.run(work);
  }

  /**
   * Changes one task in one turn of the queue: `decide` sees the task as it is now and returns
   * its next version, the same task when there is nothing to do, or why it cannot change.
   */
  update(
    taskId: TaskId,
    decide: (task: Task) => Result<Task, AppError>,
  ): Promise<Result<TaskUpdate, AppError>> {
    return this.run(async () => {
      const before = await this.deps.tasks.get(taskId);
      if (!before.ok) return before;
      const after = decide(before.value);
      if (!after.ok) return after;
      if (after.value !== before.value) {
        const committed = await this.commit(before.value, after.value);
        if (!committed.ok) return committed;
      }
      return ok({ before: before.value, after: after.value });
    });
  }

  /** Saves (or, for `null`, deletes) a task and announces the change. Only within `run`. */
  async commit(before: Task | null, after: Task | null): Promise<Result<void, AppError>> {
    const taskId = after?.id ?? before?.id;
    if (taskId === undefined) return ok(undefined);
    const written =
      after === null ? await this.deps.tasks.delete(taskId) : await this.deps.tasks.save(after);
    if (!written.ok) return written;
    await this.announce({ taskId, before, after });
    return ok(undefined);
  }

  /** Tells the observers about a change that wrote no task, e.g. another draft became active. */
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
