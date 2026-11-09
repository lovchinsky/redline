import { RUN_LAYOUT, RUN_OUTPUTS, outcomeSchema } from '@redline/agent-protocol';
import type { Readable } from 'node:stream';
import { BlobDigest, RunId, type TaskId } from '../../domain/ids';
import type { RunOutcome } from '../../domain/run';
import type { RepositoryRef } from '../../ports/access';
import type { AgentRunner, RunnerError, RunSpec } from '../../ports/agent';
import type { BlobStore } from '../../ports/bundles';
import type { Logger } from '../../ports/system';
import { briefOf, runOutcomeOf } from './exchange';
import { REPOSITORY_SETTINGS, parseRepositorySettings } from './repository-settings';
import type { ContainerSpec, Mount, SandboxProvider } from './sandbox';
import { filesOf, tarOf, type TarFile } from './tar';

/** What the runner needs of the receiver's mirrors: a task's working copy and files at its base. */
export interface SourceTrees {
  workingCopy(repository: RepositoryRef, taskId: TaskId): Promise<Readable>;
  fileAt(repository: RepositoryRef, sha: string, file: string): Promise<string | null>;
}

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

/** How much longer a container may run, by its start and the time limit it was created with. */
const remaining = (container: { labels: Readonly<Record<string, string>>; startedAt: number }) =>
  Math.max(container.startedAt + Number(container.labels[TIMEOUT_LABEL] ?? 0) - Date.now(), 0);
const OUTPUT_LIMIT = 256 * 1024 * 1024;
const OUT_DIRECTORY = RUN_LAYOUT.out.split('/').at(-1) ?? 'out';

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
 */
export class SandboxedClaudeRunner implements AgentRunner {
  constructor(
    private readonly deps: {
      readonly sandboxes: SandboxProvider;
      readonly sources: SourceTrees;
      readonly blobs: BlobStore;
      readonly settings: SandboxSettings;
      readonly logger: Logger;
    },
  ) {}

  async start(
    spec: RunSpec,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: RunnerError }> {
    const { sandboxes, settings } = this.deps;
    const names = containers(spec.runId);
    try {
      const unfit = await sandboxes.unfit([settings.networks.setup, settings.networks.agent]);
      if (unfit !== null) return { ok: false, error: { transient: false, detail: unfit } };
      if ((await sandboxes.state(names.agent)).status !== 'missing') return { ok: true };

      const repository = await this.deps.sources.fileAt(
        spec.repository,
        spec.baseSha,
        REPOSITORY_SETTINGS,
      );
      const repositorySettings = parseRepositorySettings(repository);
      if (!repositorySettings.ok) {
        return { ok: false, error: { transient: false, detail: repositorySettings.detail } };
      }
      const labels = { [RUN_LABEL]: spec.runId, 'redline.task': spec.taskId };
      const run = volumes(spec.runId);
      for (const volume of Object.values(run)) await sandboxes.createVolume(volume, labels);

      await this.load(spec, briefOf(spec, repositorySettings.value), labels);
      const setup = repositorySettings.value.setup;
      if (setup !== null) {
        const timeoutMs = Math.min(
          setup.timeoutMs ?? settings.setupTimeoutMs,
          settings.setupTimeoutMs,
        );
        await sandboxes.create(
          this.setupSpec(spec, setup.run, { ...labels, [TIMEOUT_LABEL]: String(timeoutMs) }),
        );
      }
      // agent-host keeps to the run's time limit; past it and the grace, the worker stops it.
      const agentTimeout = spec.execution.timeoutMs + settings.graceMs;
      await sandboxes.create(
        this.agentSpec(spec, { ...labels, [TIMEOUT_LABEL]: String(agentTimeout) }),
      );
      await sandboxes.start(setup === null ? names.agent : names.setup);
      return { ok: true };
    } catch (error) {
      this.deps.logger.error('A run could not be started', {
        runId: spec.runId,
        error: String(error),
      });
      return { ok: false, error: { transient: true, detail: String(error) } };
    }
  }

  async observe(
    runId: RunId,
    signal: AbortSignal,
  ): Promise<RunOutcome | { kind: 'lost'; detail: string }> {
    const { sandboxes } = this.deps;
    const names = containers(runId);
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
        const timer = AbortSignal.timeout(remaining(setup));
        const code = await sandboxes.wait(names.setup, AbortSignal.any([signal, timer]));
        if (code === null && timer.aborted) {
          // Neither phase is left to run: a worker that looks again finds the run gone.
          await sandboxes.remove(names.agent);
          await sandboxes.remove(names.setup);
          return {
            kind: 'failed',
            reason: 'setup-failed',
            detail: 'The project’s setup took too long',
            snapshot: null,
          };
        }
        continue;
      }
      if (setup.status === 'exited' && setup.exitCode !== 0) {
        const output = await sandboxes.logs(names.setup, 40);
        return {
          kind: 'failed',
          reason: 'setup-failed',
          detail: `The project’s setup exited with ${String(setup.exitCode)}:\n${output.trim()}`,
          snapshot: null,
        };
      }
      if (agent.status === 'created') {
        await sandboxes.start(names.agent);
        continue;
      }
      if (agent.status === 'running') {
        const timer = AbortSignal.timeout(remaining(agent));
        const code = await sandboxes.wait(names.agent, AbortSignal.any([signal, timer]));
        if (code === null && timer.aborted) {
          await sandboxes.remove(names.agent);
          return {
            kind: 'failed',
            reason: 'agent-failed',
            detail: 'The agent’s sandbox outlived its time',
            snapshot: null,
          };
        }
        continue;
      }
      return this.collect(runId, agent.exitCode);
    }
  }

  async abort(runId: RunId): Promise<void> {
    const names = containers(runId);
    await this.deps.sandboxes.remove(names.agent);
    await this.deps.sandboxes.remove(names.setup);
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

  /** Puts the working copy and the run's input on its volumes, through a container that never runs. */
  private async load(
    spec: RunSpec,
    brief: ReturnType<typeof briefOf>,
    labels: Record<string, string>,
  ) {
    const { sandboxes, settings } = this.deps;
    const run = volumes(spec.runId);
    const loader = containers(spec.runId).loader;
    const files: TarFile[] = [
      { path: 'brief.json', content: new TextEncoder().encode(JSON.stringify(brief)) },
    ];
    for (const file of spec.brief.bundle.files) {
      const content = await this.deps.blobs.read(file.digest);
      if (content === null) throw new Error(`The bundle file ${file.path} is no longer stored`);
      files.push({ path: `bundle/${file.path}`, content });
    }
    await sandboxes.remove(loader);
    await sandboxes.create({
      name: loader,
      image: spec.execution.image,
      command: ['true'],
      env: {},
      workdir: '/',
      mounts: [
        { volume: run.workspace, target: RUN_LAYOUT.workspace, readOnly: false },
        { volume: run.input, target: RUN_LAYOUT.input, readOnly: false },
      ],
      network: 'none',
      labels,
      limits: settings.limits,
    });
    try {
      await sandboxes.upload(loader, RUN_LAYOUT.input, await tarOf(files, settings.user));
      await sandboxes.upload(
        loader,
        RUN_LAYOUT.workspace,
        await this.deps.sources.workingCopy(spec.repository, spec.taskId),
      );
    } finally {
      await sandboxes.remove(loader);
    }
  }

  private setupSpec(spec: RunSpec, command: string, labels: Record<string, string>): ContainerSpec {
    const { settings } = this.deps;
    const egress = new URL(settings.gateway.egress);
    const proxy = `http://redline:${encodeURIComponent(spec.grants.setup)}@${egress.host}`;
    return {
      name: containers(spec.runId).setup,
      image: spec.execution.image,
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
      },
      workdir: RUN_LAYOUT.workspace,
      mounts: [
        { volume: volumes(spec.runId).workspace, target: RUN_LAYOUT.workspace, readOnly: false },
      ],
      network: settings.networks.setup,
      labels: { ...labels, 'redline.phase': 'setup' },
      limits: settings.limits,
    };
  }

  private agentSpec(spec: RunSpec, labels: Record<string, string>): ContainerSpec {
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
      image: spec.execution.image,
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
      limits: settings.limits,
    };
  }

  /** Reads what agent-host left and stores what the receiver keeps. */
  private async collect(runId: RunId, exitCode: number): Promise<RunOutcome> {
    const { sandboxes } = this.deps;
    const agent = containers(runId).agent;
    const archive = await sandboxes.download(agent, RUN_LAYOUT.out);
    const path = (file: string) => `${OUT_DIRECTORY}/${file}`;
    const files =
      archive === null
        ? new Map<string, Buffer>()
        : await filesOf(
            archive,
            new Set([
              path(RUN_OUTPUTS.outcome),
              path(RUN_OUTPUTS.change),
              path(RUN_OUTPUTS.events),
            ]),
            OUTPUT_LIMIT,
          );
    const events = files.get(path(RUN_OUTPUTS.events));
    if (events !== undefined) {
      const stored = await this.store(events);
      this.deps.logger.info('Kept the run’s journal', { runId, journal: stored });
    }
    const raw = files.get(path(RUN_OUTPUTS.outcome));
    if (raw === undefined) {
      const output = await sandboxes.logs(agent, 40);
      return infra(
        `agent-host exited with ${String(exitCode)} and left no outcome:\n${output.trim()}`,
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
    const bundle = files.get(path(RUN_OUTPUTS.change));
    const change =
      parsed.data.result.kind === 'change' && bundle !== undefined
        ? await this.store(bundle)
        : null;
    return runOutcomeOf(parsed.data, change);
  }

  private async store(bytes: Uint8Array): Promise<BlobDigest> {
    const writer = this.deps.blobs.writer();
    await writer.write(bytes);
    return BlobDigest((await writer.commit()).digest);
  }
}
