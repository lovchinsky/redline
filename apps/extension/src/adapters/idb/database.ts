import { openDB } from 'idb';
import type { Logger } from '@redline/core';
import {
  DATABASE_NAME,
  migrations as defaultMigrations,
  type Migration,
  type VfDatabase,
  type VfDatabaseSchema,
} from './schema';

export class MigrationConfigError extends Error {
  override readonly name = 'MigrationConfigError';
}

/** Throws on a programming error in the migration list: it must be 1..N without gaps. */
export const latestVersionOf = (migrations: readonly Migration[]): number => {
  migrations.forEach((migration, index) => {
    if (migration.version !== index + 1) {
      throw new MigrationConfigError(
        `Migration #${String(index)} has version ${String(migration.version)}, expected ${String(index + 1)}`,
      );
    }
  });
  const latest = migrations.at(-1);
  if (latest === undefined) throw new MigrationConfigError('At least one migration is required');
  return latest.version;
};

export interface DatabaseOptions {
  readonly name?: string;
  readonly migrations?: readonly Migration[];
  readonly logger: Logger;
}

export const openDatabase = (options: DatabaseOptions): Promise<VfDatabase> => {
  const migrations = options.migrations ?? defaultMigrations;
  const latest = latestVersionOf(migrations);
  const { logger } = options;

  return openDB<VfDatabaseSchema>(options.name ?? DATABASE_NAME, latest, {
    upgrade(db, oldVersion, _newVersion, transaction) {
      for (const migration of migrations) {
        if (migration.version <= oldVersion) continue;
        logger.info('Applying database migration', {
          version: migration.version,
          description: migration.description,
        });
        migration.migrate(db, transaction, logger);
      }
    },
  }).then((db) => {
    // A newer version is waiting (e.g. the extension was updated): release our connection.
    db.addEventListener('versionchange', () => {
      logger.warn('Closing database connection for a newer version');
      db.close();
    });
    return db;
  });
};

/**
 * Lazily opens one shared connection. A failed open is not cached, so the next caller retries.
 */
export class DatabaseConnection {
  private pending: Promise<VfDatabase> | undefined;

  constructor(private readonly open: () => Promise<VfDatabase>) {}

  get(): Promise<VfDatabase> {
    this.pending ??= this.open().then(
      (db) => {
        db.addEventListener('close', () => {
          this.pending = undefined;
        });
        return db;
      },
      (cause: unknown) => {
        this.pending = undefined;
        throw cause;
      },
    );
    return this.pending;
  }
}
