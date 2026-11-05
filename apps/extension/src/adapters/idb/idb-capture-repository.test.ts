import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Logger } from '@redline/core';
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
  id: 'capture-1',
  createdAt: 1000,
  step: {
    url: 'https://acme.io/pricing',
    title: 'Pricing',
    intent: 'layout',
    comment: 'Equal heights',
    viewport: { width: 1280, height: 800, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
    shapeIds: ['s1'],
  },
  capture: { fragments: [], diagnostics: [] },
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('IdbCaptureRepository', () => {
  it('stores and reads back a capture', async () => {
    const repository = new IdbCaptureRepository(
      new DatabaseConnection(() => openDatabase({ name: 'captures-test', logger: silentLogger })),
    );
    expect((await repository.put(record)).ok).toBe(true);
    expect(await repository.get('capture-1')).toEqual({ ok: true, value: record });
    const missing = await repository.get('nope');
    expect(missing.ok ? null : missing.error.code).toBe('not-found');
  });
});
