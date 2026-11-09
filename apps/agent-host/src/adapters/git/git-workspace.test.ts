import { CHANGE_REF, WORK_REF } from '@redline/agent-protocol';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GitWorkspace } from './git-workspace';

const run = promisify(execFile);
let dir: string;
let repo: string;
let base: string;

const git = async (cwd: string, ...args: string[]) =>
  (
    await run('git', args, {
      cwd,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    })
  ).stdout.trim();

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'agent-host-git-'));
  repo = path.join(dir, 'workspace');
  await mkdir(repo);
  await git(repo, 'init', '-q', '-b', 'main');
  await writeFile(path.join(repo, 'Card.css'), '.card { }\n');
  await writeFile(path.join(repo, '.gitignore'), 'dist/\n');
  await git(repo, 'add', '.');
  await git(repo, 'commit', '-qm', 'base');
  base = await git(repo, 'rev-parse', 'HEAD');
});

const workspaceAt = (root: string) =>
  new GitWorkspace({
    root,
    changeBundle: path.join(dir, 'change.bundle'),
    workBundle: path.join(dir, 'work.bundle'),
    pausedWork: path.join(dir, 'work.bundle'),
  });

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('GitWorkspace', () => {
  it('finds no change in an untouched tree, or one with only ignored files', async () => {
    await mkdir(path.join(repo, 'dist'));
    await writeFile(path.join(repo, 'dist/app.js'), 'built');
    expect(await workspaceAt(repo).exportChange(base)).toBeNull();
    expect(await workspaceAt(repo).exportWork(base)).toBeNull();
  });

  it('exports every change, staged or not and committed or not, as one commit on the base', async () => {
    await writeFile(path.join(repo, 'Card.css'), '.card { align-items: stretch; }\n');
    await writeFile(path.join(repo, 'New.ts'), 'export {};\n');
    // The agent committed part of it itself; the export does not care.
    await git(repo, 'add', 'New.ts');
    await git(repo, 'commit', '-qm', 'agent commit');
    // A hook it left behind does not run.
    await writeFile(path.join(repo, '.git/hooks/pre-commit'), '#!/bin/sh\nexit 1\n', {
      mode: 0o755,
    });

    const bundlePath = path.join(dir, 'change.bundle');
    const change = await workspaceAt(repo).exportChange(base);
    expect(change?.head).toMatch(/^[0-9a-f]{40}$/);

    // The receiver's side: a mirror at the base imports the bundle.
    const mirror = path.join(dir, 'mirror');
    await run('git', ['clone', '-q', '--bare', repo, mirror]);
    await git(mirror, 'bundle', 'verify', bundlePath);
    await git(mirror, 'fetch', '-q', bundlePath, `${CHANGE_REF}:${CHANGE_REF}`);
    expect(await git(mirror, 'rev-parse', `${CHANGE_REF}^`)).toBe(base);
    expect(await git(mirror, 'diff', '--name-only', base, CHANGE_REF)).toBe('Card.css\nNew.ts');
  });

  it('carries the work of a paused run into the workspace of the run that goes on with it', async () => {
    await rm(path.join(repo, 'Card.css'));
    await writeFile(path.join(repo, 'New.ts'), 'export {};\n');
    const work = await workspaceAt(repo).exportWork(base);
    expect(work?.head).toMatch(/^[0-9a-f]{40}$/);

    // The next run's workspace: the base, with what its setup installed.
    const next = path.join(dir, 'next');
    await run('git', ['clone', '-q', repo, next]);
    await git(next, 'checkout', '-q', '--detach', base);
    await mkdir(path.join(next, 'dist'));
    await writeFile(path.join(next, 'dist/app.js'), 'built');
    await workspaceAt(next).restoreWork(base, work?.head ?? '');

    await expect(readFile(path.join(next, 'Card.css'))).rejects.toThrow();
    expect(await readFile(path.join(next, 'New.ts'), 'utf8')).toBe('export {};\n');
    expect(await readFile(path.join(next, 'dist/app.js'), 'utf8')).toBe('built');
    expect(await git(next, 'rev-parse', 'HEAD')).toBe(base);
    // The run ends with a change made of the same tree as the paused one.
    const change = await workspaceAt(next).exportChange(base);
    expect(await git(next, 'rev-parse', `${change?.head ?? ''}^{tree}`)).toBe(
      await git(next, 'rev-parse', `${WORK_REF}^{tree}`),
    );
  });

  it('refuses work that is not the one the brief names', async () => {
    await writeFile(path.join(repo, 'New.ts'), 'export {};\n');
    await workspaceAt(repo).exportWork(base);
    await expect(workspaceAt(repo).restoreWork(base, 'd'.repeat(40))).rejects.toThrow(/not d/);
  });
});
