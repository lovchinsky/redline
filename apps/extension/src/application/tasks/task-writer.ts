import {
  SerialQueue,
  ok,
  type AppError,
  type Logger,
  type Result,
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

/** What a unit of work may do: write tasks, and say what changed. */
export interface TaskTransaction {
  /** Saves (or, for `null`, deletes) a task; the change is announced after the work is done. */
  commit(before: Task | null, after: Task | null): Promise<Result<void, AppError>>;
  /** Announces a change that wrote no task, e.g. another draft became active. */
  touch(task: Task): void;
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
 * The single way the service worker's state is written. Units of work run one at a time
 * (read → change → save cannot interleave between a step commit, an edit and a delivery).
 * What they commit is announced once the work has finished, outside the queue and in commit
 * order: observers only ever see state that is complete, whatever order the work wrote it in,
 * and the next write does not wait for them. An observer failing never fails the write.
 */
export class TaskWriter {
  /** Announcements run one after another too, so observers see changes in commit order. */
  private readonly announcements = new SerialQueue();

  constructor(private readonly deps: TaskWriterDeps) {}

  /**
   * Runs a unit of work in its turn of the queue. Resolves once its changes are announced,
   * so a caller that awaits it sees every effect, observers included.
   */
  async run<T>(
    work: (tx: TaskTransaction) => Promise<Result<T, AppError>>,
  ): Promise<Result<T, AppError>> {
    const changes: TaskChange[] = [];
    const tx: TaskTransaction = {
      commit: async (before, after) => {
        const taskId = after?.id ?? before?.id;
        if (taskId === undefined) return ok(undefined);
        const written =
          after === null ? await this.deps.tasks.delete(taskId) : await this.deps.tasks.save(after);
        if (written.ok) changes.push({ taskId, before, after });
        return written;
      },
      touch: (task) => {
        changes.push({ taskId: task.id, before: task, after: task });
      },
    };
    try {
      return await this.deps.queue.run(() => work(tx));
    } finally {
      // Even when the work failed later on, what it committed is saved and must be told.
      if (changes.length > 0) await this.announcements.run(() => this.announce(changes));
    }
  }

  /**
   * Changes one task in one unit of work: `decide` sees the task as it is now and returns its
   * next version, the same task when there is nothing to do, or why it cannot change.
   */
  update(
    taskId: TaskId,
    decide: (task: Task) => Result<Task, AppError>,
  ): Promise<Result<TaskUpdate, AppError>> {
    return this.run(async (tx) => {
      const before = await this.deps.tasks.get(taskId);
      if (!before.ok) return before;
      const after = decide(before.value);
      if (!after.ok) return after;
      if (after.value !== before.value) {
        const committed = await tx.commit(before.value, after.value);
        if (!committed.ok) return committed;
      }
      return ok({ before: before.value, after: after.value });
    });
  }

  private async announce(changes: readonly TaskChange[]): Promise<void> {
    for (const change of changes) {
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
}
