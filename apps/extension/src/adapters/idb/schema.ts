import type { DBSchema, IDBPDatabase, IDBPTransaction, StoreNames } from 'idb';
import type { CaptureRecord } from '../../ports/capture';

export const DATABASE_NAME = 'redline';

export interface StoredAsset {
  readonly id: string;
  readonly mediaType: string;
  readonly bytes: number;
  readonly data: Blob;
  readonly createdAt: number;
}

/** Shape of the latest database version. Every migration below must lead to it. */
export interface VfDatabaseSchema extends DBSchema {
  assets: { key: string; value: StoredAsset };
  captures: { key: string; value: CaptureRecord; indexes: { createdAt: number } };
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
];
