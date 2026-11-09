import type { TaskId } from '../domain/ids';
import type { Result } from '../domain/result';
import { cancelTask, type Task, type TaskEvent } from '../domain/task';
import type { TaskQueries } from '../ports/tasks';
import type { RequestError } from './errors';
import type { TaskWriter } from './task-writer';

/** What the operator does with tasks, from the command line. */
export class TaskOperations {
  constructor(
    private readonly deps: { readonly queries: TaskQueries; readonly writer: TaskWriter },
  ) {}

  async show(
    taskId: TaskId,
  ): Promise<{ readonly task: Task; readonly history: readonly TaskEvent[] } | null> {
    const task = await this.deps.queries.get(taskId);
    return task === null ? null : { task, history: await this.deps.queries.history(taskId) };
  }

  async cancel(taskId: TaskId, reason: string): Promise<Result<Task, RequestError>> {
    const cancelled = await this.deps.writer.update(taskId, (task, now) =>
      cancelTask(task, reason, now),
    );
    return cancelled.ok ? { ok: true, value: cancelled.value.transition.task } : cancelled;
  }
}
