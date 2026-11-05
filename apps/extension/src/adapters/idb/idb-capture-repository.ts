import {
  appError,
  err,
  ok,
  okVoid,
  type AppError,
  type CaptureId,
  type Result,
} from '@redline/core';
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

  async get(id: CaptureId): Promise<Result<CaptureRecord, AppError>> {
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

  async list(): Promise<Result<readonly CaptureRecord[], AppError>> {
    try {
      const db = await this.connection.get();
      return ok(await db.getAll('captures'));
    } catch (cause) {
      return err(storageError(cause, 'Listing captures'));
    }
  }

  async delete(id: CaptureId): Promise<Result<void, AppError>> {
    try {
      const db = await this.connection.get();
      await db.delete('captures', id);
      return okVoid();
    } catch (cause) {
      return err(storageError(cause, 'Deleting capture'));
    }
  }
}
