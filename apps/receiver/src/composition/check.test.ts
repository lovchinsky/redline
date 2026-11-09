import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { silentLogger } from '../application/testing/fakes';
import { parseConfig } from '../adapters/config/config';
import { checkDeployment } from './check';
import type { Settings } from './settings';

const run = promisify(execFile);
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'redline-check-'));
  const seed = path.join(dir, 'seed');
  await mkdir(seed);
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@t',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@t',
  };
  await run('git', ['init', '-q', '-b', 'main'], { cwd: seed });
  await writeFile(path.join(seed, 'a.txt'), 'a');
  await run('git', ['add', '.'], { cwd: seed });
  await run('git', ['commit', '-qm', 'base'], { cwd: seed, env });
  await mkdir(path.join(dir, 'git/acme'), { recursive: true });
  await run('git', ['clone', '-q', '--bare', seed, path.join(dir, 'git/acme/web.git')]);
  await writeFile(path.join(dir, 'operator-key'), '');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('checkDeployment', () => {
  it('names what works and what does not, each with what it found', async () => {
    const parsed = parseConfig(`
agent:
  kind: claude
  docker: { socket: ${path.join(dir, 'no-docker.sock')} }
  networks: { setup: redline-sandbox-setup, agent: redline-sandbox-agent }
  gateway: { model: 'http://10.89.1.2:8788', egress: 'http://10.89.2.2:3128' }
git: { kind: local, root: ${path.join(dir, 'git')} }
models:
  credentials: managed
  operator: { kind: api-key, secretFile: ${path.join(dir, 'operator-key')} }
projects:
  - { id: web, name: Web, repository: { host: local, name: acme/web.git } }
  - { id: gone, name: Gone, repository: { host: local, name: acme/gone.git } }
`);
    if (!parsed.ok) throw new Error(parsed.errors.join('\n'));
    const settings = {
      blobsPath: path.join(dir, 'blobs'),
      mirrorsPath: path.join(dir, 'mirrors'),
    } as Settings;
    const checks = await checkDeployment(settings, parsed.value, silentLogger);
    const byName = Object.fromEntries(checks.map((check) => [check.name, check]));
    expect(byName['operator’s model credential']).toMatchObject({
      ok: false,
      detail: expect.stringContaining('is empty') as string,
    });
    expect(byName['web: repository']).toMatchObject({
      ok: true,
      detail: expect.stringMatching(/^acme\/web\.git@main is at [0-9a-f]{12}$/) as string,
    });
    expect(byName['gone: repository']).toMatchObject({ ok: false });
    expect(byName['sandboxes']).toMatchObject({ ok: false });
    expect(byName['sandbox image redline-agent:latest']).toMatchObject({ ok: false });
  });
});
