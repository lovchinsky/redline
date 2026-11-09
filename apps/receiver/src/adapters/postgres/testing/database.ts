import { randomBytes } from 'node:crypto';
import pg from 'pg';

/**
 * A database of its own for one test file, on the server `REDLINE_TEST_DATABASE_URL` names.
 * Integration tests need a real Postgres; without one they fail rather than pass vacuously.
 */
export const freshDatabase = async (): Promise<{
  readonly url: string;
  readonly drop: () => Promise<void>;
}> => {
  const server = process.env.REDLINE_TEST_DATABASE_URL;
  if (server === undefined || server === '') {
    throw new Error('Set REDLINE_TEST_DATABASE_URL to a Postgres server for integration tests');
  }
  const name = `redline_test_${randomBytes(6).toString('hex')}`;
  const admin = new pg.Client({ connectionString: server });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = new URL(server);
  url.pathname = `/${name}`;
  return {
    url: url.toString(),
    drop: async () => {
      const client = new pg.Client({ connectionString: server });
      await client.connect();
      await client.query(`drop database if exists ${name} with (force)`);
      await client.end();
    },
  };
};
