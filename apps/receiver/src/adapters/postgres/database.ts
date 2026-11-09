import { Kysely, PostgresDialect } from 'kysely';
import { Migrator } from 'kysely/migration';
import pg from 'pg';
import { migrations, type Database } from './schema';

export const openDatabase = (connectionString: string, maxConnections = 10): Kysely<Database> =>
  new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max: maxConnections }) }),
  });

/** Brings the schema up to date; returns the migrations it ran. */
export const migrate = async (db: Kysely<Database>): Promise<readonly string[]> => {
  const migrator = new Migrator({
    db,
    provider: { getMigrations: () => Promise.resolve(migrations) },
  });
  const { error, results } = await migrator.migrateToLatest();
  if (error !== undefined) {
    throw error instanceof Error ? error : new Error('The migration failed', { cause: error });
  }
  return (results ?? [])
    .filter((result) => result.status === 'Success')
    .map((result) => result.migrationName);
};
