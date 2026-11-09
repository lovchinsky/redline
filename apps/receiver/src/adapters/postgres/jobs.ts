import { CompiledQuery, type Transaction } from 'kysely';
import {
  PgBoss,
  type Db,
  type QueueOptions,
  type SendOptions,
  type UpdateQueueOptions,
} from 'pg-boss';
import { dueOf, type TaskEffect } from '../../domain/task';
import type { Logger } from '../../ports/system';
import type { Job, JobHandler, JobScheduler } from '../../ports/tasks';
import { jobFromRecord, jobToRecord } from './records';
import type { Database } from './schema';

export interface WorkerLimits {
  /** Runs at once on this worker. */
  readonly runSlots: number;
  /** Runs at once per project, across all workers. */
  readonly runsPerProject: number;
  /** The longest a run may take: a run job is given up (and retried) after it. */
  readonly runTimeoutSeconds: number;
}

/** How each effect's jobs are queued. */
interface Queue {
  /** The queue's name in pg-boss: the receiver's stored name for the effect's work. */
  readonly name: string;
  readonly options: (limits: WorkerLimits) => QueueOptions & { readonly policy: string };
  /** The one thing at most one job of the queue is queued (and one active) for. */
  readonly singleton: (job: Job) => string;
  /** Whether its jobs count against their project's limit (`groupConcurrency`). */
  readonly perProject: boolean;
}

type EffectOf<Kind extends TaskEffect['kind']> = Extract<TaskEffect, { kind: Kind }>;
const effectOf = <Kind extends TaskEffect['kind']>(job: Job, kind: Kind): EffectOf<Kind> => {
  if (job.effect.kind !== kind) throw new Error(`A ${job.effect.kind} job in the ${kind} queue`);
  return job.effect as EffectOf<Kind>;
};

const RETRIED = { retryLimit: 20, retryDelay: 30, retryBackoff: true, retryDelayMax: 900 };

/**
 * Queues and their policies, by the effect they carry out. `stately` with a singleton key keeps
 * at most one queued and one active job per key: a job scheduled while another runs waits for
 * it instead of running beside it, and repeats of a queued one collapse.
 */
const QUEUES: { readonly [Kind in TaskEffect['kind']]: Queue } = {
  'schedule-run': {
    name: 'run',
    options: (limits) => ({
      policy: 'stately',
      expireInSeconds: limits.runTimeoutSeconds + 300,
      heartbeatSeconds: 60,
      ...RETRIED,
    }),
    singleton: (job) => job.taskId,
    perProject: true,
  },
  'schedule-publish': {
    name: 'publish',
    options: () => ({ policy: 'stately', ...RETRIED }),
    singleton: (job) => job.taskId,
    perProject: true,
  },
  'schedule-reply-timeout': {
    name: 'reply-timeout',
    options: () => ({ policy: 'stately', retryLimit: 20, retryDelay: 60 }),
    singleton: (job) => `${job.taskId}/${effectOf(job, 'schedule-reply-timeout').questionId}`,
    perProject: false,
  },
  'end-run': {
    name: 'release-run',
    options: () => ({ policy: 'stately', retryLimit: 20, retryDelay: 30 }),
    singleton: (job) => effectOf(job, 'end-run').runId,
    perProject: false,
  },
  'withdraw-change': {
    name: 'withdraw-change',
    options: () => ({ policy: 'stately', retryLimit: 20, retryDelay: 60, retryBackoff: true }),
    singleton: (job) => job.taskId,
    perProject: false,
  },
  'forget-credential': {
    name: 'forget-credential',
    options: () => ({ policy: 'stately', retryLimit: 20, retryDelay: 30 }),
    singleton: (job) => job.taskId,
    perProject: false,
  },
};

const KINDS = Object.keys(QUEUES) as TaskEffect['kind'][];

/** pg-boss fixes a queue's policy, heartbeat and longest retry delay when it creates the queue. */
const updatable = (options: QueueOptions): UpdateQueueOptions => {
  const update: UpdateQueueOptions = {};
  if (options.expireInSeconds !== undefined) update.expireInSeconds = options.expireInSeconds;
  if (options.retryLimit !== undefined) update.retryLimit = options.retryLimit;
  if (options.retryDelay !== undefined) update.retryDelay = options.retryDelay;
  if (options.retryBackoff !== undefined) update.retryBackoff = options.retryBackoff;
  return update;
};

/** pg-boss on a Kysely transaction: its statements run inside the caller's transaction. */
const inTransaction = (trx: Transaction<Database>): Db => ({
  executeSql: async (text: string, values?: unknown[]) => {
    const result = await trx.executeQuery(CompiledQuery.raw(text, values ?? []));
    return { rows: [...result.rows] };
  },
});

/**
 * Jobs as pg-boss queues in the receiver's Postgres. Only a process that `maintains` the queues
 * installs pg-boss's schema and keeps the queues (expiry, retries, clean-up); one that only
 * schedules jobs uses them as they are.
 */
export class PgBossJobs {
  constructor(
    private readonly boss: PgBoss,
    private readonly logger: Logger,
  ) {}

  static create(
    connectionString: string,
    logger: Logger,
    options: { readonly maintains: boolean },
  ): PgBossJobs {
    const boss = new PgBoss({
      connectionString,
      schema: 'pgboss',
      migrate: options.maintains,
      supervise: options.maintains,
      schedule: options.maintains,
    });
    boss.on('error', (error: unknown) => {
      logger.error('Job queue error', { error: String(error) });
    });
    return new PgBossJobs(boss, logger);
  }

  async start(): Promise<void> {
    await this.boss.start();
  }

  /** Makes every queue exist with the policies `limits` call for. */
  async prepare(limits: WorkerLimits): Promise<void> {
    const existing = new Set((await this.boss.getQueues()).map((queue) => queue.name));
    for (const { name, options } of Object.values(QUEUES)) {
      const wanted = options(limits);
      if (existing.has(name)) await this.boss.updateQueue(name, updatable(wanted));
      else await this.boss.createQueue(name, wanted);
    }
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 30_000 });
  }

  /** A scheduler whose jobs are part of the given transaction. */
  scheduler(trx: Transaction<Database>): JobScheduler {
    const db = inTransaction(trx);
    return {
      schedule: async (job) => {
        const queue = QUEUES[job.effect.kind];
        const options: SendOptions = { db, singletonKey: queue.singleton(job) };
        const due = dueOf(job.effect);
        if (due !== null) options.startAfter = new Date(due);
        if (queue.perProject) options.group = { id: job.projectId };
        await this.boss.send(queue.name, jobToRecord(job), options);
      },
    };
  }

  /**
   * Works the queues with `handler`. A handler cut short by shutdown fails its job, so it is
   * delivered again and continues where it was, instead of being recorded as done.
   */
  async work(handler: JobHandler, limits: WorkerLimits): Promise<void> {
    for (const kind of KINDS) {
      const queue = QUEUES[kind];
      const runs = kind === 'schedule-run';
      await this.boss.work<object>(
        queue.name,
        {
          localConcurrency: runs ? limits.runSlots : 2,
          ...(queue.perProject ? { groupConcurrency: runs ? limits.runsPerProject : 1 } : {}),
        },
        async ([delivered]) => {
          if (delivered === undefined) return;
          const job = jobFromRecord(delivered.data, delivered.id);
          if (job.effect.kind !== kind) {
            throw new Error(`A ${job.effect.kind} job in the ${queue.name} queue`);
          }
          const log = this.logger.child({
            queue: queue.name,
            taskId: job.taskId,
            jobId: delivered.id,
          });
          await handler.handle(job, delivered.signal);
          if (delivered.signal.aborted) throw new Error('Interrupted before it finished');
          log.debug('Job done');
        },
      );
    }
  }
}
