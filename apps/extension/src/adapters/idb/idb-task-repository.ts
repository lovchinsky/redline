import {
  appError,
  err,
  ok,
  okVoid,
  parseWith,
  taskSchema,
  type AppError,
  type Result,
  type Task,
  type TaskId,
} from '@redline/core';
import type { TaskRepository } from '../../ports/drafts';
import type { DatabaseConnection } from './database';
import { storageError } from './errors';

/** A stored task that no longer matches the domain schema is reported, never trusted. */
const parseTask = (raw: unknown): Result<Task, AppError> => {
  const task = parseWith(taskSchema, raw);
  return task.ok
    ? task
    : err(appError('storage', 'A stored task is corrupted', { ...task.error.details }));
};

export class IdbTaskRepository implements TaskRepository {
  constructor(private readonly connection: DatabaseConnection) {}

  async get(id: TaskId): Promise<Result<Task, AppError>> {
    try {
      const db = await this.connection.get();
      const raw: unknown = await db.get('tasks', id);
      return raw === undefined
        ? err(appError('not-found', 'Task not found', { id }))
        : parseTask(raw);
    } catch (cause) {
      return err(storageError(cause, 'Reading task'));
    }
  }

  async list(): Promise<Result<readonly Task[], AppError>> {
    try {
      const db = await this.connection.get();
      const tasks: Task[] = [];
      for (const raw of await db.getAll('tasks')) {
        const task = parseTask(raw);
        if (!task.ok) return task;
        tasks.push(task.value);
      }
      return ok(tasks);
    } catch (cause) {
      return err(storageError(cause, 'Listing tasks'));
    }
  }

  async save(task: Task): Promise<Result<void, AppError>> {
    try {
      const db = await this.connection.get();
      await db.put('tasks', task);
      return okVoid();
    } catch (cause) {
      return err(storageError(cause, 'Saving task'));
    }
  }

  async delete(id: TaskId): Promise<Result<void, AppError>> {
    try {
      const db = await this.connection.get();
      await db.delete('tasks', id);
      return okVoid();
    } catch (cause) {
      return err(storageError(cause, 'Deleting task'));
    }
  }
}
