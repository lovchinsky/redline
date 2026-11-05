import { appError, err, ok, okVoid, type AppError, type Result } from '@redline/core';
import type { CaptureRecord, CaptureRepository } from '../../ports/capture';
import type { DatabaseConnection } from './database';
import { storageError } from './errors';

export class IdbCaptureRepository implements CaptureRepository {
  constructor(private readonly connection: DatabaseConnection) {}

  async put(record: CaptureRecord): Promise<Result<void, AppError>> {
    try {
      const db = await this.connection.get();
      await db.put('captures', record);
      return okVoid();
    } catch (cause) {
      return err(storageError(cause, 'Saving capture'));
    }
  }

  async get(id: string): Promise<Result<CaptureRecord, AppError>> {
    try {
      const db = await this.connection.get();
      const record = await db.get('captures', id);
      return record === undefined
        ? err(appError('not-found', 'Capture not found', { id }))
        : ok(record);
    } catch (cause) {
      return err(storageError(cause, 'Reading capture'));
    }
  }
}
