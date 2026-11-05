import type { AppError, Result } from '@redline/core';
import * as z from 'zod/mini';
import type { ReceiverSettings, SettingsStore } from '../../ports/delivery';
import { StoredValue, type StorageArea } from './storage-area';

const receiverSchema = z.object({
  baseUrl: z.url(),
  token: z.nullable(z.string()),
});

/** Receiver settings in `storage.local`: never synced, the token stays on this device. */
export class StorageSettingsStore implements SettingsStore {
  private readonly value: StoredValue<typeof receiverSchema>;

  constructor(area: StorageArea) {
    this.value = new StoredValue(area, 'receiver', receiverSchema);
  }

  receiver(): Promise<Result<ReceiverSettings | null, AppError>> {
    return this.value.read();
  }

  setReceiver(settings: ReceiverSettings | null): Promise<Result<void, AppError>> {
    return this.value.write(settings);
  }
}
