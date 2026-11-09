import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const receiverDir = path.resolve(import.meta.dirname, '../../receiver');
const tsx = path.join(receiverDir, 'node_modules/.bin/tsx');
const main = path.join(receiverDir, 'src/entrypoints/main.ts');

/** A receiver that answers within seconds: a scripted agent, and polling allowed every second. */
const configFor = (credentials: ModelCredentials) => `
agent: { kind: scripted, durationSeconds: 1, asks: true }
git: { kind: scripted, resultBaseUrl: 'https://git.example/acme/web/pull/' }
polling: { queuedSeconds: 1, workingSeconds: 1, waitingSeconds: 1, finishedSeconds: 1 }
models:
  credentials: ${credentials}
  # The scripted agent calls no model: the gateway never reads this file.
  ${credentials === 'required' ? '' : 'operator: { kind: api-key, secretFile: /run/secrets/anthropic-api-key }'}
projects:
  - id: acme-web
    name: Acme Web
    repository: { host: github, name: acme/web }
`;

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (address !== null && typeof address === 'object') resolve(address.port);
        else reject(new Error('No port'));
      });
    });
  });

/** Whose model credential the receiver runs tasks with (`models.credentials`). */
export type ModelCredentials = 'managed' | 'required' | 'optional';

export interface RunningReceiver {
  readonly url: string;
  readonly token: string;
  stop(): Promise<void>;
}

/**
 * The real receiver, started the way an operator starts it: its command line, its own
 * database (on the Postgres server `REDLINE_TEST_DATABASE_URL` names), a user and a token.
 */
export const startReceiver = async (
  credentials: ModelCredentials = 'managed',
): Promise<RunningReceiver> => {
  const server = process.env['REDLINE_TEST_DATABASE_URL'];
  if (server === undefined || server === '') {
    throw new Error(
      'Set REDLINE_TEST_DATABASE_URL to a Postgres server to test against the real receiver',
    );
  }
  const database = `redline_e2e_${randomBytes(6).toString('hex')}`;
  const databaseUrl = new URL(server);
  const admin = (sql: string) => run('psql', [server, '-qc', sql]);
  await admin(`create database ${database}`);
  databaseUrl.pathname = `/${database}`;

  const dir = await mkdtemp(path.join(tmpdir(), 'redline-e2e-receiver-'));
  await writeFile(path.join(dir, 'receiver.yaml'), configFor(credentials));
  const port = await freePort();
  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl.toString(),
    REDLINE_CONFIG: path.join(dir, 'receiver.yaml'),
    REDLINE_BLOBS: path.join(dir, 'blobs'),
    REDLINE_HOST: '127.0.0.1',
    REDLINE_PORT: String(port),
    REDLINE_LOG_LEVEL: 'warn',
  };
  const cli = (...args: string[]) => run(tsx, [main, ...args], { env, cwd: receiverDir });
  await cli('users', 'add', 'ann', '--name', 'Ann Lee');
  const token = (await cli('users', 'token', 'ann')).stdout.trim();

  const child: ChildProcess = spawn(tsx, [main, 'serve', 'all'], {
    env,
    cwd: receiverDir,
    stdio: 'inherit',
  });
  const url = `http://127.0.0.1:${String(port)}`;
  const deadline = Date.now() + 30_000;
  for (;;) {
    const healthy = await fetch(`${url}/healthz`).then(
      (response) => response.ok,
      () => false,
    );
    if (healthy) break;
    if (Date.now() > deadline || child.exitCode !== null)
      throw new Error('The receiver did not start');
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  return {
    url,
    token,
    stop: async () => {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
      await rm(dir, { recursive: true, force: true });
      await admin(`drop database if exists ${database} with (force)`);
    },
  };
};
