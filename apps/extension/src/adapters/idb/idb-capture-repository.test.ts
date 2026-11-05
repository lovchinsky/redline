import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { CaptureId, type Logger } from '@redline/core';
import type { CaptureRecord } from '../../ports/capture';
import { DatabaseConnection, openDatabase } from './database';
import { IdbCaptureRepository } from './idb-capture-repository';

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

const record: CaptureRecord = {
  id: CaptureId.parse('capture-1'),
  createdAt: 1000,
  capture: { fragments: [], diagnostics: [] },
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('IdbCaptureRepository', () => {
  it('stores, lists, reads back and deletes a capture', async () => {
    const repository = new IdbCaptureRepository(
      new DatabaseConnection(() => openDatabase({ name: 'captures-test', logger: silentLogger })),
    );
    expect((await repository.put(record)).ok).toBe(true);
    expect(await repository.get(record.id)).toEqual({ ok: true, value: record });
    expect(await repository.list()).toEqual({ ok: true, value: [record] });

    expect((await repository.delete(record.id)).ok).toBe(true);
    const missing = await repository.get(record.id);
    expect(missing.ok ? null : missing.error.code).toBe('not-found');
  });
});
