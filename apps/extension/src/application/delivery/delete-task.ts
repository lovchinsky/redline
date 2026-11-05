import { ok, type AppError, type Result, type TaskId } from '@redline/core';
import type { TaskRepository } from '../../ports/workspace';
import { discardCollected, type DiscardCollectedDeps } from '../drafts/discard-collected';
import type { WorkspaceWriter } from '../workspace/workspace-writer';

export interface DeleteTaskDeps extends DiscardCollectedDeps {
  readonly tasks: TaskRepository;
  readonly writer: WorkspaceWriter;
}

/**
 * Deletes a sent task in any state, with everything kept for it. A task the receiver accepted
 * keeps going there; the extension only stops following it.
 */
export class DeleteTask {
  constructor(private readonly deps: DeleteTaskDeps) {}

  execute(taskId: TaskId): Promise<Result<Record<string, never>, AppError>> {
    const { tasks, writer } = this.deps;
    return writer.run(async (tx) => {
      const task = await tasks.get(taskId);
      if (!task.ok) return task;
      tx.saveTask(task.value, null);
      tx.afterCommit(() => discardCollected(this.deps, taskId, task.value.steps));
      return ok({});
    });
  }
}
