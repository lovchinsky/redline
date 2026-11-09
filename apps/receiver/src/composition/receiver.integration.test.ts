import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describeConformance } from '@redline/contract-conformance';
import { parseConfig } from '../adapters/config/config';
import { openDatabase } from '../adapters/postgres/database';
import { PostgresUsers } from '../adapters/postgres/users';
import { freshDatabase } from '../adapters/postgres/testing/database';
import { silentLogger } from '../application/testing/fakes';
import { UserId } from '../domain/ids';
import { assemble } from './receiver';

const CONFIG = `
agent: { kind: scripted, durationSeconds: 0.2, asks: true }
git: { kind: scripted }
models:
  credentials: managed
  # The scripted agent calls no model: the gateway never reads this file.
  operator: { kind: api-key, secretFile: /run/secrets/anthropic-api-key }
projects:
  - id: acme-web
    name: Acme Web
    repository: { host: github, name: acme/web }
`;

describeConformance(
  'the receiver',
  async () => {
    const database = await freshDatabase();
    const blobs = await mkdtemp(path.join(tmpdir(), 'redline-receiver-'));
    const config = parseConfig(CONFIG);
    if (!config.ok) throw new Error(config.errors.join('\n'));
    const settings = {
      databaseUrl: database.url,
      configPath: '(inline)',
      blobsPath: blobs,
      mirrorsPath: path.join(blobs, 'mirrors'),
      host: '127.0.0.1',
      port: 0,
      gatewayPort: 0,
      egressPort: 0,
      vaultSocket: '/nonexistent/vault.sock',
      logLevel: 'silent',
    };
    const receiver = await assemble(settings, config.value, 'all', silentLogger);
    const db = openDatabase(database.url, 1);
    const users = new PostgresUsers(db);
    await users.add({ id: UserId('ann'), name: 'Ann Lee', email: null }, new Date());
    const token = await users.issueToken(UserId('ann'), 'conformance', new Date());
    await db.destroy();
    if (token === null || receiver.api === null) throw new Error('The receiver did not start');
    const url = await receiver.api.listen({ host: '127.0.0.1', port: 0 });
    return {
      url,
      token,
      projectId: 'acme-web',
      stop: async () => {
        await receiver.stop();
        await rm(blobs, { recursive: true, force: true });
        await database.drop();
      },
    };
  },
  { progressTimeoutMs: 20_000 },
);
