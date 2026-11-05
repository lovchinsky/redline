import { ok, type AppError, type Result } from '@redline/core';
import type { TaskView } from '@redline/rpc';
import type { TaskRepository } from '../../ports/workspace';
import { taskViewOf } from './task-view';

/** Sent tasks, most recently changed first, as the side panel shows them. */
export class ListTasks {
  constructor(private readonly tasks: TaskRepository) {}

  async execute(): Promise<Result<{ tasks: readonly TaskView[] }, AppError>> {
    const tasks = await this.tasks.list();
    if (!tasks.ok) return tasks;
    return ok({
      tasks: [...tasks.value].sort((a, b) => b.updatedAt - a.updatedAt).map(taskViewOf),
    });
  }
}
