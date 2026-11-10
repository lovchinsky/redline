import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseConfig, type ReceiverConfig } from '../adapters/config/config';
import { openDatabase } from '../adapters/postgres/database';
import { freshDatabase } from '../adapters/postgres/testing/database';
import { PostgresUsers } from '../adapters/postgres/users';
import { silentLogger } from '../application/testing/fakes';
import { LOCAL_USER, initLocal } from './local';
import type { Settings } from './settings';

let drop: () => Promise<void>;
let dir: string;
let settings: Settings;
/** GitHub's API as far as the local setup asks it: whose the token is. */
let github: Server;
let githubUrl: string;
let tokenOwner: { status: number; body: unknown };

/** A local configuration whose GitHub is the one above, which speaks plain HTTP. */
const configWith = (token: string): ReceiverConfig => {
  const config = parseConfig(`
git: { kind: github, auth: { token: { file: ${path.join(dir, token)} } } }
models: { credentials: required, acceptRequesterSubscriptions: true }
`);
  if (!config.ok) throw new Error(config.errors.join('\n'));
  const git = config.value.git;
  if (git.kind !== 'github') throw new Error('Not GitHub');
  return { ...config.value, git: { ...git, api: githubUrl } };
};

beforeAll(async () => {
  const database = await freshDatabase();
  drop = database.drop;
  dir = await mkdtemp(path.join(tmpdir(), 'redline-local-'));
  await writeFile(path.join(dir, 'github-token'), 'github_pat_ann\n');
  github = createServer((request, response) => {
    const known =
      request.url === '/user' && request.headers.authorization === 'Bearer github_pat_ann';
    const answer = known ? tokenOwner : { status: 401, body: { message: 'Bad credentials' } };
    response.writeHead(answer.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(answer.body));
  });
  await new Promise<void>((resolve) => github.listen(0, '127.0.0.1', resolve));
  const address = github.address();
  if (address === null || typeof address === 'string') throw new Error('No address');
  githubUrl = `http://127.0.0.1:${String(address.port)}`;
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
  await new Promise((resolve) => github.close(resolve));
  await rm(dir, { recursive: true, force: true });
  await drop();
});

describe('initLocal', () => {
  it('readies storage and one user, and shows the same token on every start', async () => {
    tokenOwner = { status: 200, body: { id: 7, login: 'ann-lee', name: 'Ann Lee' } };
    const config = configWith('github-token');
    const first = await initLocal(settings, config, silentLogger);
    expect(await initLocal(settings, config, silentLogger)).toBe(first);

    const db = openDatabase(settings.databaseUrl, 1);
    try {
      const users = new PostgresUsers(db);
      // The user is the token's owner, by the address GitHub links their commits with.
      expect(await users.authenticate(first)).toEqual({
        id: 'me',
        name: 'Ann Lee',
        email: '7+ann-lee@users.noreply.github.com',
      });
      expect(await users.list()).toHaveLength(1);
      // A kept token that no longer opens the receiver is replaced.
      await users.revokeTokens(LOCAL_USER, new Date());
      const second = await initLocal(settings, config, silentLogger);
      expect(second).not.toBe(first);
      expect(await users.authenticate(second)).toMatchObject({ id: 'me' });
    } finally {
      await db.destroy();
    }
  });

  it('names the user anew as the token’s owner is named, and keeps the name GitHub cannot give', async () => {
    tokenOwner = { status: 200, body: { id: 7, login: 'ann-lee', name: null } };
    await initLocal(settings, configWith('github-token'), silentLogger);
    await writeFile(path.join(dir, 'refused-token'), 'github_pat_unknown\n');
    await initLocal(settings, configWith('refused-token'), silentLogger);

    const db = openDatabase(settings.databaseUrl, 1);
    try {
      expect(await new PostgresUsers(db).get(LOCAL_USER)).toEqual({
        id: 'me',
        name: 'ann-lee',
        email: '7+ann-lee@users.noreply.github.com',
      });
    } finally {
      await db.destroy();
    }
  });
});
