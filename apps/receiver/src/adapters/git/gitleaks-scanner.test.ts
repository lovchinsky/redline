import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskId } from '../../domain/ids';
import type { RepositoryRef } from '../../ports/access';
import { FsBlobStore } from '../blobs/fs-blob-store';
import { GitMirrors } from './git-mirrors';
import { GitleaksScanner } from './gitleaks-scanner';
import { LocalRemotes } from './remotes';
import { gitleaksStandIn } from './testing/gitleaks-stand-in';

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
let mirrors: GitMirrors;
let blobs: FsBlobStore;
let command: string;
const repository: RepositoryRef = { host: 'local', name: 'origin.git', baseBranch: 'main' };
const taskId = TaskId('task-1');

const changeWith = async (base: string, content: string) => {
  const work = path.join(dir, `work-${String(Math.random()).slice(2)}`);
  await run('git', ['clone', '-q', path.join(dir, 'origin.git'), work]);
  await writeFile(path.join(work, 'config.js'), content);
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
  const bundle = path.join(work, 'change.bundle');
  await git(work, 'bundle', 'create', bundle, 'refs/redline/change', `^${base}`);
  const writer = blobs.writer();
  await writer.write(new Uint8Array(await readFile(bundle)));
  return { blob: (await writer.commit()).digest, head };
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'redline-gitleaks-test-'));
  const seed = path.join(dir, 'seed');
  await mkdir(seed);
  await git(seed, 'init', '-q', '-b', 'main');
  await writeFile(path.join(seed, 'README.md'), '# web\n');
  await git(seed, 'add', '.');
  await git(seed, 'commit', '-qm', 'base');
  await run('git', ['clone', '-q', '--bare', seed, path.join(dir, 'origin.git')]);
  blobs = new FsBlobStore(path.join(dir, 'blobs'));
  mirrors = new GitMirrors({
    root: path.join(dir, 'mirrors'),
    remotes: new LocalRemotes(dir),
    identity: { name: 'Redline', email: 'bot@redline.invalid' },
    blobs,
  });
  command = await gitleaksStandIn(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('GitleaksScanner', () => {
  it('scans only what the change adds on the mirror, redacted, and names each finding', async () => {
    const prepared = await mirrors.prepare(repository, taskId);
    if (!prepared.ok) throw new Error(prepared.error.detail);
    const base = prepared.value.baseSha;
    const scanner = new GitleaksScanner({ mirrors, command });

    expect(
      await scanner.scan(repository, base, await changeWith(base, 'export const region = "eu";\n')),
    ).toEqual({
      ok: true,
      value: [],
    });
    const leaked = await changeWith(base, 'export const key = "AKIAIOSFODNN7EXAMPLE";\n');
    expect(await scanner.scan(repository, base, leaked)).toEqual({
      ok: true,
      value: [{ path: 'config.js', line: 1, rule: 'aws-access-token' }],
    });
    // A comment in the change does not make its secret allowed.
    const allowed = await changeWith(
      base,
      'export const key = "AKIAIOSFODNN7EXAMPLE"; // gitleaks:allow\n',
    );
    expect(await scanner.scan(repository, base, allowed)).toMatchObject({
      ok: true,
      value: [{ rule: 'aws-access-token' }],
    });
    const args = (await readFile(path.join(dir, 'arguments'), 'utf8')).trim().split('\n');
    expect(args[0]).toBe('git');
    expect(args[1]).toBe(mirrors.mirrorOf(repository));
    expect(args).toContain('--redact');
    expect(args.find((arg) => arg.startsWith('--log-opts='))).toMatch(
      new RegExp(`^--log-opts=${base}\\.\\.[0-9a-f]{40}$`),
    );
  });

  it('fails a scan gitleaks cannot make, and retries only one the system stopped', async () => {
    const prepared = await mirrors.prepare(repository, taskId);
    if (!prepared.ok) throw new Error(prepared.error.detail);
    const base = prepared.value.baseSha;
    const change = await changeWith(base, 'x');
    const scan = (command: string) =>
      new GitleaksScanner({ mirrors, command }).scan(repository, base, change);
    expect(await scan(path.join(dir, 'missing-gitleaks'))).toMatchObject({
      ok: false,
      error: { transient: false },
    });
    const script = async (name: string, body: string) => {
      const file = path.join(dir, name);
      await writeFile(file, `#!/bin/sh\n${body}\n`);
      await chmod(file, 0o755);
      return file;
    };
    expect(await scan(await script('failing-gitleaks', 'exit 1'))).toMatchObject({
      ok: false,
      error: { transient: false },
    });
    expect(await scan(await script('silent-gitleaks', 'exit 0'))).toMatchObject({
      ok: false,
      error: { transient: false, detail: 'gitleaks wrote no report' },
    });
    expect(await scan(await script('killed-gitleaks', 'kill -KILL $$'))).toMatchObject({
      ok: false,
      error: { transient: true },
    });
  });
});
