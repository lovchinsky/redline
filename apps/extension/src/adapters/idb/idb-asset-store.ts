import {
  AssetId,
  appError,
  err,
  ok,
  okVoid,
  type AppError,
  type AssetRef,
  type AssetStore,
  type Clock,
  type IdGenerator,
  type Result,
} from '@redline/core';
import type { DatabaseConnection } from './database';
import { storageError } from './errors';

const DEFAULT_MEDIA_TYPE = 'application/octet-stream';

export class IdbAssetStore implements AssetStore {
  constructor(
    private readonly connection: DatabaseConnection,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async put(data: Blob): Promise<Result<AssetRef, AppError>> {
    const ref: AssetRef = {
      id: AssetId.parse(this.ids.next()),
      mediaType: data.type === '' ? DEFAULT_MEDIA_TYPE : data.type,
      bytes: data.size,
    };
    try {
      const db = await this.connection.get();
      await db.put('assets', { ...ref, data, createdAt: this.clock.now() });
      return ok(ref);
    } catch (cause) {
      return err(storageError(cause, 'Saving asset'));
    }
  }

  async get(id: AssetId): Promise<Result<Blob, AppError>> {
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

  async release(id: AssetId): Promise<Result<void, AppError>> {
    try {
      const db = await this.connection.get();
      await db.delete('assets', id);
      return okVoid();
    } catch (cause) {
      return err(storageError(cause, 'Deleting asset'));
    }
  }
}
