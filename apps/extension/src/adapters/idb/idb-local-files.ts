import {
  appError,
  err,
  ok,
  type AppError,
  type AssetId,
  type Result,
  type TaskId,
} from '@redline/core';
import type { LocalFiles } from '../../ports/drafts';
import type { DatabaseConnection } from './database';
import { storageError } from './errors';

/**
 * Read-only access for extension pages. Binary data stays out of runtime messaging: pages
 * share the extension origin, so they read the database the service worker writes.
 */
export class IdbLocalFiles implements LocalFiles {
  constructor(private readonly connection: DatabaseConnection) {}

  async asset(id: AssetId): Promise<Result<Blob, AppError>> {
    try {
      const db = await this.connection.get();
      const record = await db.get('assets', id);
      return record === undefined
        ? err(appError('not-found', 'Asset not found', { id }))
        : ok(record.data);
    } catch (cause) {
      return err(storageError(cause, 'Reading asset'));
    }
  }

  async bundleFile(taskId: TaskId, digest: string, path: string): Promise<Result<Blob, AppError>> {
    try {
      const db = await this.connection.get();
      const record = await db.get('bundles', taskId);
      if (record?.digest !== digest) {
        return err(appError('not-found', 'The bundle was replaced', { taskId, digest }));
      }
      const file = record.files.find((candidate) => candidate.path === path);
      return file === undefined
        ? err(appError('not-found', 'No such file in the bundle', { path }))
        : ok(file.data);
    } catch (cause) {
      return err(storageError(cause, 'Reading bundle file'));
    }
  }
}
