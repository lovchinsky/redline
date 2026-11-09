import { RUN_LAYOUT, RUN_OUTPUTS, outcomeSchema, type Pause } from '@redline/agent-protocol';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { BlobDigest, RunId } from '../../domain/ids';
import { err, ok, type Result } from '../../domain/result';
import type { RunOutcome } from '../../domain/run';
import type { Snapshot } from '../../domain/work';
import type { ExecutionProfile } from '../../ports/access';
import type { AgentRunner, RunPhases, RunSpec } from '../../ports/agent';
import type { BlobStore } from '../../ports/bundles';
import type { SourceTrees } from '../../ports/source';
import type { Clock, Logger } from '../../ports/system';
import { briefOf, runOutcomeOf, type StoredOutputs } from './exchange';
import type { ContainerSpec, ContainerState, Mount, SandboxProvider } from './sandbox';
import { packSnapshot, sessionFilesOf, unpackSnapshot, type PausedSession } from './snapshot';
import { OversizedArchive, filesOf, ownedBy, tarOf, type TarFile } from './tar';

export interface SandboxSettings {
  /** `uid:gid` the sandboxes run as, and own their files as. */
  readonly user: { readonly uid: number; readonly gid: number };
  /** Docker networks of each phase: internal, with the gateway the only other member. */
  readonly networks: { readonly setup: string; readonly agent: string };
  /** The gateway's addresses on those networks. */
  readonly gateway: { readonly model: string; readonly egress: string };
  readonly limits: { readonly cpus: number; readonly memoryBytes: number; readonly pids: number };
  /** The longest a project's setup may take. */
  readonly setupTimeoutMs: number;
  /** How long past its own time limit a run's sandbox is left before it is stopped. */
  readonly graceMs: number;
}

/** The label every container and volume of a run carries: its run id. */
export const RUN_LABEL = 'redline.run';
/** How long a phase's container may run before the worker stops it, in milliseconds. */
const TIMEOUT_LABEL = 'redline.timeout-ms';
/** The id of the image the run's containers run, and the model its agent uses. */
const IMAGE_LABEL = 'redline.image';
const MODEL_LABEL = 'redline.model';

/** The time limit a container was created with. */
const limitOf = (container: { readonly labels: Readonly<Record<string, string>> }): number =>
  Number(container.labels[TIMEOUT_LABEL] ?? 0);

/**
 * Whether an exited container ran to its time limit: the worker killed it there. Read from the
 * container itself, a worker that looks again after a restart concludes the same.
 */
const outlived = (container: Extract<ContainerState, { status: 'exited' }>): boolean =>
  container.finishedAt - container.startedAt >= limitOf(container);
/** The files of a run's outputs the receiver takes. */
const OUTPUTS: ReadonlySet<string> = new Set(Object.values(RUN_OUTPUTS));
/** The most a run's outputs may take, all together. */
const OUTPUT_LIMIT = 256 * 1024 * 1024;
/** Where the setup phase finds the project's registry secrets; the agent has no such directory. */
export const SETUP_SECRETS = '/redline/secrets';
/** The most of a sandbox's output a failure quotes. */
const EXCERPT_LIMIT = 4000;

/**
 * The end of a sandbox's output, to quote in a failure: cut to a length, and without the
 * credentials URLs may carry (a setup's proxy holds its grant). It is still the sandbox's text.
 */
const excerptOf = (output: string): string => {
  const quoted = output.trim().replace(/(\w+:\/\/)[^/\s@]+@/g, '$1***@');
  return quoted.length <= EXCERPT_LIMIT ? quoted : `…${quoted.slice(-EXCERPT_LIMIT)}`;
};

/** A path of the run's input, as it stands in the input volume. */
const inInput = (path: string) => path.slice(RUN_LAYOUT.input.length + 1);

const containers = (runId: RunId) => ({
  loader: `redline-${runId}-loader`,
  setup: `redline-${runId}-setup`,
  agent: `redline-${runId}-agent`,
});
const volumes = (runId: RunId) => ({
  workspace: `redline-${runId}-workspace`,
  input: `redline-${runId}-input`,
  out: `redline-${runId}-out`,
  session: `redline-${runId}-session`,
  secrets: `redline-${runId}-secrets`,
});

const infra = (detail: string): RunOutcome => ({
  kind: 'failed',
  reason: 'infra',
  detail,
  snapshot: null,
});

/**
 * The coding agent in a sandbox. A run is two containers on the run's own volumes: the setup
 * (the project's install, with its registries and nothing else) and the agent (agent-host, with
 * the model through the gateway and nothing else). Everything about a run is decided when it
 * starts and kept in Docker, so a worker that restarts attaches to the run where it is: the
 * agent is never started twice.
 *
 * A run that pauses leaves a snapshot: its work, Claude Code's files of the session, and the
 * image and model that wrote them. A run that goes on with it gets the same files back in new
 * sandboxes, whose setup works on the base as the first run's did.
 */
export class SandboxedClaudeRunner implements AgentRunner {
  constructor(
    private readonly deps: {
      readonly sandboxes: SandboxProvider;
      readonly sources: SourceTrees;
      readonly blobs: BlobStore;
      readonly settings: SandboxSettings;
      readonly clock: Clock;
      readonly logger: Logger;
    },
  ) {}

  /** Waits for a running container to exit, and kills it at its time limit. */
  private async waitOut(
    container: string,
    state: Extract<ContainerState, { status: 'running' }>,
    signal: AbortSignal,
  ): Promise<void> {
    const left = Math.max(state.startedAt + limitOf(state) - this.deps.clock.now(), 0);
    const timer = AbortSignal.timeout(left);
    const code = await this.deps.sandboxes.wait(container, AbortSignal.any([signal, timer]));
    if (code === null && timer.aborted && !signal.aborted)
      await this.deps.sandboxes.kill(container);
  }

  async start(spec: RunSpec): Promise<Result<undefined, { readonly detail: string }>> {
    const { sandboxes, settings } = this.deps;
    const names = containers(spec.runId);
    try {
      const unfit = await sandboxes.unfit([settings.networks.setup, settings.networks.agent]);
      if (unfit !== null) return err({ detail: unfit });
      if ((await sandboxes.state(names.agent)).status !== 'missing') return ok(undefined);

      // Every container of the run runs this very image, whatever its name points at later.
      const image = await sandboxes.imageId(spec.execution.image);
      if (image === null) {
        return err({ detail: `Docker has no image ${spec.execution.image}` });
      }
      const paused = spec.resume === null ? null : await this.pausedSession(spec.resume.snapshot);
      const labels = {
        [RUN_LABEL]: spec.runId,
        'redline.task': spec.taskId,
        [IMAGE_LABEL]: image,
        [MODEL_LABEL]: spec.execution.model,
      };
      const run = volumes(spec.runId);
      for (const volume of Object.values(run)) await sandboxes.createVolume(volume, labels);

      const brief = briefOf(spec, paused?.pause ?? null);
      await this.load(spec, { brief, paused, image }, labels);
      const { setup } = spec;
      if (setup !== null) {
        const timeoutMs = Math.min(
          setup.timeoutMs ?? settings.setupTimeoutMs,
          settings.setupTimeoutMs,
        );
        await sandboxes.create(
          this.setupSpec(spec, image, setup.run, {
            ...labels,
            [TIMEOUT_LABEL]: String(timeoutMs),
          }),
        );
      }
      // agent-host keeps to the run's time limit; past it and the grace, the worker stops it.
      const agentTimeout = spec.execution.timeoutMs + settings.graceMs;
      await sandboxes.create(
        this.agentSpec(spec, image, { ...labels, [TIMEOUT_LABEL]: String(agentTimeout) }),
      );
      await sandboxes.start(setup === null ? names.agent : names.setup);
      return ok(undefined);
    } catch (error) {
      this.deps.logger.error('A run could not be started', {
        runId: spec.runId,
        error: String(error),
      });
      return err({ detail: String(error) });
    }
  }

  async observe(
    runId: RunId,
    signal: AbortSignal,
    phases: RunPhases,
  ): Promise<RunOutcome | { kind: 'lost'; detail: string }> {
    const { sandboxes } = this.deps;
    const names = containers(runId);
    let setupDone = false;
    for (;;) {
      if (signal.aborted) return infra('The worker stopped watching');
      const setup = await sandboxes.state(names.setup);
      const agent = await sandboxes.state(names.agent);
      if (agent.status === 'missing') return { kind: 'lost', detail: 'The run’s sandbox is gone' };

      if (setup.status === 'created') {
        await sandboxes.start(names.setup);
        continue;
      }
      if (setup.status === 'running') {
        await this.waitOut(names.setup, setup, signal);
        continue;
      }
      if (setup.status === 'exited' && outlived(setup)) {
        return {
          kind: 'failed',
          reason: 'setup-failed',
          detail: 'The project’s setup took too long',
          snapshot: null,
        };
      }
      if (setup.status === 'exited' && setup.exitCode !== 0) {
        const output = await sandboxes.logs(names.setup, 40);
        return {
          kind: 'failed',
          reason: 'setup-failed',
          detail: `The project’s setup exited with ${String(setup.exitCode)}:\n${excerptOf(output)}`,
          snapshot: null,
        };
      }
      if (!setupDone) {
        await phases.setupDone();
        setupDone = true;
      }
      if (agent.status === 'created') {
        await sandboxes.start(names.agent);
        continue;
      }
      if (agent.status === 'running') {
        await this.waitOut(names.agent, agent, signal);
        continue;
      }
      if (outlived(agent)) {
        return {
          kind: 'failed',
          reason: 'agent-failed',
          detail: 'The agent’s sandbox outlived its time',
          snapshot: null,
        };
      }
      return this.collect(runId, agent.exitCode, agent.labels);
    }
  }

  async release(runId: RunId): Promise<void> {
    const { sandboxes } = this.deps;
    for (const name of Object.values(containers(runId))) await sandboxes.remove(name);
    for (const name of Object.values(volumes(runId))) await sandboxes.removeVolume(name);
  }

  async live(): Promise<readonly RunId[]> {
    const labelled = await this.deps.sandboxes.labelled(RUN_LABEL);
    return [...new Set(labelled.map((entry) => entry.value))].map(RunId);
  }

  async resumable(snapshot: Snapshot, execution: ExecutionProfile): Promise<boolean> {
    if (snapshot.model !== execution.model) return false;
    if ((await this.deps.sandboxes.imageId(execution.image)) !== snapshot.image) return false;
    return this.deps.blobs.has(snapshot.blob);
  }

  private async pausedSession(snapshot: Snapshot): Promise<PausedSession> {
    const bytes = await this.deps.blobs.read(snapshot.blob);
    if (bytes === null) throw new Error('The paused session is no longer stored');
    return unpackSnapshot(bytes);
  }

  /**
   * Puts the working copy, the run's input and the paused session it goes on with on its
   * volumes, through a container that never runs.
   */
  private async load(
    spec: RunSpec,
    input: {
      readonly brief: ReturnType<typeof briefOf>;
      readonly paused: PausedSession | null;
      readonly image: string;
    },
    labels: Record<string, string>,
  ) {
    const { sandboxes, settings } = this.deps;
    const { brief, paused } = input;
    const run = volumes(spec.runId);
    const loader = containers(spec.runId).loader;
    const files: TarFile[] = [
      {
        path: inInput(RUN_LAYOUT.brief),
        content: new TextEncoder().encode(JSON.stringify(brief)),
      },
    ];
    if (paused?.work != null) files.push({ path: inInput(RUN_LAYOUT.work), content: paused.work });
    for (const file of spec.brief.bundle.files) {
      const content = await this.deps.blobs.read(file.digest);
      if (content === null) throw new Error(`The bundle file ${file.path} is no longer stored`);
      files.push({ path: `${inInput(RUN_LAYOUT.bundle)}/${file.path}`, content });
    }
    await sandboxes.remove(loader);
    await sandboxes.create({
      name: loader,
      image: input.image,
      command: ['true'],
      env: {},
      workdir: '/',
      mounts: [
        { volume: run.workspace, target: RUN_LAYOUT.workspace, readOnly: false },
        { volume: run.input, target: RUN_LAYOUT.input, readOnly: false },
        { volume: run.session, target: RUN_LAYOUT.session, readOnly: false },
        { volume: run.secrets, target: SETUP_SECRETS, readOnly: false },
      ],
      network: 'none',
      labels,
      user: settings.user,
      limits: settings.limits,
    });
    try {
      await sandboxes.upload(loader, RUN_LAYOUT.input, await tarOf(files, settings.user));
      const secrets: TarFile[] = [];
      for (const [name, file] of Object.entries(spec.execution.setupSecrets)) {
        secrets.push({ path: name, content: await readFile(file) });
      }
      if (secrets.length > 0) {
        await sandboxes.upload(
          loader,
          SETUP_SECRETS,
          await tarOf(secrets, settings.user, { file: 0o400 }),
        );
      }
      if (paused !== null && paused.session.length > 0) {
        // Claude Code goes on writing to the session's files: they stay the agent's own.
        await sandboxes.upload(
          loader,
          RUN_LAYOUT.session,
          await tarOf(paused.session, settings.user, { file: 0o600, directory: 0o700 }),
        );
      }
      await sandboxes.upload(
        loader,
        RUN_LAYOUT.workspace,
        ownedBy(
          Readable.fromWeb(await this.deps.sources.workingCopy(spec.repository, spec.baseSha)),
          settings.user,
        ),
      );
    } finally {
      await sandboxes.remove(loader);
    }
  }

  private setupSpec(
    spec: RunSpec,
    image: string,
    command: string,
    labels: Record<string, string>,
  ): ContainerSpec {
    const { settings } = this.deps;
    const egress = new URL(settings.gateway.egress);
    const proxy = `http://redline:${encodeURIComponent(spec.grants.setup)}@${egress.host}`;
    return {
      name: containers(spec.runId).setup,
      image,
      command: ['sh', '-c', command],
      env: {
        HOME: '/tmp',
        CI: '1',
        HTTPS_PROXY: proxy,
        https_proxy: proxy,
        HTTP_PROXY: proxy,
        http_proxy: proxy,
        npm_config_proxy: proxy,
        npm_config_https_proxy: proxy,
        REDLINE_SECRETS: SETUP_SECRETS,
      },
      workdir: RUN_LAYOUT.workspace,
      mounts: [
        { volume: volumes(spec.runId).workspace, target: RUN_LAYOUT.workspace, readOnly: false },
        { volume: volumes(spec.runId).secrets, target: SETUP_SECRETS, readOnly: true },
      ],
      network: settings.networks.setup,
      labels: { ...labels, 'redline.phase': 'setup' },
      user: settings.user,
      limits: settings.limits,
    };
  }

  private agentSpec(spec: RunSpec, image: string, labels: Record<string, string>): ContainerSpec {
    const { settings } = this.deps;
    const run = volumes(spec.runId);
    const mounts: Mount[] = [
      { volume: run.workspace, target: RUN_LAYOUT.workspace, readOnly: false },
      { volume: run.input, target: RUN_LAYOUT.input, readOnly: true },
      { volume: run.out, target: RUN_LAYOUT.out, readOnly: false },
      { volume: run.session, target: RUN_LAYOUT.session, readOnly: false },
    ];
    // The grant stands where Claude Code looks for this kind of credential, and only there.
    const grant =
      spec.credential === 'api-key'
        ? { ANTHROPIC_API_KEY: spec.grants.agent }
        : { CLAUDE_CODE_OAUTH_TOKEN: spec.grants.agent };
    return {
      name: containers(spec.runId).agent,
      image,
      command: null,
      env: {
        HOME: '/tmp',
        ANTHROPIC_BASE_URL: settings.gateway.model,
        ...grant,
        // One model for everything the agent asks, the one the gateway lets through.
        ANTHROPIC_MODEL: spec.execution.model,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: spec.execution.model,
        ANTHROPIC_SMALL_FAST_MODEL: spec.execution.model,
      },
      workdir: RUN_LAYOUT.workspace,
      mounts,
      network: settings.networks.agent,
      labels: { ...labels, 'redline.phase': 'agent' },
      user: settings.user,
      limits: settings.limits,
    };
  }

  /** Reads what agent-host left and stores what the receiver keeps. */
  private async collect(
    runId: RunId,
    exitCode: number,
    labels: Readonly<Record<string, string>>,
  ): Promise<RunOutcome> {
    const { sandboxes } = this.deps;
    const agent = containers(runId).agent;
    const archive = await sandboxes.download(agent, RUN_LAYOUT.out);
    let files = new Map<string, Buffer>();
    try {
      if (archive !== null) {
        files = await filesOf(archive, (name) => OUTPUTS.has(name), {
          file: OUTPUT_LIMIT,
          total: OUTPUT_LIMIT,
        });
      }
    } catch (error) {
      // Any other failure is the download's: whoever looks next reads the outputs again.
      if (!(error instanceof OversizedArchive)) throw error;
      return {
        kind: 'failed',
        reason: 'agent-failed',
        detail: `The run left more than the receiver takes: ${error.message}`,
        snapshot: null,
      };
    }
    const events = files.get(RUN_OUTPUTS.events);
    if (events !== undefined) {
      const stored = await this.store(events);
      this.deps.logger.info('Kept the run’s journal', { runId, journal: stored });
    }
    const raw = files.get(RUN_OUTPUTS.outcome);
    if (raw === undefined) {
      const output = await sandboxes.logs(agent, 40);
      return infra(
        `agent-host exited with ${String(exitCode)} and left no outcome:\n${excerptOf(output)}`,
      );
    }
    let document: unknown;
    try {
      document = JSON.parse(raw.toString('utf8'));
    } catch {
      document = null;
    }
    const parsed = outcomeSchema.safeParse(document);
    if (!parsed.success || parsed.data.runId !== runId)
      return infra('agent-host left an outcome the receiver cannot read');
    // The SDK's own estimate, beside what the gateway metered: the two are compared, not added.
    this.deps.logger.info('The run ended', {
      runId,
      result: parsed.data.result.kind,
      turns: parsed.data.usage.turns,
      estimatedCostUsd: parsed.data.usage.costUsd,
    });
    const bundle = files.get(RUN_OUTPUTS.change);
    const stored: StoredOutputs = {
      change:
        parsed.data.result.kind === 'change' && bundle !== undefined
          ? await this.store(bundle)
          : null,
      session:
        parsed.data.pause === null
          ? null
          : await this.keepSession(runId, labels, parsed.data.pause, files.get(RUN_OUTPUTS.work)),
    };
    return runOutcomeOf(parsed.data, stored);
  }

  /**
   * Stores a paused session for the run that goes on with it. A session that cannot be kept is
   * not an error of the run: the next run starts over, told the exchanges so far.
   */
  private async keepSession(
    runId: RunId,
    labels: Readonly<Record<string, string>>,
    pause: Pause,
    work: Uint8Array | undefined,
  ): Promise<StoredOutputs['session']> {
    const image = labels[IMAGE_LABEL];
    const model = labels[MODEL_LABEL];
    try {
      if (image === undefined || model === undefined) throw new Error('The run is not labelled');
      if (pause.workHead !== null && work === undefined) throw new Error('The work is missing');
      const archive = await this.deps.sandboxes.download(
        containers(runId).agent,
        RUN_LAYOUT.session,
      );
      if (archive === null) throw new Error('The session left no files');
      const blob = await this.store(
        await packSnapshot({
          pause,
          work: pause.workHead === null ? null : (work ?? null),
          session: await sessionFilesOf(archive),
        }),
      );
      return { blob, image, model };
    } catch (error) {
      this.deps.logger.warn('The paused session could not be kept', {
        runId,
        error: String(error),
      });
      return null;
    }
  }

  private async store(bytes: Uint8Array): Promise<BlobDigest> {
    const writer = this.deps.blobs.writer();
    await writer.write(bytes);
    return BlobDigest((await writer.commit()).digest);
  }
}
