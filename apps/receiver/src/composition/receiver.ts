import { readFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { FsBlobStore } from '../adapters/blobs/fs-blob-store';
import { StoredBundles } from '../adapters/blobs/stored-bundles';
import { ConfiguredProjects, parseConfig, type ReceiverConfig } from '../adapters/config/config';
import { buildApi } from '../adapters/http/server';
import { migrate, openDatabase } from '../adapters/postgres/database';
import { PgBossJobs } from '../adapters/postgres/jobs';
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
import {
  AbortRun,
  ExpireQuestion,
  ForgetCredential,
  ReleaseStrays,
  WithdrawChange,
} from '../application/task-jobs';
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

/** How long an idle requester's credential stays in memory: past every polling interval. */
const CREDENTIAL_IDLE_MS = 24 * 3_600_000;
/** How often a worker frees what finished runs still hold. */
const HOUSEKEEPING_MS = 10 * 60_000;
/** How long past its own limit a run's sandbox is left before the worker stops it. */
const SANDBOX_GRACE_MS = 2 * 60_000;

/** A secret file's content, which must not be empty. */
const secretOf = async (file: string, what: string): Promise<string> => {
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
    sandboxes: new DockerSandboxes({
      socketPath: agent.dockerSocket,
      runtime: agent.runtime,
      user: `${String(agent.user.uid)}:${String(agent.user.gid)}`,
    }),
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
  sides: { readonly model: boolean; readonly egress: boolean },
  logger: Logger,
): Promise<Listeners> => {
  const book = new PostgresGateway(db);
  const prices = config.gateway.prices;
  const gateway = sides.model
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
  const egress = sides.egress
    ? createEgressProxy({
        access: new EgressGate({ grants: book, logger: logger.child({ component: 'egress' }) }),
        logger: logger.child({ component: 'egress' }),
      })
    : null;
  return { gateway, egress };
};

/**
 * The receiver assembled from its adapters: the one place that knows which adapter serves
 * which port. Returns what the chosen role runs and how to stop it.
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
  const clock = systemClock;
  const memory = new MemoryVault(clock, CREDENTIAL_IDLE_MS);

  if (role === 'gateway' || role === 'egress') {
    const db = openDatabase(settings.databaseUrl, 4);
    const listeners = await gatewayOf(
      config,
      db,
      memory,
      { model: role === 'gateway', egress: role === 'egress' },
      logger,
    );
    const vaultServer = role === 'gateway' ? await serveVault(memory, settings.vaultSocket) : null;
    return {
      api: null,
      ...listeners,
      stop: async () => {
        vaultServer?.close();
        await db.destroy();
      },
    };
  }

  const vault: CredentialVault =
    config.modelAccess.credentials === 'managed'
      ? new EmptyVault()
      : role === 'all'
        ? memory
        : new SocketVault(settings.vaultSocket);
  const db = openDatabase(settings.databaseUrl);
  await migrate(db);
  const runTimeoutSeconds =
    Math.max(...config.projects.map((project) => project.execution.timeoutMs)) / 1000;
  const jobs = PgBossJobs.create(
    settings.databaseUrl,
    {
      runSlots: config.worker.runSlots,
      runsPerProject: config.worker.runsPerProject,
      runTimeoutSeconds,
    },
    logger.child({ component: 'jobs' }),
  );
  await jobs.start();

  const store = new PostgresStore(db, (trx) => jobs.scheduler(trx));
  const users = new PostgresUsers(db);
  const blobs = new FsBlobStore(settings.blobsPath);
  const bundles = new StoredBundles(blobs);
  const projects = new ConfiguredProjects(config.projects);
  const writer = new TaskWriter({ uow: store, clock });
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
    clock,
  });
  const api =
    role === 'worker'
      ? null
      : await buildApi({
          requests,
          identity: users,
          blobs,
          intake: config.intake,
          polling: config.polling,
          clock,
          logger: logger.child({ component: 'api' }),
        });
  let housekeeping: NodeJS.Timeout | null = null;
  if (role !== 'api') {
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
      clock,
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
    const expire = new ExpireQuestion({ writer, projects });
    const abort = new AbortRun({ runner });
    const forget = new ForgetCredential({ vault });
    const withdraw = new WithdrawChange({ queries: store, projects, forge: git.forge, logger });
    const strays = new ReleaseStrays({
      uow: store,
      runner,
      logger: logger.child({ component: 'runs' }),
    });
    const tidy = () => {
      strays.handle().catch((error: unknown) => {
        logger.warn('Housekeeping failed', { error: String(error) });
      });
    };
    tidy();
    housekeeping = setInterval(tidy, HOUSEKEEPING_MS);
    await jobs.work({
      run: (job, signal) => supervise.handle(job.taskId, signal),
      publish: (job) => publish.handle(job.taskId),
      'reply-timeout': (job) => expire.handle(job.taskId, job.questionId),
      'abort-run': (job) => abort.handle(job.runId),
      'withdraw-change': (job) => withdraw.handle(job.taskId),
      'forget-credential': (job) => forget.handle(job.taskId),
    });
  }
  // One process with sandboxed agents is their gateway too; a scripted agent calls no model.
  const listeners: Listeners =
    role === 'all' && config.agent.kind === 'claude'
      ? await gatewayOf(config, db, memory, { model: true, egress: true }, logger)
      : { gateway: null, egress: null };

  return {
    api,
    ...listeners,
    stop: async () => {
      if (housekeeping !== null) clearInterval(housekeeping);
      await api?.close();
      await jobs.stop();
      await db.destroy();
    },
  };
};

/** What the operator's commands work on: the database and the queues, without serving either. */
export const administration = async (
  settings: Settings,
  config: ReceiverConfig,
  logger: Logger,
) => {
  const db = openDatabase(settings.databaseUrl, 2);
  await migrate(db);
  const jobs = PgBossJobs.create(
    settings.databaseUrl,
    { runSlots: 1, runsPerProject: 1, runTimeoutSeconds: 3600 },
    logger,
    false,
  );
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
