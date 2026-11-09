import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { project, silentLogger } from '../application/testing/fakes';
import { never, system } from '../application/testing/system';
import { FsBlobStore } from '../adapters/blobs/fs-blob-store';
import { parseConfig } from '../adapters/config/config';
import { gitleaksStandIn } from '../adapters/git/testing/gitleaks-stand-in';
import { httpGitServer } from '../adapters/git/testing/http-git-server';
import { BlobDigest } from '../domain/ids';
import type { PublishingProfile } from '../ports/access';
import { gitOf } from './receiver';
import type { Settings } from './settings';

/**
 * Publishing as a deployment does it with `git: github`: the receiver's mirrors over git's
 * smart HTTP with the bot's token, GitHub's pull request API, the secret scanner, and the use
 * case driving them. The git host and its API are stand-ins on this machine.
 */

const run = promisify(execFile);
const IDENTITY = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};
const git = async (cwd: string, ...args: string[]) =>
  (await run('git', args, { cwd, env: { ...process.env, ...IDENTITY } })).stdout.trim();

const TOKEN = 'github_pat_bot';
const authorization = `Basic ${Buffer.from(`x-access-token:${TOKEN}`).toString('base64')}`;

interface Pull {
  number: number;
  head: string;
  base: string;
  title: string;
  body: string;
  draft: boolean;
  state: string;
  labels: string[];
}

/** GitHub's pull request API for acme/web, in memory; `failOpens` answers the next opens with 502. */
const fakeApi = async () => {
  const pulls: Pull[] = [];
  const state = { failOpens: 0 };
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      const send = (status: number, body: unknown) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      };
      if (request.headers.authorization !== `Bearer ${TOKEN}`) {
        send(401, { message: 'Bad credentials' });
        return;
      }
      const url = new URL(request.url ?? '/', 'http://api');
      const body =
        chunks.length === 0
          ? {}
          : (JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>);
      const ref = (pull: Pull) => ({
        number: pull.number,
        html_url: `https://github.test/acme/web/pull/${String(pull.number)}`,
      });
      if (request.method === 'GET' && url.pathname === '/repos/acme/web/pulls') {
        const head = url.searchParams.get('head');
        send(200, pulls.filter((pull) => pull.state === 'open' && pull.head === head).map(ref));
      } else if (request.method === 'POST' && url.pathname === '/repos/acme/web/pulls') {
        if (state.failOpens > 0) {
          state.failOpens -= 1;
          send(502, { message: 'Server Error' });
          return;
        }
        const pull: Pull = {
          number: pulls.length + 1,
          head: String(body['head']),
          base: String(body['base']),
          title: String(body['title']),
          body: String(body['body']),
          draft: body['draft'] === true,
          state: 'open',
          labels: [],
        };
        pulls.push(pull);
        send(201, ref(pull));
      } else if (
        request.method === 'POST' &&
        /^\/repos\/acme\/web\/issues\/\d+\/labels$/.test(url.pathname)
      ) {
        const pull = pulls[Number(url.pathname.split('/')[5]) - 1];
        pull?.labels.push(...(body['labels'] as string[]));
        send(200, []);
      } else send(404, { message: 'Not Found' });
    });
  });
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve();
    });
  });
  return {
    url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    pulls,
    state,
    close: () => server.close(),
  };
};

let dir: string;
let served: string;
let gitServer: Awaited<ReturnType<typeof httpGitServer>>;
let api: Awaited<ReturnType<typeof fakeApi>>;
let blobs: FsBlobStore;
let base: string;
let standIn: Awaited<ReturnType<typeof gitleaksStandIn>> | null = null;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'redline-publishing-'));
  served = path.join(dir, 'served');
  const seed = path.join(dir, 'seed');
  await mkdir(seed);
  await git(seed, 'init', '-q', '-b', 'main');
  await writeFile(path.join(seed, 'Card.css'), '.card { }\n');
  await git(seed, 'add', '.');
  await git(seed, 'commit', '-qm', 'base');
  base = await git(seed, 'rev-parse', 'HEAD');
  await mkdir(path.join(served, 'acme'), { recursive: true });
  await mkdir(path.join(served, 'redline-bot'), { recursive: true });
  await run('git', ['clone', '-q', '--bare', seed, path.join(served, 'acme/web.git')]);
  await run('git', ['clone', '-q', '--bare', seed, path.join(served, 'redline-bot/web.git')]);
  gitServer = await httpGitServer(served, authorization);
  api = await fakeApi();
  blobs = new FsBlobStore(path.join(dir, 'blobs'));
});

afterEach(async () => {
  gitServer.close();
  api.close();
  await rm(dir, { recursive: true, force: true });
});

/** The change agent-host leaves for `content` in Card.css, stored as the runner stores it. */
const agentChange = async (content: string) => {
  const work = path.join(dir, `work-${String(Math.random()).slice(2)}`);
  await run('git', ['clone', '-q', path.join(served, 'acme/web.git'), work]);
  await writeFile(path.join(work, 'Card.css'), content);
  await git(work, 'add', '-A');
  const head = await git(
    work,
    'commit-tree',
    await git(work, 'write-tree'),
    '-p',
    base,
    '-m',
    'change',
  );
  await git(work, 'update-ref', 'refs/redline/change', head);
  await git(
    work,
    'bundle',
    'create',
    path.join(work, 'change.bundle'),
    'refs/redline/change',
    `^${base}`,
  );
  const writer = blobs.writer();
  await writer.write(new Uint8Array(await readFile(path.join(work, 'change.bundle'))));
  return { blob: BlobDigest((await writer.commit()).digest), head };
};

const deployment = async (publishing: PublishingProfile) => {
  await writeFile(path.join(dir, 'token'), `${TOKEN}\n`);
  const parsed = parseConfig(`
agent: { kind: scripted }
git:
  kind: github
  auth: { token: { file: ${path.join(dir, 'token')} } }
  fork: { owner: redline-bot }
  commitAs: { name: 'redline[bot]', email: 'redline[bot]@users.noreply.github.com' }
  gitleaks: ${(standIn = await gitleaksStandIn(dir)).command}
models: { credentials: required }
projects:
  - { id: acme, name: Acme Web, repository: { host: github, name: acme/web } }
`);
  if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
  const git = parsed.value.git;
  if (git.kind !== 'github') throw new Error('Not GitHub');
  const config = { ...parsed.value, git: { ...git, api: api.url, web: gitServer.url } };
  const parts = await gitOf(
    { mirrorsPath: path.join(dir, 'mirrors') } as Settings,
    config,
    blobs,
    silentLogger,
  );
  const app = system(undefined, parts);
  app.catalog.projects = [project({ publishing })];
  return app;
};

const publishing = async (publishingProfile: PublishingProfile, content: string) => {
  const app = await deployment(publishingProfile);
  const task = await app.submit();
  app.runner.outcomes.push({
    kind: 'change',
    change: await agentChange(content),
    report: {
      summary: 'Cards stretch to the tallest',
      changes: [],
      verification: '',
      assumptions: [],
    },
  });
  await app.supervise.handle(task.id, never);
  expect(app.store.task(task.id).state.kind).toBe('publishing');
  return { app, task };
};

describe('publishing to GitHub', () => {
  it('pushes the task’s commit to the bot’s fork and opens the pull request from it', async () => {
    const { app, task } = await publishing(
      { target: 'fork', draft: true },
      '.card { align-items: stretch; }\n',
    );
    await app.publish.handle(task.id);

    const branch = `redline/${task.id}`;
    const sha = await git(path.join(served, 'redline-bot/web.git'), 'rev-parse', branch);
    expect(await git(path.join(served, 'redline-bot/web.git'), 'rev-parse', `${sha}^`)).toBe(base);
    expect(
      await git(path.join(served, 'redline-bot/web.git'), 'log', '-1', '--format=%an <%ae>', sha),
    ).toBe('redline[bot] <redline[bot]@users.noreply.github.com>');
    // Nothing went to the repository itself.
    await expect(git(path.join(served, 'acme/web.git'), 'rev-parse', branch)).rejects.toThrow();
    expect(api.pulls).toMatchObject([
      { number: 1, head: `redline-bot:${branch}`, base: 'main', draft: true, labels: ['redline'] },
    ]);
    expect(app.store.task(task.id).state).toEqual({
      kind: 'published',
      changeRequest: { id: '1', url: 'https://github.test/acme/web/pull/1' },
    });
  });

  it('pushes to the repository itself for a branch target', async () => {
    const { app, task } = await publishing(
      { target: 'branch', draft: false },
      '.card { flex: 1; }\n',
    );
    await app.publish.handle(task.id);
    expect(await git(path.join(served, 'acme/web.git'), 'rev-parse', `redline/${task.id}`)).toMatch(
      /^[0-9a-f]{40}$/,
    );
    expect(api.pulls).toMatchObject([{ head: `acme:redline/${task.id}`, draft: false }]);
  });

  it('after a failed attempt, publishes the same commit and opens one pull request', async () => {
    const { app, task } = await publishing(
      { target: 'fork', draft: true },
      '.card { align-items: stretch; }\n',
    );
    api.state.failOpens = 1;
    await app.publish.handle(task.id);
    expect(app.store.task(task.id)).toMatchObject({
      state: { kind: 'publishing' },
      publishAttempts: 1,
    });
    const pushed = await git(
      path.join(served, 'redline-bot/web.git'),
      'rev-parse',
      `redline/${task.id}`,
    );

    await app.publish.handle(task.id);
    await app.publish.handle(task.id);
    expect(api.pulls).toHaveLength(1);
    expect(
      await git(path.join(served, 'redline-bot/web.git'), 'rev-parse', `redline/${task.id}`),
    ).toBe(pushed);
    expect(app.store.task(task.id).state.kind).toBe('published');
  });

  it('pushes nothing with a secret in it', async () => {
    const { app, task } = await publishing(
      { target: 'fork', draft: true },
      'const key = "AKIAIOSFODNN7EXAMPLE";\n',
    );
    await standIn?.report([{ File: 'src/key.ts', StartLine: 1, RuleID: 'aws-access-token' }]);
    await app.publish.handle(task.id);
    expect(app.store.task(task.id).state).toMatchObject({
      kind: 'failed',
      failure: { code: 'policy-rejected' },
    });
    await expect(
      git(path.join(served, 'redline-bot/web.git'), 'rev-parse', `redline/${task.id}`),
    ).rejects.toThrow();
    expect(api.pulls).toHaveLength(0);
  });
});
