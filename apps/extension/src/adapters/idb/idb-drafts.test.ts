import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  DeliveryId,
  ProjectId,
  TaskId,
  createDraft,
  type Clock,
  type Logger,
  type Result,
  type Task,
} from '@redline/core';
import { DatabaseConnection, openDatabase } from './database';
import { IdbActiveDraftStore } from './idb-active-draft-store';
import { IdbAssetStore } from './idb-asset-store';
import { IdbBundleRepository } from './idb-bundle-repository';
import { IdbLocalFiles } from './idb-local-files';
import { IdbDraftRepository, IdbTaskRepository, IdbWorkspaceStore } from './idb-workspace';

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

describe('the workspace in IndexedDB', () => {
  const logged: unknown[] = [];
  const logger: Logger = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: (message, context) => logged.push({ message, context }),
    child: () => logger,
  };
  const draft = createDraft(taskId, 5);
  const sent: Task = {
    ...draft,
    state: {
      kind: 'queued',
      delivery: {
        id: DeliveryId.parse('d1'),
        projectId: ProjectId.parse('acme'),
        projectName: 'Acme',
        digest: 'x',
      },
      queuedAt: 6,
      attempts: 0,
      nextAttemptAt: 6,
      lastError: null,
    },
  };

  it('writes a unit of work all together and reads each kind back through its schema', async () => {
    const store = new IdbWorkspaceStore(connection);
    const drafts = new IdbDraftRepository(connection, logger);
    const tasks = new IdbTaskRepository(connection, logger);
    const active = new IdbActiveDraftStore(connection);

    value(
      await store.apply([
        { kind: 'draft', id: taskId, value: draft },
        { kind: 'active', id: taskId },
      ]),
    );
    expect(value(await drafts.list())).toEqual([draft]);
    expect(value(await active.get())).toBe(taskId);

    // Sending: the draft becomes a task, and is no longer the active one.
    value(
      await store.apply([
        { kind: 'draft', id: taskId, value: null },
        { kind: 'task', id: taskId, value: sent },
        { kind: 'active', id: null },
      ]),
    );
    expect(await drafts.get(taskId)).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(value(await tasks.get(taskId))).toEqual(sent);
    expect(value(await active.get())).toBeNull();
  });

  it('writes nothing when one write of a unit of work fails', async () => {
    const store = new IdbWorkspaceStore(connection);
    // A function cannot be stored: IndexedDB refuses the write.
    const unstorable = { ...sent, title: (() => 'x') as unknown as string };
    const result = await store.apply([
      { kind: 'draft', id: taskId, value: null },
      { kind: 'task', id: taskId, value: unstorable },
    ]);
    expect(result).toMatchObject({ ok: false, error: { code: 'storage' } });
    expect(value(await new IdbTaskRepository(connection, logger).list())).toEqual([]);
  });

  it('reports a corrupted record instead of trusting it, and lists past it once', async () => {
    const store = new IdbWorkspaceStore(connection);
    const other = createDraft(TaskId.parse('task-2'), 5);
    value(await store.apply([{ kind: 'draft', id: other.id, value: other }]));
    const db = await connection.get();
    await db.put('drafts', { id: 'task-1', steps: 'not an array' });
    const drafts = new IdbDraftRepository(connection, logger);
    logged.length = 0;

    expect(await drafts.get(taskId)).toMatchObject({ ok: false, error: { code: 'storage' } });
    expect(value(await drafts.list())).toEqual([other]);
    expect(value(await drafts.list())).toEqual([other]);
    expect(logged).toHaveLength(1);
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
