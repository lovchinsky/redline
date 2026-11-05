import { ok, type AppError, type Result } from '@redline/core';
import { captureRecordSchema, type CaptureRecord } from '@redline/rpc';
import * as z from 'zod/mini';
import type { JournalStore } from '../../ports/diagnostics';
import { StoredValue, type StorageArea } from './storage-area';

const journalSchema = z.readonly(z.array(captureRecordSchema));

/** The Diagnostics journal in `storage.local`, one list under one key. */
export class StorageJournalStore implements JournalStore {
  private readonly value: StoredValue<typeof journalSchema>;

  constructor(area: StorageArea) {
    this.value = new StoredValue(area, 'diagnostics', journalSchema);
  }

  async read(): Promise<Result<readonly CaptureRecord[], AppError>> {
    const records = await this.value.read();
    return records.ok ? ok(records.value ?? []) : records;
  }

  write(records: readonly CaptureRecord[]): Promise<Result<void, AppError>> {
    return this.value.write(records);
  }
}
