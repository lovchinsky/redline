import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig } from '../adapters/config/config';
import { openDatabase } from '../adapters/postgres/database';
import { freshDatabase } from '../adapters/postgres/testing/database';
import { PostgresUsers } from '../adapters/postgres/users';
import { silentLogger } from '../application/testing/fakes';
import { LOCAL_USER, initLocal } from './local';
import type { Settings } from './settings';

let drop: () => Promise<void>;
let dir: string;
let settings: Settings;

beforeAll(async () => {
  const database = await freshDatabase();
  drop = database.drop;
  dir = await mkdtemp(path.join(tmpdir(), 'redline-local-'));
  settings = {
    databaseUrl: database.url,
    configPath: '(inline)',
    blobsPath: path.join(dir, 'blobs'),
    mirrorsPath: path.join(dir, 'mirrors'),
    host: '127.0.0.1',
    port: 8787,
    gatewayPort: 0,
    egressPort: 0,
    vaultSocket: '/nonexistent/vault.sock',
    localPath: path.join(dir, 'local'),
    logLevel: 'silent',
  };
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await drop();
});

describe('initLocal', () => {
  it('readies storage and one user, and shows the same token on every start', async () => {
    const config = parseConfig(`
git: { kind: github, auth: { token: { file: /run/secrets/github-token } } }
models: { credentials: required, acceptRequesterSubscriptions: true }
`);
    if (!config.ok) throw new Error(config.errors.join('\n'));
    const first = await initLocal(settings, config.value, silentLogger);
    expect(await initLocal(settings, config.value, silentLogger)).toBe(first);

    const db = openDatabase(settings.databaseUrl, 1);
    try {
      const users = new PostgresUsers(db);
      expect(await users.authenticate(first)).toMatchObject({ id: 'me' });
      expect(await users.list()).toHaveLength(1);
      // A kept token that no longer opens the receiver is replaced.
      await users.revokeTokens(LOCAL_USER, new Date());
      const second = await initLocal(settings, config.value, silentLogger);
      expect(second).not.toBe(first);
      expect(await users.authenticate(second)).toMatchObject({ id: 'me' });
    } finally {
      await db.destroy();
    }
  });
});
