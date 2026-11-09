import {
  AGENT_PROTOCOL_VERSION,
  RUN_LAYOUT,
  type Outcome,
  type Pause,
} from '@redline/agent-protocol';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bundle, project, silentLogger } from '../../application/testing/fakes';
import { BlobDigest, ProjectId, QuestionId, RunId, TaskId } from '../../domain/ids';
import type { RunSpec } from '../../ports/agent';
import type { GrantToken } from '../../ports/tasks';
import { FsBlobStore } from '../blobs/fs-blob-store';
import type { ContainerSpec, ContainerState, SandboxProvider } from './sandbox';
import { SandboxedClaudeRunner, type SandboxSettings, type SourceTrees } from './sandboxed-runner';
import { packSnapshot, unpackSnapshot } from './snapshot';
import { filesOf, tarOf } from './tar';

const IMAGE_ID = 'sha256:1d2e';

const bufferOf = async (archive: Buffer | Readable): Promise<Buffer> => {
  if (Buffer.isBuffer(archive)) return archive;
  const chunks: Buffer[] = [];
  for await (const chunk of archive) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

/** Docker in memory: containers that run when told, and exit with what the test says. */
class FakeSandboxes implements SandboxProvider {
  unfitReason: string | null = null;
  readonly volumes = new Map<string, Record<string, string>>();
  readonly containers = new Map<
    string,
    { spec: ContainerSpec; state: ContainerState; uploads: string[]; out: Buffer | null }
  >();
  /** Exit codes the next containers of each phase exit with when they run. */
  readonly exits: Record<'setup' | 'agent', number> = { setup: 0, agent: 0 };
  /** What the agent leaves in its out volume when it exits. */
  agentOutput: Buffer | null = null;
  /** Docker's archive of the agent's session directory. */
  sessionArchive: Buffer | null = null;
  readonly started: string[] = [];
  /** Every archive put into a container, by the path it went to. */
  readonly uploaded: { container: string; target: string; archive: Buffer }[] = [];
  /** The images Docker has, by reference. */
  readonly images = new Map<string, string>([[project().execution.image, IMAGE_ID]]);

  unfit() {
    return Promise.resolve(this.unfitReason);
  }
  imageId(reference: string) {
    return Promise.resolve(this.images.get(reference) ?? null);
  }
  createVolume(name: string, labels: Record<string, string>) {
    this.volumes.set(name, labels);
    return Promise.resolve();
  }
  removeVolume(name: string) {
    this.volumes.delete(name);
    return Promise.resolve();
  }
  create(spec: ContainerSpec) {
    if (!this.containers.has(spec.name)) {
      this.containers.set(spec.name, {
        spec,
        state: { status: 'created', labels: spec.labels },
        uploads: [],
        out: null,
      });
    }
    return Promise.resolve();
  }
  async upload(container: string, target: string, archive: Buffer | Readable) {
    this.get(container).uploads.push(target);
    this.uploaded.push({ container, target, archive: await bufferOf(archive) });
  }
  download(container: string, target: string) {
    const entry = this.get(container);
    const archive = target === RUN_LAYOUT.session ? this.sessionArchive : entry.out;
    return Promise.resolve(archive === null ? null : Readable.from([archive]));
  }
  start(container: string) {
    const entry = this.get(container);
    this.started.push(container);
    entry.state = { status: 'running', labels: entry.spec.labels, startedAt: Date.now() };
    return Promise.resolve();
  }
  state(container: string) {
    return Promise.resolve(
      this.containers.get(container)?.state ?? ({ status: 'missing' } as const),
    );
  }
  wait(container: string, signal: AbortSignal) {
    const entry = this.get(container);
    const phase = entry.spec.labels['redline.phase'] as 'setup' | 'agent';
    if (signal.aborted) return Promise.resolve(null);
    if (phase === 'agent' && this.hangAgent) {
      return new Promise<number | null>((resolve) => {
        signal.addEventListener('abort', () => {
          resolve(null);
        });
      });
    }
    const exitCode = this.exits[phase];
    entry.state = { status: 'exited', labels: entry.spec.labels, exitCode };
    if (phase === 'agent') entry.out = this.agentOutput;
    return Promise.resolve(exitCode);
  }
  hangAgent = false;
  logs() {
    return Promise.resolve(this.output);
  }
  output = 'npm ERR! 404 left-pad';
  remove(container: string) {
    this.containers.delete(container);
    return Promise.resolve();
  }
  labelled(label: string) {
    return Promise.resolve(
      [
        ...[...this.containers].map(([name, entry]) => ({
          name,
          value: entry.spec.labels[label] ?? '',
        })),
        ...[...this.volumes].map(([name, labels]) => ({ name, value: labels[label] ?? '' })),
      ].filter((entry) => entry.value !== ''),
    );
  }
  private get(container: string) {
    const entry = this.containers.get(container);
    if (entry === undefined) throw new Error(`No container ${container}`);
    return entry;
  }
}

const sources = (settingsFile: string | null): SourceTrees => ({
  workingCopy: async () =>
    Readable.from([
      await tarOf([{ path: 'Card.css', content: new TextEncoder().encode('.card { }') }], {
        uid: 0,
        gid: 0,
      }),
    ]),
  fileAt: () => Promise.resolve(settingsFile),
});

const settings: SandboxSettings = {
  user: { uid: 1000, gid: 1000 },
  networks: { setup: 'redline-setup', agent: 'redline-agent' },
  gateway: { model: 'http://10.89.1.2:8788', egress: 'http://10.89.2.2:3128' },
  limits: { cpus: 2, memoryBytes: 4 * 1024 ** 3, pids: 512 },
  setupTimeoutMs: 600_000,
  graceMs: 60_000,
};

const runId = RunId('run-1');
let dir: string;
let blobs: FsBlobStore;
let sandboxes: FakeSandboxes;

const spec = async (credential: 'api-key' | 'subscription' = 'api-key'): Promise<RunSpec> => {
  const writer = blobs.writer();
  await writer.write(new TextEncoder().encode('# Redline task'));
  const { digest } = await writer.commit();
  return {
    runId,
    taskId: TaskId('task-1'),
    project: ProjectId('acme-web'),
    repository: project().repository,
    baseSha: 'a'.repeat(40),
    brief: {
      title: 'Make the cards equal height',
      bundle: {
        ...bundle,
        files: [{ path: 'context.md', digest: BlobDigest(digest), mediaType: 'text/markdown' }],
      },
      exchanges: [],
      questionsLeft: 2,
      protectedPaths: ['.github'],
      limits: { maxFiles: 50, maxChangedLines: 2000 },
    },
    resumeFrom: null,
    grants: { setup: 'setup-grant' as GrantToken, agent: 'agent-grant' as GrantToken },
    credential,
    execution: project().execution,
  };
};

const runner = (
  settingsFile:
    string | null = 'setup: { run: pnpm install --frozen-lockfile }\nchecks: [pnpm test]\n',
) =>
  new SandboxedClaudeRunner({
    sandboxes,
    sources: sources(settingsFile),
    blobs,
    settings,
    logger: silentLogger,
  });

const outputOf = async (outcome: Outcome, change: string | null, work: string | null = null) =>
  tarOf(
    [
      { path: 'out/outcome.json', content: new TextEncoder().encode(JSON.stringify(outcome)) },
      { path: 'out/events.jsonl', content: new TextEncoder().encode('{"kind":"ended"}\n') },
      ...(change === null
        ? []
        : [{ path: 'out/change.bundle', content: new TextEncoder().encode(change) }]),
      ...(work === null
        ? []
        : [{ path: 'out/work.bundle', content: new TextEncoder().encode(work) }]),
    ],
    { uid: 1000, gid: 1000 },
  );

const text = (value: string) => new TextEncoder().encode(value);
const pause: Pause = { sessionId: 'session-1', deferredCall: 'toolu_1', workHead: 'c'.repeat(40) };
const sessionFiles = [
  { path: '.claude.json', content: text('{}') },
  { path: 'projects/-workspace/session-1.jsonl', content: text('{"type":"user"}\n') },
];

const changed: Outcome = {
  protocol: AGENT_PROTOCOL_VERSION,
  runId,
  result: {
    kind: 'change',
    head: 'b'.repeat(40),
    report: {
      outcome: 'change',
      summary: 'Cards stretch',
      changes: [{ file: 'src/Card.css', why: 'stretch' }],
      verification: 'pnpm test passed',
      assumptions: [],
      explanation: '',
    },
  },
  pause: null,
  usage: { turns: 5, durationMs: 60_000, costUsd: 0.5 },
};

const asked: Outcome = {
  protocol: AGENT_PROTOCOL_VERSION,
  runId,
  result: { kind: 'question', question: { text: 'Desktop only?', options: ['Yes', 'No'] } },
  pause,
  usage: { turns: 2, durationMs: 10_000, costUsd: 0.1 },
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'redline-runner-'));
  blobs = new FsBlobStore(dir);
  sandboxes = new FakeSandboxes();
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('SandboxedClaudeRunner', () => {
  it('prepares the whole run when it starts: volumes, input, both phases', async () => {
    expect(await runner().start(await spec())).toEqual({ ok: true });
    expect([...sandboxes.volumes.keys()].sort()).toEqual([
      'redline-run-1-input',
      'redline-run-1-out',
      'redline-run-1-secrets',
      'redline-run-1-session',
      'redline-run-1-workspace',
    ]);
    // The loader put the input and the working copy in place and is gone.
    expect(sandboxes.containers.has('redline-run-1-loader')).toBe(false);
    const setup = sandboxes.containers.get('redline-run-1-setup')?.spec;
    const agent = sandboxes.containers.get('redline-run-1-agent')?.spec;
    expect(setup).toMatchObject({
      command: ['sh', '-c', 'pnpm install --frozen-lockfile'],
      network: 'redline-setup',
      env: { HTTPS_PROXY: 'http://redline:setup-grant@10.89.2.2:3128' },
      mounts: [
        { volume: 'redline-run-1-workspace', target: '/workspace', readOnly: false },
        { volume: 'redline-run-1-secrets', target: '/redline/secrets', readOnly: true },
      ],
    });
    expect(setup?.env).not.toHaveProperty('ANTHROPIC_API_KEY');
    expect(agent).toMatchObject({
      command: null,
      network: 'redline-agent',
      env: { ANTHROPIC_BASE_URL: 'http://10.89.1.2:8788', ANTHROPIC_API_KEY: 'agent-grant' },
      labels: {
        'redline.run': 'run-1',
        'redline.timeout-ms': String(3_600_000 + 60_000),
        'redline.image': IMAGE_ID,
        'redline.model': project().execution.model,
      },
    });
    // Every container runs the image's id: what its name points at later does not matter.
    expect([setup?.image, agent?.image]).toEqual([IMAGE_ID, IMAGE_ID]);
    expect(agent?.env).not.toHaveProperty('CLAUDE_CODE_OAUTH_TOKEN');
    expect(agent?.mounts).toContainEqual({
      volume: 'redline-run-1-input',
      target: '/redline/input',
      readOnly: true,
    });
    // Only the setup runs first.
    expect(sandboxes.started).toEqual(['redline-run-1-setup']);
  });

  it('gives the registries’ secrets to the setup only', async () => {
    const file = path.join(dir, 'npm-token');
    await writeFile(file, 'npm_secret');
    const base = await spec();
    const uploads: string[] = [];
    const upload = sandboxes.upload.bind(sandboxes);
    sandboxes.upload = (container, target, archive) => {
      uploads.push(target);
      return upload(container, target, archive);
    };
    await runner().start({
      ...base,
      execution: { ...base.execution, setupSecrets: { npm: file } },
    });
    expect(uploads).toEqual(['/redline/input', '/redline/secrets', '/workspace']);
    const setup = sandboxes.containers.get('redline-run-1-setup')?.spec;
    const agent = sandboxes.containers.get('redline-run-1-agent')?.spec;
    expect(setup?.mounts).toContainEqual({
      volume: 'redline-run-1-secrets',
      target: '/redline/secrets',
      readOnly: true,
    });
    expect(agent?.mounts.map((mount) => mount.volume)).not.toContain('redline-run-1-secrets');
  });

  it('presents a subscription’s grant as Claude Code’s OAuth token, and no API key', async () => {
    await runner().start(await spec('subscription'));
    const env = sandboxes.containers.get('redline-run-1-agent')?.spec.env;
    expect(env).toMatchObject({ CLAUDE_CODE_OAUTH_TOKEN: 'agent-grant' });
    expect(env).not.toHaveProperty('ANTHROPIC_API_KEY');
  });

  it('runs the setup, then the agent, and takes its change', async () => {
    const agent = runner();
    await agent.start(await spec());
    sandboxes.agentOutput = await outputOf(changed, 'the change bundle');
    const outcome = await agent.observe(runId, new AbortController().signal);
    expect(sandboxes.started).toEqual(['redline-run-1-setup', 'redline-run-1-agent']);
    if (outcome.kind !== 'change') throw new Error(`Expected a change, got ${outcome.kind}`);
    expect(outcome.report.summary).toBe('Cards stretch');
    expect(
      new TextDecoder().decode((await blobs.read(outcome.change.blob)) ?? new Uint8Array()),
    ).toBe('the change bundle');
  });

  it('starts the agent at once when the project has no setup', async () => {
    await runner(null).start(await spec());
    expect(sandboxes.containers.has('redline-run-1-setup')).toBe(false);
    expect(sandboxes.started).toEqual(['redline-run-1-agent']);
  });

  it('attaches to a run a worker started before it restarted, and never starts the agent twice', async () => {
    await runner().start(await spec());
    // A new worker: starting again is a no-op, observing picks up where the run is.
    const restarted = runner();
    expect(await restarted.start(await spec())).toEqual({ ok: true });
    sandboxes.agentOutput = await outputOf(changed, 'bundle');
    await restarted.observe(runId, new AbortController().signal);
    expect(sandboxes.started.filter((name) => name.endsWith('-agent'))).toHaveLength(1);
    expect(sandboxes.started.filter((name) => name.endsWith('-setup'))).toHaveLength(1);
  });

  it('names a failed setup with the end of its output', async () => {
    const agent = runner();
    await agent.start(await spec());
    sandboxes.exits.setup = 1;
    expect(await agent.observe(runId, new AbortController().signal)).toEqual({
      kind: 'failed',
      reason: 'setup-failed',
      detail: 'The project’s setup exited with 1:\nnpm ERR! 404 left-pad',
      snapshot: null,
    });
    expect(sandboxes.started).not.toContain('redline-run-1-agent');
  });

  it('quotes a sandbox’s output without the credentials its URLs carry, and only its end', async () => {
    const agent = runner();
    await agent.start(await spec());
    sandboxes.exits.setup = 1;
    sandboxes.output = `${'x'.repeat(10_000)}\nGET http://redline:setup-grant@10.89.2.2:3128 failed`;
    const outcome = await agent.observe(runId, new AbortController().signal);
    const detail = outcome.kind === 'failed' ? outcome.detail : '';
    expect(detail).toContain('http://***@10.89.2.2:3128');
    expect(detail).not.toContain('setup-grant');
    expect(detail.length).toBeLessThan(4200);
  });

  it('refuses a project whose settings are not valid', async () => {
    expect(await runner('setup: [not, a, map]').start(await spec())).toMatchObject({
      ok: false,
      error: { transient: false },
    });
  });

  it('refuses to start when sandboxes cannot be isolated as configured', async () => {
    sandboxes.unfitReason = 'Docker has no runsc runtime';
    expect(await runner().start(await spec())).toEqual({
      ok: false,
      error: { transient: false, detail: 'Docker has no runsc runtime' },
    });
    expect(sandboxes.containers.size).toBe(0);
  });

  it('reports an agent that left no outcome, and a sandbox that is gone', async () => {
    const agent = runner(null);
    await agent.start(await spec());
    sandboxes.agentOutput = null;
    expect(await agent.observe(runId, new AbortController().signal)).toMatchObject({
      kind: 'failed',
      reason: 'infra',
    });
    await agent.release(runId);
    expect(await agent.observe(runId, new AbortController().signal)).toEqual({
      kind: 'lost',
      detail: 'The run’s sandbox is gone',
    });
    expect(sandboxes.volumes.size).toBe(0);
    expect(await agent.live()).toEqual([]);
  });

  it('stops watching when the worker shuts down, leaving the run to go on', async () => {
    const agent = runner(null);
    await agent.start(await spec());
    sandboxes.hangAgent = true;
    const stopping = new AbortController();
    const watching = agent.observe(runId, stopping.signal);
    stopping.abort();
    await watching;
    expect(sandboxes.containers.get('redline-run-1-agent')?.state.status).toBe('running');
    expect(await agent.live()).toEqual([runId]);
  });

  it('gives agent-host its brief and the bundle as protocol files', async () => {
    const files = await filesOf(
      Readable.from([
        await tarOf([{ path: 'brief.json', content: new TextEncoder().encode('{}') }], {
          uid: 1000,
          gid: 1000,
        }),
      ]),
      (name) => name === 'brief.json',
      { file: 1024 },
    );
    expect(files.get('brief.json')?.toString()).toBe('{}');
  });

  it('refuses to start without the image, rather than pull one', async () => {
    sandboxes.images.clear();
    expect(await runner().start(await spec())).toMatchObject({
      ok: false,
      error: { transient: false, detail: expect.stringContaining('no image') as string },
    });
  });

  describe('paused sessions', () => {
    it('keeps the session a run paused with: its work, its files, its image and model', async () => {
      const agent = runner(null);
      await agent.start(await spec());
      sandboxes.agentOutput = await outputOf(asked, null, 'the work bundle');
      sandboxes.sessionArchive = await tarOf(
        [...sessionFiles, { path: 'settings.json', content: text('{"hooks":{}}') }].map((file) => ({
          ...file,
          path: `session/${file.path}`,
        })),
        { uid: 1000, gid: 1000 },
      );
      const outcome = await agent.observe(runId, new AbortController().signal);
      if (outcome.kind !== 'question') throw new Error(`Expected a question, got ${outcome.kind}`);
      expect(outcome.question).toEqual({
        id: QuestionId('q-run-1'),
        text: 'Desktop only?',
        options: ['Yes', 'No'],
      });
      expect(outcome.snapshot).toMatchObject({
        image: IMAGE_ID,
        model: project().execution.model,
        questionId: QuestionId('q-run-1'),
      });
      const stored = await blobs.read(outcome.snapshot?.blob ?? BlobDigest('0'.repeat(64)));
      const paused = await unpackSnapshot(stored ?? new Uint8Array());
      expect(paused.pause).toEqual(pause);
      expect(new TextDecoder().decode(paused.work ?? new Uint8Array())).toBe('the work bundle');
      // Only the transcripts are kept: the settings the agent wrote stay behind.
      expect(paused.session.map((file) => file.path)).toEqual([
        'projects/-workspace/session-1.jsonl',
      ]);
    });

    it('asks anyway when the session cannot be kept: the next run starts over', async () => {
      const agent = runner(null);
      await agent.start(await spec());
      // The pause names work that agent-host did not leave.
      sandboxes.agentOutput = await outputOf(asked, null);
      sandboxes.sessionArchive = await tarOf([], { uid: 1000, gid: 1000 });
      expect(await agent.observe(runId, new AbortController().signal)).toMatchObject({
        kind: 'question',
        snapshot: null,
      });
    });

    it('gives the run that goes on the session back, where agent-host looks for it', async () => {
      const writer = blobs.writer();
      await writer.write(await packSnapshot({ pause, work: text('work'), session: sessionFiles }));
      const { digest } = await writer.commit();
      const base = await spec();
      await runner(null).start({
        ...base,
        resumeFrom: {
          blob: BlobDigest(digest),
          image: IMAGE_ID,
          model: project().execution.model,
          questionId: QuestionId('q-run-0'),
        },
      });
      const into = async (target: string) => {
        const upload = sandboxes.uploaded.find((entry) => entry.target === target);
        return filesOf(Readable.from([upload?.archive ?? Buffer.alloc(0)]), () => true, {
          file: 1 << 20,
        });
      };
      const input = await into('/redline/input');
      expect(JSON.parse(input.get('brief.json')?.toString() ?? '{}')).toMatchObject({
        resume: pause,
      });
      expect(input.get('work.bundle')?.toString()).toBe('work');
      expect([...(await into('/redline/session')).keys()].sort()).toEqual([
        '.claude.json',
        'projects/-workspace/session-1.jsonl',
      ]);
    });

    it('resumes a session only on the image and model that wrote it, while it is stored', async () => {
      const writer = blobs.writer();
      await writer.write(await packSnapshot({ pause, work: null, session: sessionFiles }));
      const { digest } = await writer.commit();
      const snapshot = {
        blob: BlobDigest(digest),
        image: IMAGE_ID,
        model: project().execution.model,
        questionId: null,
      };
      const execution = project().execution;
      const agent = runner();
      expect(await agent.resumable(snapshot, execution)).toBe(true);
      expect(await agent.resumable({ ...snapshot, model: 'claude-other' }, execution)).toBe(false);
      expect(
        await agent.resumable({ ...snapshot, blob: BlobDigest('f'.repeat(64)) }, execution),
      ).toBe(false);
      // The image was rebuilt: its name points at another id now.
      sandboxes.images.set(execution.image, 'sha256:9f8e');
      expect(await agent.resumable(snapshot, execution)).toBe(false);
    });
  });
});
