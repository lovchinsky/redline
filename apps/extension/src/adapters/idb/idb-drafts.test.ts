import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { TaskId, createDraft, type Clock, type Logger, type Result } from '@redline/core';
import { DatabaseConnection, openDatabase } from './database';
import { IdbActiveDraftStore } from './idb-active-draft-store';
import { IdbAssetStore } from './idb-asset-store';
import { IdbBundleRepository } from './idb-bundle-repository';
import { IdbLocalFiles } from './idb-local-files';
import { IdbTaskRepository } from './idb-task-repository';

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

const value = <T>(result: Result<T, unknown>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};

let connection: DatabaseConnection;
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  connection = new DatabaseConnection(() =>
    openDatabase({ name: 'drafts-test', logger: silentLogger }),
  );
});

const taskId = TaskId.parse('task-1');

describe('IdbTaskRepository', () => {
  const logged: unknown[] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (message, context) => logged.push({ message, context }),
    child: () => logger,
  };

  it('round-trips tasks through the domain schema', async () => {
    const tasks = new IdbTaskRepository(connection, logger);
    const task = createDraft(taskId, 5);
    value(await tasks.save(task));
    expect(value(await tasks.get(taskId))).toEqual(task);
    expect(value(await tasks.list())).toEqual([task]);
    value(await tasks.delete(taskId));
    expect(await tasks.get(taskId)).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it('reports a corrupted record instead of trusting it', async () => {
    const db = await connection.get();
    await db.put('tasks', { id: 'task-1', steps: 'not an array' });
    const read = await new IdbTaskRepository(connection, logger).get(taskId);
    expect(read).toMatchObject({ ok: false, error: { code: 'storage' } });
  });

  it('lists the readable tasks past a corrupted one, reporting it once', async () => {
    const tasks = new IdbTaskRepository(connection, logger);
    const good = createDraft(TaskId.parse('task-2'), 5);
    value(await tasks.save(good));
    const db = await connection.get();
    await db.put('tasks', { id: 'task-1', steps: 'not an array' });
    logged.length = 0;

    expect(value(await tasks.list())).toEqual([good]);
    expect(value(await tasks.list())).toEqual([good]);
    expect(logged).toHaveLength(1);
  });
});

describe('IdbActiveDraftStore', () => {
  it('has no active draft until one is set, and can clear it', async () => {
    const store = new IdbActiveDraftStore(connection);
    expect(value(await store.get())).toBeNull();
    value(await store.set(taskId));
    expect(value(await store.get())).toBe(taskId);
    value(await store.set(null));
    expect(value(await store.get())).toBeNull();
  });
});

describe('IdbBundleRepository and IdbLocalFiles', () => {
  const stored = {
    taskId,
    revision: 3,
    clientVersion: '0.1.0',
    warnings: [],
    bundle: {
      manifest: {} as never,
      digest: 'a'.repeat(64),
      files: new Map([['context.md', new Blob(['# Redline task'])]]),
    },
  };

  it('keeps one bundle per task and serves its files to pages by digest', async () => {
    const bundles = new IdbBundleRepository(connection);
    expect(value(await bundles.get(taskId))).toBeNull();
    value(await bundles.put(stored));
    const read = value(await bundles.get(taskId));
    expect(read?.revision).toBe(3);
    expect([...(read?.bundle.files.keys() ?? [])]).toEqual(['context.md']);

    const files = new IdbLocalFiles(connection);
    const context = value(await files.bundleFile(taskId, stored.bundle.digest, 'context.md'));
    expect(await context.text()).toBe('# Redline task');
    expect(await files.bundleFile(taskId, 'b'.repeat(64), 'context.md')).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
    expect(await files.bundleFile(taskId, stored.bundle.digest, 'nope.md')).toMatchObject({
      ok: false,
    });
  });
});

describe('IdbAssetStore as an inventory', () => {
  it('lists only assets created before a time', async () => {
    let now = 100;
    const clock: Clock = { now: () => now };
    let n = 0;
    const assets = new IdbAssetStore(connection, { next: () => `asset-${String(++n)}` }, clock);
    const old = value(await assets.put(new Blob(['a'])));
    now = 200;
    value(await assets.put(new Blob(['b'])));
    expect(value(await assets.idsCreatedBefore(200))).toEqual([old.id]);
    expect(value(await new IdbLocalFiles(connection).asset(old.id)).size).toBe(1);
  });
});
