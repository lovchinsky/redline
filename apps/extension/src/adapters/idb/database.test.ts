import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { draftSchema, taskSchema, type Logger } from '@redline/core';
import {
  DatabaseConnection,
  MigrationConfigError,
  latestVersionOf,
  openDatabase,
} from './database';
import { migrations, type Migration } from './schema';

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

const migration = (
  version: number,
  migrate: Migration['migrate'] = () => undefined,
): Migration => ({
  version,
  description: `v${String(version)}`,
  migrate,
});

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('latestVersionOf', () => {
  it('returns the last version of a contiguous list', () => {
    expect(latestVersionOf([migration(1), migration(2)])).toBe(2);
  });

  it.each([[[]], [[migration(2)]], [[migration(1), migration(3)]], [[migration(2), migration(1)]]])(
    'rejects an invalid list %#',
    (list) => {
      expect(() => latestVersionOf(list)).toThrow(MigrationConfigError);
    },
  );

  it('accepts the shipped migrations', () => {
    expect(latestVersionOf(migrations)).toBe(migrations.length);
  });
});

describe('openDatabase', () => {
  it('creates the latest schema on a fresh install', async () => {
    const db = await openDatabase({ name: 'fresh', logger: silentLogger });
    expect([...db.objectStoreNames].sort()).toEqual([
      'assets',
      'bundles',
      'captures',
      'drafts',
      'tasks',
      'workspace',
    ]);
    db.close();
  });

  it('applies only migrations newer than the stored version and keeps data', async () => {
    const v1 = migration(1, (db) => {
      db.createObjectStore('assets', { keyPath: 'id' });
    });
    const first = await openDatabase({ name: 'upgrade', migrations: [v1], logger: silentLogger });
    await first.put('assets', {
      id: 'a1',
      mediaType: 'image/png',
      bytes: 1,
      data: new Blob(['x']),
      createdAt: 0,
    });
    first.close();

    const v1Again = vi.fn();
    const v2 = vi.fn<Migration['migrate']>((db) => {
      db.createObjectStore('extra' as 'assets');
    });
    const upgraded = await openDatabase({
      name: 'upgrade',
      migrations: [migration(1, v1Again), migration(2, v2)],
      logger: silentLogger,
    });

    expect(v1Again).not.toHaveBeenCalled();
    expect(v2).toHaveBeenCalledOnce();
    expect(upgraded.version).toBe(2);
    expect(await upgraded.count('assets')).toBe(1);
    upgraded.close();
  });

  it('releases its connection so a newer version can upgrade instead of being blocked', async () => {
    await openDatabase({ name: 'handover', logger: silentLogger });
    // Without the versionchange handler this open would stay blocked forever.
    const blockedFor = (ms: number) =>
      new Promise<never>((_, reject) => {
        setTimeout(() => {
          reject(new Error('blocked'));
        }, ms);
      });
    const newer = await Promise.race([openDB('handover', migrations.length + 1), blockedFor(1000)]);
    expect(newer.version).toBe(migrations.length + 1);
    newer.close();
  });
});

describe('migration to version 4', () => {
  const v3Task = (id: string, state: Record<string, unknown>) => ({
    id,
    title: null,
    state,
    steps: [],
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
  });
  const project = { projectId: 'acme', projectName: 'Acme' };

  it('moves deliveries into one record, keeping the key already sent, and finds lost tasks', async () => {
    const v3 = await openDatabase({
      name: 'v4',
      migrations: migrations.slice(0, 3),
      logger: silentLogger,
    });
    await v3.put('tasks', v3Task('draft', { kind: 'draft' }));
    await v3.put(
      'tasks',
      v3Task('queued', {
        kind: 'queued',
        ...project,
        digest: 'q'.repeat(64),
        queuedAt: 1,
        attempts: 2,
        nextAttemptAt: 3,
        lastError: null,
      }),
    );
    const submitted = {
      kind: 'submitted',
      ...project,
      remoteId: 'r1',
      submittedAt: 5,
      status: { phase: 'working' },
      checkedAt: 6,
      pollAfterSec: 30,
      nextCheckAt: 7,
    };
    await v3.put('tasks', v3Task('submitted', submitted));
    await v3.put('bundles', {
      taskId: 'submitted',
      revision: 1,
      clientVersion: '0.1.0',
      manifest: {} as never,
      digest: 's'.repeat(64),
      files: [],
      warnings: [],
    });
    await v3.put(
      'tasks',
      v3Task('forgotten', {
        ...submitted,
        remoteId: 'r2',
        status: { phase: 'failed', reason: 'The receiver no longer knows this task' },
        nextCheckAt: null,
      }),
    );
    v3.close();

    const db = await openDatabase({
      name: 'v4',
      migrations: migrations.slice(0, 4),
      logger: silentLogger,
    });
    const stateOf = async (id: string) =>
      ((await db.get('tasks', id)) as { state: unknown } | undefined)?.state;

    expect(await stateOf('draft')).toEqual({ kind: 'draft' });
    expect(await stateOf('queued')).toMatchObject({
      kind: 'queued',
      attempts: 2,
      delivery: { id: 'queued', ...project, digest: 'q'.repeat(64) },
    });
    expect(await stateOf('submitted')).toMatchObject({
      kind: 'submitted',
      delivery: { id: 'submitted', digest: 's'.repeat(64) },
      status: { phase: 'working' },
      checkFailures: 0,
      checkError: null,
    });
    expect(await stateOf('forgotten')).toEqual({
      kind: 'lost',
      delivery: { id: 'forgotten', ...project, digest: '' },
      remoteId: 'r2',
      submittedAt: 5,
      lostAt: 6,
    });
    db.close();
  });
});

describe('migration to version 5', () => {
  it('moves drafts to their own store and keeps sent tasks where they are', async () => {
    const v4 = await openDatabase({
      name: 'v5',
      migrations: migrations.slice(0, 4),
      logger: silentLogger,
    });
    const content = { title: null, steps: [], revision: 2, createdAt: 0, updatedAt: 1 };
    await v4.put('tasks', { id: 'draft', ...content, state: { kind: 'draft' } });
    const queued = {
      id: 'sent',
      ...content,
      state: {
        kind: 'queued',
        delivery: { id: 'd1', projectId: 'acme', projectName: 'Acme', digest: 'x' },
        queuedAt: 1,
        attempts: 0,
        nextAttemptAt: 1,
        lastError: null,
      },
    };
    await v4.put('tasks', queued);
    v4.close();

    const db = await openDatabase({ name: 'v5', logger: silentLogger });
    expect(draftSchema.parse(await db.get('drafts', 'draft'))).toEqual({ id: 'draft', ...content });
    expect(await db.get('tasks', 'draft')).toBeUndefined();
    expect(taskSchema.parse(await db.get('tasks', 'sent'))).toEqual(queued);
    expect(await db.get('drafts', 'sent')).toBeUndefined();
    db.close();
  });
});

describe('DatabaseConnection', () => {
  it('opens once and shares the connection', async () => {
    const open = vi.fn(() => openDatabase({ name: 'shared', logger: silentLogger }));
    const connection = new DatabaseConnection(open);
    const [a, b] = await Promise.all([connection.get(), connection.get()]);
    expect(a).toBe(b);
    expect(open).toHaveBeenCalledOnce();
    a.close();
  });

  it('retries after a failed open', async () => {
    const open = vi
      .fn<() => ReturnType<typeof openDatabase>>()
      .mockRejectedValueOnce(new Error('blocked'))
      .mockImplementation(() => openDatabase({ name: 'retry', logger: silentLogger }));
    const connection = new DatabaseConnection(open);
    await expect(connection.get()).rejects.toThrow('blocked');
    const db = await connection.get();
    expect(db.version).toBe(migrations.length);
    db.close();
  });
});
