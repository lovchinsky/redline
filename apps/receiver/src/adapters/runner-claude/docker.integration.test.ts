import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundle, project, silentLogger } from '../../application/testing/fakes';
import { BlobDigest, ProjectId, RunId, TaskId } from '../../domain/ids';
import type { RunSpec } from '../../ports/agent';
import type { GrantToken } from '../../ports/tasks';
import { FsBlobStore } from '../blobs/fs-blob-store';
import { GitMirrors } from '../git/git-mirrors';
import { DockerSandboxes } from './docker-sandboxes';
import { SandboxedClaudeRunner } from './sandboxed-runner';
import {
  SANDBOX_USER,
  buildStandInImage,
  internalNetwork,
  removeNetwork,
} from './testing/stand-in-image';

/**
 * The runner against a real Docker Engine, with a stand-in agent that reports what its sandbox
 * gives it. `REDLINE_TEST_DOCKER` names the Engine's socket. gVisor is what deployments run;
 * these tests run the same containers under runc, the isolation they waive by name.
 */
const socket = process.env['REDLINE_TEST_DOCKER'];
if (socket === undefined || socket === '') {
  throw new Error('Set REDLINE_TEST_DOCKER to the Docker socket to test sandboxes');
}

const run = promisify(execFile);
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

const networks = { setup: 'redline-test-setup', agent: 'redline-test-agent' };
let dir: string;
let image: string;
let blobs: FsBlobStore;
let mirrors: GitMirrors;
const repository = { host: 'local', name: 'web', baseBranch: 'main' };

const sandboxes = (runtime = 'runc') =>
  new DockerSandboxes({
    socketPath: socket,
    runtime,
    user: `${String(SANDBOX_USER.uid)}:${String(SANDBOX_USER.gid)}`,
  });

const runner = () =>
  new SandboxedClaudeRunner({
    sandboxes: sandboxes(),
    sources: mirrors,
    blobs,
    settings: {
      user: SANDBOX_USER,
      networks,
      gateway: { model: 'http://10.89.1.2:8788', egress: 'http://10.89.2.2:3128' },
      limits: { cpus: 1, memoryBytes: 512 * 1024 * 1024, pids: 256 },
      setupTimeoutMs: 60_000,
      graceMs: 10_000,
    },
    logger: silentLogger,
  });

const specFor = async (runId: RunId, title: string): Promise<RunSpec> => {
  const taskId = TaskId(`task-${runId}`);
  const prepared = await mirrors.prepare(repository, taskId);
  if (!prepared.ok) throw new Error(prepared.error.detail);
  const writer = blobs.writer();
  await writer.write(new TextEncoder().encode('# Make the cards equal height\n'));
  const { digest } = await writer.commit();
  return {
    runId,
    taskId,
    project: ProjectId('acme-web'),
    repository,
    baseSha: prepared.value.baseSha,
    brief: {
      title,
      bundle: {
        ...bundle,
        files: [{ path: 'context.md', digest: BlobDigest(digest), mediaType: 'text/markdown' }],
      },
      exchanges: [],
      questionsLeft: 0,
      protectedPaths: ['.github'],
      limits: { maxFiles: 50, maxChangedLines: 2000 },
    },
    resumeFrom: null,
    grants: { setup: 'setup-grant' as GrantToken, agent: 'agent-grant' as GrantToken },
    credential: 'api-key',
    execution: {
      ...project().execution,
      image,
      timeoutMs: 60_000,
      setupSecrets: { registry: path.join(dir, 'registry-token') },
    },
  };
};

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'redline-docker-'));
  const seed = path.join(dir, 'seed');
  await mkdir(path.join(seed, '.redline'), { recursive: true });
  await git(seed, 'init', '-q', '-b', 'main');
  await writeFile(path.join(seed, 'Card.css'), '.card { }\n');
  await writeFile(
    path.join(seed, '.redline/receiver.yaml'),
    'setup: { run: "read -r token < $REDLINE_SECRETS/registry; test $token = registry-token && echo installed > /workspace/setup.log" }\nchecks: [pnpm test]\n',
  );
  await git(seed, 'add', '.');
  await git(seed, 'commit', '-qm', 'base');
  await run('git', ['clone', '-q', '--bare', seed, path.join(dir, 'origin.git')]);
  await writeFile(path.join(dir, 'registry-token'), 'registry-token');
  blobs = new FsBlobStore(path.join(dir, 'blobs'));
  mirrors = new GitMirrors({
    root: path.join(dir, 'mirrors'),
    urlOf: () => `file://${dir}/origin.git`,
    identity: { name: 'Redline', email: 'bot@redline.invalid' },
    blobs,
  });
  image = await buildStandInImage();
  await internalNetwork(networks.setup);
  await internalNetwork(networks.agent);
}, 120_000);

/** Runs a test started: released after all tests, whatever happened in them. */
const started: RunId[] = [];

afterAll(async () => {
  for (const runId of started) await runner().release(runId);
  await removeNetwork(networks.setup);
  await removeNetwork(networks.agent);
  await rm(dir, { recursive: true, force: true });
});

const report = (outcome: Awaited<ReturnType<SandboxedClaudeRunner['observe']>>) => {
  if (outcome.kind === 'no-change')
    return JSON.parse(outcome.explanation) as Record<string, unknown>;
  if (outcome.kind === 'change')
    return JSON.parse(outcome.report.summary) as Record<string, unknown>;
  throw new Error(`Unexpected outcome: ${JSON.stringify(outcome)}`);
};

describe('the sandboxed runner on Docker', () => {
  it('runs the setup and then the agent in sandboxes that hold nothing else', async () => {
    const agent = runner();
    const runId = RunId(`it-${String(Date.now())}-a`);
    started.push(runId);
    expect(await agent.start(await specFor(runId, 'Make the cards equal height'))).toEqual({
      ok: true,
    });
    const seen = report(await agent.observe(runId, new AbortController().signal));
    expect(seen).toMatchObject({
      title: 'Make the cards equal height',
      checks: ['pnpm test'],
      uid: SANDBOX_USER.uid,
      card: '.card { }\n',
      setup: 'installed',
      bundle: '# Make the cards equal height\n',
      grant: 'agent-grant',
      baseUrl: 'http://10.89.1.2:8788',
    });
    expect(seen['writeRoot']).toBe('EROFS');
    expect(seen['writeInput']).toBe('EROFS');
    // The setup read the registry's secret; the agent does not have it.
    expect(seen['secrets']).toBe('ENOENT');
    expect(seen['internet']).not.toBe('reached');
    await agent.release(runId);
    expect(await agent.live()).not.toContain(runId);
  });

  it('takes the change a run leaves, and attaches to a run after a restart', async () => {
    const runId = RunId(`it-${String(Date.now())}-b`);
    started.push(runId);
    await runner().start(await specFor(runId, 'Make a change'));
    // Another worker, after a restart, attaches to the same run.
    const outcome = await runner().observe(runId, new AbortController().signal);
    if (outcome.kind !== 'change') throw new Error(`Expected a change, got ${outcome.kind}`);
    expect(
      new TextDecoder().decode((await blobs.read(outcome.change.blob)) ?? new Uint8Array()),
    ).toBe('stand-in bundle');
    await runner().release(runId);
  });

  it('refuses to run without the configured isolation, or on a network that is not internal', async () => {
    expect(await sandboxes('runsc').unfit([])).toMatch(/no runsc runtime/);
    await run('docker', ['network', 'create', 'redline-test-open']).catch(() => undefined);
    try {
      expect(await sandboxes().unfit(['redline-test-open'])).toMatch(/not internal/);
    } finally {
      await removeNetwork('redline-test-open');
    }
    expect(await sandboxes().unfit([networks.setup, networks.agent])).toBeNull();
  });
});
