import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '@redline/core';
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
    expect([...db.objectStoreNames]).toEqual(['assets', 'captures']);
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
