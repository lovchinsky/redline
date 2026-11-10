import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RepositoryRef } from '../../ports/access';
import { FsBlobStore } from '../blobs/fs-blob-store';
import { GitMirrors } from './git-mirrors';
import type { GitRemote } from '../../ports/source';
import { LocalRemotes } from './remotes';
import { NO_SECRET_SCAN, type SecretFinder } from './secrets';
import { httpGitServer } from './testing/http-git-server';

const run = promisify(execFile);
const IDENTITY = {
  GIT_AUTHOR_NAME: 't',
  GIT_AUTHOR_EMAIL: 't@t',
  GIT_COMMITTER_NAME: 't',
  GIT_COMMITTER_EMAIL: 't@t',
};
const git = async (cwd: string, ...args: string[]) =>
  (await run('git', args, { cwd, env: { ...process.env, ...IDENTITY } })).stdout.trim();

let dir: string;
let origin: string;
let mirrors: GitMirrors;
let blobs: FsBlobStore;
const repository: RepositoryRef = { host: 'local', name: 'origin.git', baseBranch: 'main' };
/** Who a task's commit is by: its requester. */
const author = { name: 'Ann Lee', email: 'ann@example.com' };

const reachable = (remote: GitRemote) => Promise.resolve({ ok: true as const, value: remote });

/** The change agent-host would leave: one commit on the base, as a bundle at its ref. */
const agentChange = async (base: string, edit: (work: string) => Promise<void>) => {
  const work = path.join(dir, `work-${String(Math.random()).slice(2)}`);
  await run('git', ['clone', '-q', origin, work]);
  await git(work, 'checkout', '-q', base);
  await edit(work);
  await git(work, 'add', '-A');
  const tree = await git(work, 'write-tree');
  const head = await git(work, 'commit-tree', tree, '-p', base, '-m', 'change');
  await git(work, 'update-ref', 'refs/redline/change', head);
  const bundle = path.join(work, 'change.bundle');
  await git(work, 'bundle', 'create', bundle, 'refs/redline/change', `^${base}`);
  const writer = blobs.writer();
  await writer.write(
    new Uint8Array(await import('node:fs/promises').then((fs) => fs.readFile(bundle))),
  );
  const { digest } = await writer.commit();
  return { blob: digest, head };
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'redline-mirrors-'));
  origin = path.join(dir, 'origin.git');
  const seed = path.join(dir, 'seed');
  await mkdir(seed);
  await git(seed, 'init', '-q', '-b', 'main');
  await writeFile(path.join(seed, 'Card.css'), '.card { }\n');
  await writeFile(
    path.join(seed, 'package.json'),
    JSON.stringify({ scripts: { build: 'vite build' } }),
  );
  await mkdir(path.join(seed, '.redline'));
  await writeFile(path.join(seed, '.redline/receiver.yaml'), 'setup: { run: pnpm install }\n');
  await git(seed, 'add', '.');
  await git(seed, 'commit', '-qm', 'base');
  await run('git', ['clone', '-q', '--bare', seed, origin]);
  blobs = new FsBlobStore(path.join(dir, 'blobs'));
  mirrors = new GitMirrors({
    root: path.join(dir, 'mirrors'),
    remotes: new LocalRemotes(dir),
    blobs,
    secrets: NO_SECRET_SCAN,
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('GitMirrors', () => {
  it('readies the base branch’s head, and refuses what the host does not have', async () => {
    const prepared = await mirrors.prepare(repository, null);
    if (!prepared.ok) throw new Error(prepared.error.detail);
    expect(prepared.value).toBe(await git(origin, 'rev-parse', 'main'));
    // Ready already: the same commit again.
    expect(await mirrors.prepare(repository, prepared.value)).toEqual(prepared);
    expect(await mirrors.prepare({ ...repository, host: 'elsewhere' }, null)).toMatchObject({
      ok: false,
      error: { transient: false },
    });
    // A base branch or a commit the repository does not have will not appear on a retry.
    expect(await mirrors.prepare({ ...repository, baseBranch: 'gone' }, null)).toMatchObject({
      ok: false,
      error: { transient: false, detail: expect.stringContaining('no branch gone') as string },
    });
    expect(await mirrors.prepare(repository, 'f'.repeat(40))).toMatchObject({
      ok: false,
      error: { transient: false, detail: expect.stringContaining('no longer has') as string },
    });
  });

  it('fills a lost mirror again, with a base no branch reaches any more', async () => {
    const prepared = await mirrors.prepare(repository, null);
    if (!prepared.ok) throw new Error(prepared.error.detail);
    const base = prepared.value;
    const change = await agentChange(base, (work) => writeFile(path.join(work, 'a.txt'), 'a'));
    // The branch is rewritten past the base, and the receiver's mirror is gone.
    const seed = path.join(dir, 'seed');
    await git(seed, 'checkout', '-q', '--orphan', 'rewritten');
    await git(seed, 'commit', '-qm', 'rewritten');
    await git(seed, 'push', '-q', '--force', origin, 'rewritten:main');
    await rm(mirrors.mirrorOf(repository), { recursive: true, force: true });

    expect(await mirrors.prepare(repository, base)).toEqual({ ok: true, value: base });
    await rm(mirrors.mirrorOf(repository), { recursive: true, force: true });
    expect(await mirrors.settings(repository, base)).toMatchObject({ ok: true });
    await rm(mirrors.mirrorOf(repository), { recursive: true, force: true });
    expect(await mirrors.describe(repository, base, change)).toMatchObject({ ok: true });
    await rm(mirrors.mirrorOf(repository), { recursive: true, force: true });
    const committed = await mirrors.commit(repository, {
      baseSha: base,
      change,
      message: 'm',
      author,
      at: 0,
    });
    expect(committed).toMatchObject({ ok: true });
  });

  it('gives a sandbox a working copy of the base, without a remote', async () => {
    const prepared = await mirrors.prepare(repository, null);
    if (!prepared.ok) throw new Error(prepared.error.detail);
    const target = path.join(dir, 'unpacked');
    await mkdir(target);
    // From a mirror that lost it: the working copy is of the commit, wherever it was kept.
    await rm(mirrors.mirrorOf(repository), { recursive: true, force: true });
    const archive = Readable.fromWeb(await mirrors.workingCopy(repository, prepared.value));
    const tar = run('tar', ['-C', target, '-xf', '-']);
    archive.pipe(tar.child.stdin as NodeJS.WritableStream);
    await tar;
    expect(await git(target, 'rev-parse', 'HEAD')).toBe(prepared.value);
    expect(await git(target, 'remote')).toBe('');
    expect(await git(target, 'status', '--porcelain')).toBe('');
  });

  it('describes a change, commits it the same way every time and pushes it once', async () => {
    const prepared = await mirrors.prepare(repository, null);
    if (!prepared.ok) throw new Error(prepared.error.detail);
    const base = prepared.value;
    const change = await agentChange(base, async (work) => {
      await writeFile(path.join(work, 'Card.css'), '.card { align-items: stretch; }\n.grid { }\n');
      await writeFile(
        path.join(work, 'package.json'),
        JSON.stringify({ scripts: { build: 'vite build', postinstall: 'curl evil' } }),
      );
      await writeFile(path.join(work, 'run.sh'), '#!/bin/sh\n', { mode: 0o755 });
    });

    const described = await mirrors.describe(repository, base, change);
    if (!described.ok) throw new Error(described.error.detail);
    expect(described.value.entries).toEqual([
      {
        path: 'Card.css',
        previousPath: null,
        status: 'modified',
        mode: 'file',
        binary: false,
        bytes: 42,
        addedLines: 2,
        removedLines: 1,
      },
      expect.objectContaining({ path: 'package.json', status: 'modified' }),
      {
        path: 'run.sh',
        previousPath: null,
        status: 'added',
        mode: 'executable',
        binary: false,
        bytes: 10,
        addedLines: 1,
        removedLines: 0,
      },
    ]);
    expect(described.value.scriptChanges).toEqual([
      { path: 'package.json', scripts: ['postinstall'] },
    ]);

    const commit = {
      baseSha: base,
      change,
      message: 'Make the cards equal height',
      author,
      at: 1_762_000_000_000,
    };
    const first = await mirrors.commit(repository, commit);
    const again = await mirrors.commit(repository, commit);
    if (!first.ok || !again.ok) throw new Error('commit failed');
    expect(again.value.sha).toBe(first.value.sha);
    // The commit is the requester's, as its author and its committer.
    expect(
      await git(
        mirrors.mirrorOf(repository),
        'log',
        '-1',
        '--format=%an <%ae>|%cn <%ce>',
        first.value.sha,
      ),
    ).toBe('Ann Lee <ann@example.com>|Ann Lee <ann@example.com>');

    const profile = { target: 'branch' as const, draft: true };
    expect(await mirrors.push(repository, profile, first.value.sha, 'redline/task-1')).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await git(origin, 'rev-parse', 'redline/task-1')).toBe(first.value.sha);
    // A retry finds it there; a different commit is refused.
    expect(
      await mirrors.push(repository, profile, first.value.sha, 'redline/task-1'),
    ).toMatchObject({ ok: true });
    expect(await mirrors.push(repository, profile, base, 'redline/task-1')).toMatchObject({
      ok: false,
      error: { transient: false },
    });
  });

  it('describes a change with the secrets found in its commit, and fails with the search', async () => {
    const asked: string[][] = [];
    let found: Awaited<ReturnType<SecretFinder['find']>> = {
      ok: true,
      value: [{ path: 'a.txt', line: 1, rule: 'aws-access-token' }],
    };
    const searching = new GitMirrors({
      root: path.join(dir, 'searching-mirrors'),
      remotes: new LocalRemotes(dir),
      blobs,
      secrets: {
        find: (mirror, baseSha, head) => {
          asked.push([mirror, baseSha, head]);
          return Promise.resolve(found);
        },
      },
    });
    const prepared = await searching.prepare(repository, null);
    if (!prepared.ok) throw new Error(prepared.error.detail);
    const base = prepared.value;
    const change = await agentChange(base, (work) => writeFile(path.join(work, 'a.txt'), 'a'));
    expect(await searching.describe(repository, base, change)).toMatchObject({
      ok: true,
      value: { secrets: [{ path: 'a.txt', line: 1, rule: 'aws-access-token' }] },
    });
    expect(asked).toEqual([[searching.mirrorOf(repository), base, change.head]]);
    found = { ok: false, error: { transient: true, detail: 'gitleaks was stopped (SIGKILL)' } };
    expect(await searching.describe(repository, base, change)).toEqual(found);
  });

  it('refuses a bundle whose objects git would not accept, before any of them is stored', async () => {
    const prepared = await mirrors.prepare(repository, null);
    if (!prepared.ok) throw new Error(prepared.error.detail);
    const base = prepared.value;
    // A tree with a `.git` entry: what a checkout would turn into the repository's own config.
    const work = path.join(dir, 'hostile');
    await run('git', ['clone', '-q', origin, work]);
    await writeFile(path.join(work, 'config'), '[core]\n');
    const blob = await git(work, 'hash-object', '-w', 'config');
    const { stdout } = await run(
      'sh',
      ['-c', `printf '100644 blob ${blob}\\t.git\\n' | git mktree`],
      { cwd: work },
    );
    const hostileTree = stdout.trim();
    const head = await git(work, 'commit-tree', hostileTree, '-p', base, '-m', 'change');
    await git(work, 'update-ref', 'refs/redline/change', head);
    const bundle = path.join(work, 'change.bundle');
    await git(work, 'bundle', 'create', bundle, 'refs/redline/change', `^${base}`);
    const writer = blobs.writer();
    await writer.write(new Uint8Array(await readFile(bundle)));
    const change = { blob: (await writer.commit()).digest, head };
    expect(await mirrors.describe(repository, base, change)).toMatchObject({
      ok: false,
      error: { transient: false },
    });
    await expect(git(mirrors.mirrorOf(repository), 'cat-file', '-e', head)).rejects.toThrow();
  });

  it('reads the team’s settings at a commit, and takes an invalid file as theirs to fix', async () => {
    const prepared = await mirrors.prepare(repository, null);
    if (!prepared.ok) throw new Error(prepared.error.detail);
    expect(await mirrors.settings(repository, prepared.value)).toEqual({
      ok: true,
      value: { setup: { run: 'pnpm install', timeoutMs: null }, checks: [] },
    });
    const seed = path.join(dir, 'seed');
    await writeFile(path.join(seed, '.redline/receiver.yaml'), 'setup: [not, a, setup]\n');
    await git(seed, 'commit', '-qam', 'broken settings');
    const broken = await git(seed, 'rev-parse', 'HEAD');
    await git(seed, 'push', '-q', origin, 'HEAD:main');
    expect(await mirrors.settings(repository, broken)).toMatchObject({
      ok: false,
      error: {
        transient: false,
        detail: expect.stringContaining('.redline/receiver.yaml') as string,
      },
    });
    await git(seed, 'rm', '-q', '.redline/receiver.yaml');
    await git(seed, 'commit', '-qm', 'no settings');
    const none = await git(seed, 'rev-parse', 'HEAD');
    await git(seed, 'push', '-q', origin, 'HEAD:main');
    expect(await mirrors.settings(repository, none)).toEqual({
      ok: true,
      value: { setup: null, checks: [] },
    });
  });

  it('takes only one commit on the task’s base as a change', async () => {
    const prepared = await mirrors.prepare(repository, null);
    if (!prepared.ok) throw new Error(prepared.error.detail);
    const base = prepared.value;
    const change = await agentChange(base, (work) => writeFile(path.join(work, 'a.txt'), 'a'));
    const otherBase = 'f'.repeat(40);
    expect(await mirrors.describe(repository, otherBase, change)).toMatchObject({ ok: false });
    const writer = blobs.writer();
    await writer.write(new TextEncoder().encode('not a bundle'));
    const { digest } = await writer.commit();
    expect(
      await mirrors.describe(repository, base, { blob: digest, head: change.head }),
    ).toMatchObject({ ok: false, error: { transient: false } });
    // A bundle is taken only with the commit the run named.
    expect(
      await mirrors.describe(repository, base, { ...change, head: 'e'.repeat(40) }),
    ).toMatchObject({ ok: false, error: { transient: false } });
  });

  it('reaches a host over HTTPS with a header made for each call, and keeps no credentials', async () => {
    const authorization = `Basic ${Buffer.from('x-access-token:ghs_secret').toString('base64')}`;
    const server = await httpGitServer(dir, authorization);
    try {
      const remote = { url: `${server.url}/origin.git`, authorization };
      const viaHttp = new GitMirrors({
        root: path.join(dir, 'http-mirrors'),
        remotes: { source: () => reachable(remote), target: () => reachable(remote) },
        blobs,
        secrets: NO_SECRET_SCAN,
      });
      const prepared = await viaHttp.prepare(repository, null);
      if (!prepared.ok) throw new Error(prepared.error.detail);
      const change = await agentChange(prepared.value, (work) =>
        writeFile(path.join(work, 'b.txt'), 'b'),
      );
      const commit = { baseSha: prepared.value, change, message: 'm', author, at: 0 };
      const committed = await viaHttp.commit(repository, commit);
      if (!committed.ok) throw new Error(committed.error.detail);
      expect(
        await viaHttp.push(
          repository,
          { target: 'branch', draft: true },
          committed.value.sha,
          'redline/task-1',
        ),
      ).toEqual({
        ok: true,
        value: undefined,
      });
      expect(await git(origin, 'rev-parse', 'redline/task-1')).toBe(committed.value.sha);
      expect(server.seen.filter((header) => header === authorization).length).toBeGreaterThan(0);
      // Nothing about the host stays in the mirror.
      const mirrorConfig = await readFile(
        path.join(dir, 'http-mirrors/local/origin.git.git/config'),
        'utf8',
      );
      expect(mirrorConfig).not.toContain('ghs_secret');
      expect(mirrorConfig).not.toContain(server.url);

      const refused = new GitMirrors({
        root: path.join(dir, 'refused-mirrors'),
        remotes: {
          source: () => reachable({ ...remote, authorization: null }),
          target: () => reachable(remote),
        },
        blobs,
        secrets: NO_SECRET_SCAN,
      });
      expect(await refused.prepare(repository, null)).toMatchObject({
        ok: false,
        error: { transient: true },
      });
    } finally {
      server.close();
    }
  });
});
