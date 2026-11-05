import { TaskId, err, ok, okVoid, type AppError, type Result } from '@redline/core';
import type { ActiveDraftStore } from '../../ports/drafts';
import type { DatabaseConnection } from './database';
import { storageError } from './errors';

const KEY = 'activeDraft';

export class IdbActiveDraftStore implements ActiveDraftStore {
  constructor(private readonly connection: DatabaseConnection) {}

  async get(): Promise<Result<TaskId | null, AppError>> {
    try {
      const db = await this.connection.get();
      const raw: unknown = await db.get('workspace', KEY);
      const id = TaskId.safeParse(raw);
      // Anything but a valid id (nothing stored yet, or garbage) means no active draft.
      return ok(id.success ? id.data : null);
    } catch (cause) {
      return err(storageError(cause, 'Reading the active draft'));
    }
  }

  async set(id: TaskId | null): Promise<Result<void, AppError>> {
    try {
      const db = await this.connection.get();
      if (id === null) await db.delete('workspace', KEY);
      else await db.put('workspace', id, KEY);
      return okVoid();
    } catch (cause) {
      return err(storageError(cause, 'Saving the active draft'));
    }
  }
}
