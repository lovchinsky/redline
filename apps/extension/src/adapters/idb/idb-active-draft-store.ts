import { TaskId, err, ok, type AppError, type Result } from '@redline/core';
import type { ActiveDraftStore } from '../../ports/workspace';
import type { DatabaseConnection } from './database';
import { storageError } from './errors';

/** Key of the active draft in the `workspace` store; written with the rest of a unit of work. */
export const ACTIVE_DRAFT_KEY = 'activeDraft';

export class IdbActiveDraftStore implements ActiveDraftStore {
  constructor(private readonly connection: DatabaseConnection) {}

  async get(): Promise<Result<TaskId | null, AppError>> {
    try {
      const db = await this.connection.get();
      const raw: unknown = await db.get('workspace', ACTIVE_DRAFT_KEY);
      const id = TaskId.safeParse(raw);
      // Anything but a valid id (nothing stored yet, or garbage) means no active draft.
      return ok(id.success ? id.data : null);
    } catch (cause) {
      return err(storageError(cause, 'Reading the active draft'));
    }
  }
}
