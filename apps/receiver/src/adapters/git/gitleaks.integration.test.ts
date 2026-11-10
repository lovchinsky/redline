import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FsBlobStore } from '../blobs/fs-blob-store';
import { GitMirrors } from './git-mirrors';
import { GitleaksFinder } from './secrets';
import { LocalRemotes } from './remotes';

/** The search with the real gitleaks: `REDLINE_TEST_GITLEAKS` names its binary. */
const command = process.env['REDLINE_TEST_GITLEAKS'];
if (command === undefined || command === '') {
  throw new Error('Set REDLINE_TEST_GITLEAKS to the gitleaks binary to test secret scanning');
}

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
let blobs: FsBlobStore;
let mirrors: GitMirrors;
let base: string;
const repository = { host: 'local', name: 'origin.git', baseBranch: 'main' };

const change = async (files: Record<string, string>) => {
  const work = path.join(dir, `work-${String(Math.random()).slice(2)}`);
  await run('git', ['clone', '-q', path.join(dir, 'origin.git'), work]);
  for (const [file, content] of Object.entries(files))
    await writeFile(path.join(work, file), content);
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
    path.join(work, 'c.bundle'),
    'refs/redline/change',
    `^${base}`,
  );
  const writer = blobs.writer();
  await writer.write(new Uint8Array(await readFile(path.join(work, 'c.bundle'))));
  return { blob: (await writer.commit()).digest, head };
};

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'redline-gitleaks-real-'));
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
    blobs,
    secrets: new GitleaksFinder(command),
  });
  const prepared = await mirrors.prepare(repository, null);
  if (!prepared.ok) throw new Error(prepared.error.detail);
  base = prepared.value;
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('GitleaksFinder with gitleaks', () => {
  it('finds a token the change adds, and nothing in a clean one', async () => {
    const secretsIn = async (files: Record<string, string>) => {
      const described = await mirrors.describe(repository, base, await change(files));
      return described.ok ? described.value.secrets : described;
    };
    // Put together here, so this repository holds no token-shaped string of its own.
    const token = ['ghp', 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'].join('_');
    expect(await secretsIn({ 'deploy.js': `const token = "${token}";\n` })).toMatchObject([
      { path: 'deploy.js', line: 1 },
    ]);
    expect(await secretsIn({ 'Card.css': '.card { }\n' })).toEqual([]);
  });

  it('is not told by the change what to ignore', async () => {
    const token = ['ghp', 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2'].join('_');
    const leaked = await change({
      '.gitleaks.toml': "[allowlist]\npaths = ['''.*''']\n",
      '.gitleaksignore': '*\n',
      'deploy.js': `const token = "${token}";\n`,
      'release.js': `const token = "${token}"; // gitleaks:allow\n`,
    });
    const described = await mirrors.describe(repository, base, leaked);
    expect(described).toMatchObject({ ok: true });
    expect(
      described.ok ? described.value.secrets.map((finding) => finding.path).sort() : [],
    ).toEqual(['deploy.js', 'release.js']);
  });
});
