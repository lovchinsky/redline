import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { FsBlobStore } from '../adapters/blobs/fs-blob-store';
import { StoredBundles } from '../adapters/blobs/stored-bundles';
import { ConfiguredProjects, parseConfig, type ReceiverConfig } from '../adapters/config/config';
import { buildApi } from '../adapters/http/server';
import { migrate, openDatabase } from '../adapters/postgres/database';
import { PgBossJobs, type WorkerLimits } from '../adapters/postgres/jobs';
import { PostgresStore } from '../adapters/postgres/store';
import { PostgresUsers } from '../adapters/postgres/users';
import { ScriptedGit } from '../adapters/scripted/scripted-git';
import { ScriptedRunner } from '../adapters/scripted/scripted-runner';
import { GitMirrors } from '../adapters/git/git-mirrors';
import { LocalRemotes } from '../adapters/git/remotes';
import { GitleaksScanner } from '../adapters/git/gitleaks-scanner';
import { GitHubApi } from '../adapters/github/api';
import { AppAuth, TokenAuth, type GitHubAuth } from '../adapters/github/auth';
import { GitHubHost } from '../adapters/github/github-host';
import { DockerSandboxes } from '../adapters/runner-claude/docker-sandboxes';
import { SandboxedClaudeRunner } from '../adapters/runner-claude/sandboxed-runner';
import { jsonLogger, randomIds, systemClock } from '../adapters/system/system';
import { createEgressProxy } from '../adapters/gateway/egress-proxy';
import { createModelProxy } from '../adapters/gateway/model-proxy';
import { PostgresGateway } from '../adapters/postgres/gateway-store';
import { EmptyVault } from '../adapters/vault/empty-vault';
import { MemoryVault } from '../adapters/vault/memory-vault';
import { SocketVault, serveVault } from '../adapters/vault/socket-vault';
import { EgressGate, ModelGateway } from '../application/gateway';
import { CredentialRelay } from '../application/credentials';
import { TaskOperations } from '../application/operations';
import { PublishChange } from '../application/publish-change';
import { TaskRequests } from '../application/requests';
import { SuperviseRun } from '../application/supervise-run';
import { ReleaseStrays } from '../application/runs';
import { TaskJobs } from '../application/task-jobs';
import { TaskWriter } from '../application/task-writer';
import { ModelCredential, type CredentialVault } from '../ports/access';
import type { AgentRunner } from '../ports/agent';
import type { BlobStore } from '../ports/bundles';
import type { Logger } from '../ports/system';
import type { Settings } from './settings';

/**
 * Which parts of the receiver one process runs: the API, the worker, the gateway's model side
 * (with the vault of requesters' credentials), its egress side, or all of them at once.
 */
export type Role = 'api' | 'worker' | 'gateway' | 'egress' | 'all';

interface Parts {
  readonly api: boolean;
  readonly worker: boolean;
  /** The gateway's model side. */
  readonly gateway: boolean;
  readonly egress: boolean;
}

const PARTS: Record<Role, Parts> = {
  api: { api: true, worker: false, gateway: false, egress: false },
  worker: { api: false, worker: true, gateway: false, egress: false },
  gateway: { api: false, worker: false, gateway: true, egress: false },
  egress: { api: false, worker: false, gateway: false, egress: true },
  all: { api: true, worker: true, gateway: true, egress: true },
};

/** What a role runs under `config`: a scripted agent calls no model, so nothing is its gateway. */
const partsOf = (role: Role, config: ReceiverConfig): Parts => {
  const parts = PARTS[role];
  const sandboxed = config.agent.kind === 'claude';
  return role === 'all' && !sandboxed ? { ...parts, gateway: false, egress: false } : parts;
};

/** How long a stopping gateway lets the answers and tunnels in flight finish. */
const DRAIN_MS = 60_000;

/**
 * Stops taking connections and waits for those open to end, for at most `DRAIN_MS`: a model
 * answer still streaming is metered before the database goes. Past that, they are cut; their
 * reservations stay counted.
 */
const drain = (server: Server | null) =>
  server === null || !server.listening
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
        const cut = setTimeout(() => {
          server.closeAllConnections();
        }, DRAIN_MS);
        server.close(() => {
          clearTimeout(cut);
          resolve();
        });
      });

/** How long an idle requester's credential stays in memory: past every polling interval. */
const CREDENTIAL_IDLE_MS = 24 * 3_600_000;
/** How often a worker frees what finished runs still hold. */
const HOUSEKEEPING_MS = 10 * 60_000;
/** How long past its own limit a run's sandbox is left before the worker stops it. */
const SANDBOX_GRACE_MS = 2 * 60_000;

/** A secret file's content, which must not be empty. */
export const secretOf = async (file: string, what: string): Promise<string> => {
  const secret = (await readFile(file, 'utf8')).trim();
  if (secret === '') throw new Error(`${what} in ${file} is empty`);
  return secret;
};

/**
 * The git side: a simulated host; real repositories by path, whose change requests are
 * simulated; or GitHub, with its secrets scanned for before anything is pushed.
 */
export const gitOf = async (
  settings: Settings,
  config: ReceiverConfig,
  blobs: BlobStore,
  logger: Logger,
) => {
  const git = config.git;
  if (git.kind === 'scripted') {
    const simulated = new ScriptedGit(git.resultBaseUrl);
    return { source: simulated, scanner: simulated, forge: simulated, mirrors: null, github: null };
  }
  if (git.kind === 'local') {
    const simulated = new ScriptedGit(git.resultBaseUrl);
    const mirrors = new GitMirrors({
      root: settings.mirrorsPath,
      remotes: new LocalRemotes(git.root),
      identity: { name: 'Redline', email: 'redline@localhost' },
      blobs,
    });
    // A change goes only to the operator's own repository, as a branch with a simulated change
    // request; secrets are scanned for once changes leave for a git host.
    return { source: mirrors, scanner: simulated, forge: simulated, mirrors, github: null };
  }
  const api = new GitHubApi({ url: git.api });
  const auth: GitHubAuth =
    git.auth.kind === 'app'
      ? new AppAuth({
          api,
          appId: git.auth.appId,
          privateKey: await secretOf(git.auth.privateKeyFile, 'The GitHub App’s key'),
          clock: systemClock,
        })
      : new TokenAuth(await secretOf(git.auth.file, 'The GitHub token'));
  const github = new GitHubHost({
    api,
    auth,
    gitUrl: git.web,
    forkOwner: git.forkOwner,
    logger: logger.child({ component: 'github' }),
  });
  const mirrors = new GitMirrors({
    root: settings.mirrorsPath,
    remotes: github,
    identity: git.commitAs,
    blobs,
  });
  const scanner = new GitleaksScanner({ mirrors, command: git.gitleaks });
  return { source: mirrors, scanner, forge: github, mirrors, github };
};

/** The Docker the sandboxes of a sandboxed agent run in. */
export const sandboxesOf = (agent: Extract<ReceiverConfig['agent'], { kind: 'claude' }>) =>
  new DockerSandboxes({
    socketPath: agent.dockerSocket,
    runtime: agent.runtime,
  });

const runnerOf = (
  config: ReceiverConfig,
  blobs: BlobStore,
  mirrors: GitMirrors | null,
  logger: Logger,
): AgentRunner => {
  const agent = config.agent;
  if (agent.kind === 'scripted') return new ScriptedRunner(agent, () => systemClock.now());
  if (mirrors === null)
    throw new Error('The claude agent needs real repositories (git: local or github)');
  return new SandboxedClaudeRunner({
    sandboxes: sandboxesOf(agent),
    sources: mirrors,
    blobs,
    settings: {
      user: agent.user,
      networks: agent.networks,
      gateway: agent.gateway,
      limits: agent.limits,
      setupTimeoutMs: agent.setupTimeoutMs,
      graceMs: SANDBOX_GRACE_MS,
    },
    clock: systemClock,
    logger: logger.child({ component: 'sandboxes' }),
  });
};

export const loadConfig = async (path: string): Promise<ReceiverConfig> => {
  const parsed = parseConfig(await readFile(path, 'utf8'));
  if (!parsed.ok)
    throw new Error(
      `The configuration ${path} is invalid:\n${parsed.errors.map((e) => `  ${e}`).join('\n')}`,
    );
  return parsed.value;
};

/** The operator's credential, read from its secret file; null when tasks never run with it. */
const operatorCredential = async (config: ReceiverConfig): Promise<ModelCredential | null> => {
  const operator = config.gateway.operator;
  if (operator === null) return null;
  return new ModelCredential(
    operator.kind,
    await secretOf(operator.secretFile, 'The operator’s credential'),
  );
};

/** Servers a role runs, each on its own port. */
export interface Listeners {
  readonly gateway: Server | null;
  readonly egress: Server | null;
}

/** The gateway's two sides, over the grants and usage in Postgres. */
const gatewayOf = async (
  config: ReceiverConfig,
  db: ReturnType<typeof openDatabase>,
  vault: MemoryVault,
  parts: Parts,
  logger: Logger,
): Promise<Listeners> => {
  const book = new PostgresGateway(db);
  const prices = config.gateway.prices;
  const gateway = parts.gateway
    ? createModelProxy({
        access: new ModelGateway({
          grants: book,
          ledger: book,
          prices: { priceOf: (model) => prices[model] ?? null },
          requesters: vault,
          operator: await operatorCredential(config),
          maxTokens: config.gateway.maxTokens,
          clock: systemClock,
          logger: logger.child({ component: 'gateway' }),
        }),
        upstream: config.gateway.upstream,
        logger: logger.child({ component: 'gateway' }),
      })
    : null;
  const egress = parts.egress
    ? createEgressProxy({
        access: new EgressGate({ grants: book, logger: logger.child({ component: 'egress' }) }),
        logger: logger.child({ component: 'egress' }),
      })
    : null;
  return { gateway, egress };
};

/** The queues' limits under `config`: a run job lasts as long as the longest project's run. */
const workerLimitsOf = (config: ReceiverConfig): WorkerLimits => ({
  runSlots: config.worker.runSlots,
  runsPerProject: config.worker.runsPerProject,
  runTimeoutSeconds:
    Math.max(...config.projects.map((project) => project.execution.timeoutMs)) / 1000,
});

/**
 * Brings storage up to date: the database schema, pg-boss's own, and the queues with the
 * policies `config` calls for. The `migrate` command and the worker do this; no other role does.
 */
const prepareStorage = async (
  db: ReturnType<typeof openDatabase>,
  jobs: PgBossJobs,
  config: ReceiverConfig,
): Promise<void> => {
  await migrate(db);
  await jobs.start();
  await jobs.prepare(workerLimitsOf(config));
};

/** The worker: runs tasks' agents and publishes their changes, as the queues hand them out. */
const workerOf = async (
  settings: Settings,
  config: ReceiverConfig,
  deps: {
    readonly store: PostgresStore;
    readonly jobs: PgBossJobs;
    readonly writer: TaskWriter;
    readonly projects: ConfiguredProjects;
    readonly blobs: BlobStore;
    readonly bundles: StoredBundles;
    readonly users: PostgresUsers;
    readonly vault: CredentialVault;
  },
  logger: Logger,
): Promise<() => Promise<void>> => {
  const { store, jobs, writer, projects, blobs, bundles, users, vault } = deps;
  // Only what runs tasks holds the git host's and Docker's credentials.
  const git = await gitOf(settings, config, blobs, logger);
  const runner = runnerOf(config, blobs, git.mirrors, logger);
  const supervise = new SuperviseRun({
    queries: store,
    uow: store,
    writer,
    projects,
    bundles,
    source: git.source,
    runner,
    vault,
    access: config.modelAccess,
    ids: randomIds,
    clock: systemClock,
    logger: logger.child({ component: 'runs' }),
  });
  const publish = new PublishChange({
    queries: store,
    writer,
    projects,
    bundles,
    identity: users,
    source: git.source,
    scanner: git.scanner,
    forge: git.forge,
    logger: logger.child({ component: 'publishing' }),
  });
  const handler = new TaskJobs({ supervise, publish, writer, projects, runner, vault });
  const strays = new ReleaseStrays({
    uow: store,
    runner,
    logger: logger.child({ component: 'runs' }),
  });
  // One round of housekeeping at a time; stopping waits for the one in flight.
  let tidying = Promise.resolve();
  const tidy = () => {
    tidying = tidying.then(() =>
      strays.handle().catch((error: unknown) => {
        logger.warn('Housekeeping failed', { error: String(error) });
      }),
    );
  };
  tidy();
  const housekeeping = setInterval(tidy, HOUSEKEEPING_MS);
  await jobs.work(handler, workerLimitsOf(config));
  return async () => {
    clearInterval(housekeeping);
    await tidying;
  };
};

/**
 * The receiver assembled from its adapters: the one place that knows which adapter serves
 * which port. Returns what the chosen role serves and how to stop it; stopping drains the
 * gateway's servers before the database goes.
 *
 * Requesters' credentials live in the gateway's memory. In one process (`all`) everything
 * shares that memory; split, the API and the worker reach it over the vault's socket.
 */
export const assemble = async (
  settings: Settings,
  config: ReceiverConfig,
  role: Role,
  logger: Logger,
) => {
  const parts = partsOf(role, config);
  const tasks = parts.api || parts.worker;
  const memory = new MemoryVault(systemClock, CREDENTIAL_IDLE_MS);
  const db = openDatabase(settings.databaseUrl, tasks ? 10 : 4);
  const jobs = tasks
    ? PgBossJobs.create(settings.databaseUrl, logger.child({ component: 'jobs' }), {
        maintains: parts.worker,
      })
    : null;
  if (jobs !== null) {
    if (parts.worker) await prepareStorage(db, jobs, config);
    else await jobs.start();
  }

  let api: Awaited<ReturnType<typeof buildApi>> | null = null;
  let stopWorker = (): Promise<void> => Promise.resolve();
  if (jobs !== null) {
    const vault: CredentialVault =
      config.modelAccess.credentials === 'managed'
        ? new EmptyVault()
        : role === 'all'
          ? memory
          : new SocketVault(settings.vaultSocket);
    const store = new PostgresStore(db, (trx) => jobs.scheduler(trx));
    const users = new PostgresUsers(db);
    const blobs = new FsBlobStore(settings.blobsPath);
    const bundles = new StoredBundles(blobs);
    const projects = new ConfiguredProjects(config.projects);
    const writer = new TaskWriter({ uow: store, clock: systemClock });
    if (parts.api) {
      const relay = new CredentialRelay({ vault, writer, policy: config.modelAccess, logger });
      const requests = new TaskRequests({
        queries: store,
        writer,
        projects,
        bundles,
        vault,
        relay,
        access: config.modelAccess,
        ids: randomIds,
        clock: systemClock,
      });
      api = await buildApi({
        requests,
        identity: users,
        blobs,
        intake: config.intake,
        polling: config.polling,
        clock: systemClock,
        logger: logger.child({ component: 'api' }),
      });
    }
    if (parts.worker) {
      stopWorker = await workerOf(
        settings,
        config,
        { store, jobs, writer, projects, blobs, bundles, users, vault },
        logger,
      );
    }
  }

  const listeners = await gatewayOf(config, db, memory, parts, logger);
  // The API and the worker of another process reach the vault through its socket.
  const vaultServer =
    parts.gateway && role !== 'all' ? await serveVault(memory, settings.vaultSocket) : null;

  return {
    api,
    ...listeners,
    stop: async () => {
      await stopWorker();
      await api?.close();
      await Promise.all([drain(listeners.gateway), drain(listeners.egress)]);
      vaultServer?.close();
      await jobs?.stop();
      await db.destroy();
    },
  };
};

/** Brings storage up to date (`prepareStorage`): the operator's `migrate`. */
export const migrateStorage = async (
  settings: Settings,
  config: ReceiverConfig,
  logger: Logger,
) => {
  const db = openDatabase(settings.databaseUrl, 2);
  const jobs = PgBossJobs.create(settings.databaseUrl, logger, { maintains: true });
  try {
    await prepareStorage(db, jobs, config);
  } finally {
    await jobs.stop();
    await db.destroy();
  }
};

/** What the operator's commands work on: the database and the queues, as `migrate` left them. */
export const administration = async (
  settings: Settings,
  config: ReceiverConfig,
  logger: Logger,
) => {
  const db = openDatabase(settings.databaseUrl, 2);
  const jobs = PgBossJobs.create(settings.databaseUrl, logger, { maintains: false });
  await jobs.start();
  const store = new PostgresStore(db, (trx) => jobs.scheduler(trx));
  const writer = new TaskWriter({ uow: store, clock: systemClock });
  return {
    users: new PostgresUsers(db),
    tasks: new TaskOperations({ queries: store, writer }),
    projects: new ConfiguredProjects(config.projects),
    close: async () => {
      await jobs.stop();
      await db.destroy();
    },
  };
};

export const loggerFor = (settings: Settings, role: string) =>
  jsonLogger(settings.logLevel, { service: 'receiver', role });
