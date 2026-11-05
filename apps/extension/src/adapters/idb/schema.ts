import type { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import type { BundleManifest } from '@redline/contract';
import type { CaptureRecord } from '../../ports/capture';
import { upgradeTaskRecord } from './task-records-v4';
import { draftOf } from './task-records-v5';

export const DATABASE_NAME = 'redline';

export interface StoredAsset {
  readonly id: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly data: Blob;
  readonly createdAt: number;
}

/** A frozen bundle as stored: the files as blobs, in manifest order. */
export interface StoredBundleRecord {
  readonly taskId: string;
  readonly revision: number;
  readonly clientVersion: string;
  readonly manifest: BundleManifest;
  readonly digest: string;
  readonly files: readonly { readonly path: string; readonly data: Blob }[];
  readonly warnings: readonly string[];
}

/** Keys of the `workspace` store: small pieces of state that are not entities. */
export type WorkspaceKey = 'activeDraft';

/** Shape of the latest database version. Every migration below must lead to it. */
export interface VfDatabaseSchema extends DBSchema {
  assets: { key: string; value: StoredAsset; indexes: { createdAt: number } };
  captures: { key: string; value: CaptureRecord; indexes: { createdAt: number } };
  /** Drafts and sent tasks are stored as plain data and validated with their schema on read. */
  drafts: { key: string; value: unknown; indexes: { updatedAt: number } };
  tasks: { key: string; value: unknown; indexes: { updatedAt: number } };
  workspace: { key: WorkspaceKey; value: unknown };
  bundles: { key: string; value: StoredBundleRecord };
}

export type VfDatabase = IDBPDatabase<VfDatabaseSchema>;

export type UpgradeTransaction = IDBPTransaction<
  VfDatabaseSchema,
  StoreNames<VfDatabaseSchema>[],
  'versionchange'
>;

export interface Migration {
  /** Database version this migration produces. Versions start at 1 and have no gaps. */
  readonly version: number;
  readonly description: string;
  migrate(db: VfDatabase, transaction: UpgradeTransaction): void;
}

/**
 * Append-only. Never edit a released migration: add a new one with the next version.
 */
export const migrations: readonly Migration[] = [
  {
    version: 1,
    description: 'Create the assets store',
    migrate(db) {
      db.createObjectStore('assets', { keyPath: 'id' });
    },
  },
  {
    version: 2,
    description: 'Create the captures store',
    migrate(db) {
      db.createObjectStore('captures', { keyPath: 'id' }).createIndex('createdAt', 'createdAt');
    },
  },
  {
    version: 3,
    description: 'Create drafts: tasks, workspace state, assembled bundles; index assets by age',
    migrate(db, transaction) {
      db.createObjectStore('tasks', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      db.createObjectStore('workspace');
      db.createObjectStore('bundles', { keyPath: 'taskId' });
      transaction.objectStore('assets').createIndex('createdAt', 'createdAt');
    },
  },
  {
    version: 4,
    description: 'Tasks: one delivery record per send, counted status checks, lost tasks',
    migrate(_db, transaction) {
      // Rewrites every task within the upgrade; any failure aborts it, leaving version 3 intact.
      void (async () => {
        const bundles = transaction.objectStore('bundles');
        let cursor = await transaction.objectStore('tasks').openCursor();
        while (cursor !== null) {
          const bundle = await bundles.get(cursor.key);
          const upgraded = upgradeTaskRecord(cursor.value, bundle?.digest ?? null);
          if (upgraded !== cursor.value) await cursor.update(upgraded);
          cursor = await cursor.continue();
        }
      })().catch(() => {
        transaction.abort();
      });
    },
  },
  {
    version: 5,
    description: 'Drafts move to a store of their own; tasks keep only what was sent',
    migrate(db, transaction) {
      db.createObjectStore('drafts', { keyPath: 'id' }).createIndex('updatedAt', 'updatedAt');
      // Moves every draft within the upgrade; any failure aborts it, leaving version 4 intact.
      void (async () => {
        const drafts = transaction.objectStore('drafts');
        let cursor = await transaction.objectStore('tasks').openCursor();
        while (cursor !== null) {
          const draft = draftOf(cursor.value);
          if (draft !== null) {
            await drafts.put(draft);
            await cursor.delete();
          }
          cursor = await cursor.continue();
        }
      })().catch(() => {
        transaction.abort();
      });
    },
  },
];
