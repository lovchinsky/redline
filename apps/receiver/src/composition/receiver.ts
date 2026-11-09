import { readFile } from 'node:fs/promises';
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
import { jsonLogger, randomIds, systemClock } from '../adapters/system/system';
import { MemoryVault } from '../adapters/vault/memory-vault';
import { CredentialRelay } from '../application/credentials';
import { TaskOperations } from '../application/operations';
import { PublishChange } from '../application/publish-change';
import { TaskRequests } from '../application/requests';
import { SuperviseRun } from '../application/supervise-run';
import { AbortRun, ExpireQuestion, WithdrawChange } from '../application/task-jobs';
import { TaskWriter } from '../application/task-writer';
import type { Logger } from '../ports/system';
import type { Settings } from './settings';

/** Which parts of the receiver one process runs. */
export type Role = 'api' | 'worker' | 'all';

/** How long an idle requester's credential stays in memory: past every polling interval. */
const CREDENTIAL_IDLE_MS = 24 * 3_600_000;

export const loadConfig = async (path: string): Promise<ReceiverConfig> => {
  const parsed = parseConfig(await readFile(path, 'utf8'));
  if (!parsed.ok)
    throw new Error(
      `The configuration ${path} is invalid:\n${parsed.errors.map((e) => `  ${e}`).join('\n')}`,
    );
  return parsed.value;
};

/**
 * The receiver assembled from its adapters: the one place that knows which adapter serves
 * which port. Returns what the chosen role runs and how to stop it.
 */
export const assemble = async (
  settings: Settings,
  config: ReceiverConfig,
  role: Role,
  logger: Logger,
) => {
  if (role !== 'all' && config.modelAccess.credentials !== 'managed') {
    throw new Error(
      'Requesters’ credentials are held in memory: with `models.credentials` other than managed, ' +
        'run the receiver as one process (`receiver serve all`).',
    );
  }
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

  const clock = systemClock;
  const store = new PostgresStore(db, (trx) => jobs.scheduler(trx));
  const users = new PostgresUsers(db);
  const blobs = new FsBlobStore(settings.blobsPath);
  const bundles = new StoredBundles(blobs);
  const projects = new ConfiguredProjects(config.projects);
  const vault = new MemoryVault(clock, CREDENTIAL_IDLE_MS);
  const runner = new ScriptedRunner(config.agent, () => clock.now());
  const git = new ScriptedGit(config.git.resultBaseUrl);
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
  const supervise = new SuperviseRun({
    queries: store,
    uow: store,
    writer,
    projects,
    bundles,
    source: git,
    runner,
    vault,
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
    source: git,
    scanner: git,
    forge: git,
    logger: logger.child({ component: 'publishing' }),
  });
  const expire = new ExpireQuestion({ writer, projects });
  const abort = new AbortRun({ runner });
  const withdraw = new WithdrawChange({ queries: store, projects, forge: git, logger });

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
  if (role !== 'api') {
    await jobs.work({
      run: (job, signal) => supervise.handle(job.taskId, signal),
      publish: (job) => publish.handle(job.taskId),
      'reply-timeout': (job) => expire.handle(job.taskId, job.questionId),
      'abort-run': (job) => abort.handle(job.runId),
      'withdraw-change': (job) => withdraw.handle(job.taskId),
    });
  }

  return {
    api,
    stop: async () => {
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
