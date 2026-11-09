import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bundle, project, silentLogger } from '../../application/testing/fakes';
import { BlobDigest, ProjectId, QuestionId, RunId, TaskId } from '../../domain/ids';
import type { RunSpec } from '../../ports/agent';
import type { GrantToken } from '../../ports/tasks';
import { FsBlobStore } from '../blobs/fs-blob-store';
import { systemClock } from '../system/system';
import { GitMirrors } from '../git/git-mirrors';
import { NO_SECRET_SCAN } from '../git/secrets';
import { LocalRemotes } from '../git/remotes';
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
/** A supervisor that does nothing with what it hears of the run. */
const quiet = { setupDone: () => Promise.resolve() };

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
const repository = { host: 'local', name: 'origin.git', baseBranch: 'main' };

const sandboxes = (runtime = 'runc') =>
  new DockerSandboxes({
    socketPath: socket,
    runtime,
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
    clock: systemClock,
    logger: silentLogger,
  });

const specFor = async (runId: RunId, title: string): Promise<RunSpec> => {
  const taskId = TaskId(`task-${runId}`);
  const prepared = await mirrors.prepare(repository, null);
  if (!prepared.ok) throw new Error(prepared.error.detail);
  const settings = await mirrors.settings(repository, prepared.value);
  if (!settings.ok) throw new Error(settings.error.detail);
  const writer = blobs.writer();
  await writer.write(new TextEncoder().encode('# Make the cards equal height\n'));
  const { digest } = await writer.commit();
  return {
    runId,
    taskId,
    project: ProjectId('acme-web'),
    repository,
    baseSha: prepared.value,
    setup: settings.value.setup,
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
      checks: settings.value.checks,
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
    remotes: new LocalRemotes(dir),
    identity: { name: 'Redline', email: 'bot@redline.invalid' },
    blobs,
    secrets: NO_SECRET_SCAN,
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
    const seen = report(await agent.observe(runId, new AbortController().signal, quiet));
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
    // The working copy is the agent's, whoever the receiver runs as.
    expect(seen['writeWorkspace']).toBe('allowed');
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
    const outcome = await runner().observe(runId, new AbortController().signal, quiet);
    if (outcome.kind !== 'change') throw new Error(`Expected a change, got ${outcome.kind}`);
    expect(
      new TextDecoder().decode((await blobs.read(outcome.change.blob)) ?? new Uint8Array()),
    ).toBe('stand-in bundle');
    await runner().release(runId);
  });

  it('pauses on a question, and goes on in new sandboxes with the session and work it left', async () => {
    const first = RunId(`it-${String(Date.now())}-q`);
    started.push(first);
    const asking = await specFor(first, 'Make the cards equal height, after a question');
    await runner().start({ ...asking, brief: { ...asking.brief, questionsLeft: 1 } });
    const asked = await runner().observe(first, new AbortController().signal, quiet);
    if (asked.kind !== 'question') throw new Error(`Expected a question, got ${asked.kind}`);
    const { snapshot } = asked;
    expect(snapshot).toMatchObject({ model: asking.execution.model });
    expect(snapshot?.image).toMatch(/^sha256:/);
    await runner().release(first);
    if (snapshot === null) throw new Error('The run left no snapshot');
    expect(await runner().resumable(snapshot, asking.execution)).toBe(true);
    expect(await runner().resumable(snapshot, { ...asking.execution, model: 'claude-other' })).toBe(
      false,
    );

    const second = RunId(`it-${String(Date.now())}-r`);
    started.push(second);
    const resuming = await specFor(second, 'Make the cards equal height, after a question');
    await runner().start({
      ...resuming,
      taskId: asking.taskId,
      baseSha: asking.baseSha,
      brief: {
        ...resuming.brief,
        exchanges: [
          {
            question: { id: QuestionId('q-asked'), ...asked.question },
            askedAt: 0,
            answer: { source: 'requester', text: 'Desktop only', at: 1 },
            closed: true,
          },
        ],
      },
      resumeFrom: snapshot,
    });
    const seen = report(await runner().observe(second, new AbortController().signal, quiet));
    expect(seen['resumed']).toEqual({
      resume: {
        sessionId: 'session-1',
        workHead: 'd'.repeat(40),
        deferred: { call: 'toolu_1', answer: { text: 'Desktop only' } },
      },
      transcript: '{"asked":"Desktop only?"}\n',
      work: 'stand-in work',
      appendSession: 'allowed',
    });
    // The setup worked on the base again before the agent went on.
    expect(seen).toMatchObject({ setup: 'installed', card: '.card { }\n' });
    await runner().release(second);
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
