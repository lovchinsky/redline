import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { AssetId, type Logger } from '@redline/core';
import { DatabaseConnection, openDatabase } from './database';
import { IdbAssetStore } from './idb-asset-store';

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

const createStore = () => {
  let n = 0;
  const connection = new DatabaseConnection(() =>
    openDatabase({ name: 'assets-test', logger: silentLogger }),
  );
  return new IdbAssetStore(
    connection,
    { next: () => `asset-${String((n += 1))}` },
    { now: () => 1000 },
  );
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('IdbAssetStore', () => {
  it('stores a blob and returns a lightweight reference', async () => {
    const store = createStore();
    const put = await store.put(new Blob(['png-bytes'], { type: 'image/png' }));
    expect(put).toEqual({ ok: true, value: { id: 'asset-1', mediaType: 'image/png', bytes: 9 } });
    if (!put.ok) return;

    const read = await store.get(put.value.id);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.type).toBe('image/png');
      expect(await read.value.text()).toBe('png-bytes');
    }
  });

  it('defaults the media type of untyped blobs', async () => {
    const put = await createStore().put(new Blob(['x']));
    expect(put.ok && put.value.mediaType).toBe('application/octet-stream');
  });

  it('reports a missing asset as not-found', async () => {
    const read = await createStore().get(AssetId.parse('missing'));
    expect(read.ok ? null : read.error.code).toBe('not-found');
  });

  it('releases assets', async () => {
    const store = createStore();
    const put = await store.put(new Blob(['x']));
    if (!put.ok) throw new Error('put failed');
    expect((await store.release(put.value.id)).ok).toBe(true);
    const read = await store.get(put.value.id);
    expect(read.ok ? null : read.error.code).toBe('not-found');
  });
});
