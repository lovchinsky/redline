import { TaskId, err, ok, okVoid, type AppError, type Result } from '@redline/core';
import type { BundleRepository, StoredBundle } from '../../ports/drafts';
import type { DatabaseConnection } from './database';
import { storageError } from './errors';
import type { StoredBundleRecord } from './schema';

const toRecord = ({ taskId, revision, clientVersion, bundle, warnings }: StoredBundle) => ({
  taskId,
  revision,
  clientVersion,
  manifest: bundle.manifest,
  digest: bundle.digest,
  files: [...bundle.files].map(([path, data]) => ({ path, data })),
  warnings,
});

const fromRecord = (record: StoredBundleRecord): StoredBundle => ({
  taskId: TaskId.parse(record.taskId),
  revision: record.revision,
  clientVersion: record.clientVersion,
  bundle: {
    manifest: record.manifest,
    digest: record.digest,
    files: new Map(record.files.map((file) => [file.path, file.data])),
  },
  warnings: record.warnings,
});

/** Keeps the latest frozen bundle of each task. */
export class IdbBundleRepository implements BundleRepository {
  constructor(private readonly connection: DatabaseConnection) {}

  async get(taskId: TaskId): Promise<Result<StoredBundle | null, AppError>> {
    try {
      const db = await this.connection.get();
      const record = await db.get('bundles', taskId);
      return ok(record === undefined ? null : fromRecord(record));
    } catch (cause) {
      return err(storageError(cause, 'Reading bundle'));
    }
  }

  async put(bundle: StoredBundle): Promise<Result<void, AppError>> {
    try {
      const db = await this.connection.get();
      await db.put('bundles', toRecord(bundle));
      return okVoid();
    } catch (cause) {
      return err(storageError(cause, 'Saving bundle'));
    }
  }

  async delete(taskId: TaskId): Promise<Result<void, AppError>> {
    try {
      const db = await this.connection.get();
      await db.delete('bundles', taskId);
      return okVoid();
    } catch (cause) {
      return err(storageError(cause, 'Deleting bundle'));
    }
  }

  async taskIds(): Promise<Result<readonly TaskId[], AppError>> {
    try {
      const db = await this.connection.get();
      return ok((await db.getAllKeys('bundles')).map((key) => TaskId.parse(key)));
    } catch (cause) {
      return err(storageError(cause, 'Listing bundles'));
    }
  }
}
