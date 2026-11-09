import { CompiledQuery, type Transaction } from 'kysely';
import {
  PgBoss,
  type Db,
  type QueueOptions,
  type SendOptions,
  type UpdateQueueOptions,
} from 'pg-boss';
import { ProjectId, QuestionId, RunId, TaskId } from '../../domain/ids';
import type { Logger } from '../../ports/system';
import type { Job, JobQueue, JobScheduler } from '../../ports/tasks';
import type { Database } from './schema';

/** What a worker does with each kind of job. A handler that throws has its job retried. */
/** A handler for each queue, given the queue's jobs. */
export type JobHandlers = {
  readonly [Queue in JobQueue]: (
    job: Extract<Job, { queue: Queue }>,
    signal: AbortSignal,
  ) => Promise<void>;
};

export interface WorkerLimits {
  /** Runs at once on this worker. */
  readonly runSlots: number;
  /** Runs at once per project, across all workers. */
  readonly runsPerProject: number;
  /** The longest a run may take: a run job is given up (and retried) after it. */
  readonly runTimeoutSeconds: number;
}

/**
 * Queues and their policies. `stately` with the task as singleton key keeps at most one queued
 * and one active job per task: a job scheduled while another runs waits for it instead of
 * running beside it, and repeats of a queued one collapse.
 */
const queueOptions = (
  limits: WorkerLimits,
): Record<JobQueue, QueueOptions & { policy: string }> => ({
  run: {
    policy: 'stately',
    expireInSeconds: limits.runTimeoutSeconds + 300,
    heartbeatSeconds: 60,
    retryLimit: 20,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 900,
  },
  publish: {
    policy: 'stately',
    retryLimit: 20,
    retryDelay: 30,
    retryBackoff: true,
    retryDelayMax: 900,
  },
  'reply-timeout': { policy: 'stately', retryLimit: 20, retryDelay: 60 },
  'abort-run': { policy: 'stately', retryLimit: 20, retryDelay: 30 },
  'withdraw-change': { policy: 'stately', retryLimit: 20, retryDelay: 60, retryBackoff: true },
  'forget-credential': { policy: 'stately', retryLimit: 20, retryDelay: 30 },
});

/** pg-boss fixes a queue's policy, heartbeat and longest retry delay when it creates the queue. */
const updatable = (options: QueueOptions): UpdateQueueOptions => {
  const update: UpdateQueueOptions = {};
  if (options.expireInSeconds !== undefined) update.expireInSeconds = options.expireInSeconds;
  if (options.retryLimit !== undefined) update.retryLimit = options.retryLimit;
  if (options.retryDelay !== undefined) update.retryDelay = options.retryDelay;
  if (options.retryBackoff !== undefined) update.retryBackoff = options.retryBackoff;
  return update;
};

const QUEUES = [
  'run',
  'publish',
  'reply-timeout',
  'abort-run',
  'withdraw-change',
  'forget-credential',
] as const satisfies readonly JobQueue[];

/** The singleton key of a job: the one thing at most one job is queued (and one active) for. */
const singletonOf = (job: Job): string => {
  switch (job.queue) {
    case 'run':
    case 'publish':
    case 'withdraw-change':
    case 'forget-credential':
      return job.taskId;
    case 'reply-timeout':
      return `${job.taskId}/${job.questionId}`;
    case 'abort-run':
      return job.runId;
  }
};

/** pg-boss on a Kysely transaction: its statements run inside the caller's transaction. */
const inTransaction = (trx: Transaction<Database>): Db => ({
  executeSql: async (text: string, values?: unknown[]) => {
    const result = await trx.executeQuery(CompiledQuery.raw(text, values ?? []));
    return { rows: [...result.rows] };
  },
});

type Payload = Record<string, string>;

const payloadOf = (job: Job): Payload => {
  switch (job.queue) {
    case 'run':
    case 'publish':
      return { taskId: job.taskId, projectId: job.projectId };
    case 'reply-timeout':
      return { taskId: job.taskId, questionId: job.questionId };
    case 'abort-run':
      return { taskId: job.taskId, runId: job.runId };
    case 'withdraw-change':
    case 'forget-credential':
      return { taskId: job.taskId };
  }
};

const field = (data: Payload, name: string): string => {
  const value = data[name];
  if (typeof value !== 'string' || value === '') throw new Error(`Job without ${name}`);
  return value;
};

const jobFrom = (queue: JobQueue, data: Payload): Job => {
  const taskId = TaskId(field(data, 'taskId'));
  switch (queue) {
    case 'run':
      return { queue, taskId, projectId: ProjectId(field(data, 'projectId')) };
    case 'publish':
      return { queue, taskId, projectId: ProjectId(field(data, 'projectId')) };
    case 'reply-timeout':
      return { queue, taskId, questionId: QuestionId(field(data, 'questionId')) };
    case 'abort-run':
      return { queue, taskId, runId: RunId(field(data, 'runId')) };
    case 'withdraw-change':
    case 'forget-credential':
      return { queue, taskId };
  }
};

/** Jobs as pg-boss queues in the receiver's Postgres. */
export class PgBossJobs {
  constructor(
    private readonly boss: PgBoss,
    private readonly limits: WorkerLimits,
    private readonly logger: Logger,
  ) {}

  /**
   * `background`: whether this process also maintains the queues (expiry, retries, clean-up).
   * Long-running processes do; a short command that only schedules does not.
   */
  static create(
    connectionString: string,
    limits: WorkerLimits,
    logger: Logger,
    background = true,
  ): PgBossJobs {
    const boss = new PgBoss({
      connectionString,
      schema: 'pgboss',
      supervise: background,
      schedule: background,
    });
    boss.on('error', (error: unknown) => {
      logger.error('Job queue error', { error: String(error) });
    });
    return new PgBossJobs(boss, limits, logger);
  }

  /** Starts the queue (creating its schema on first use) and makes sure every queue exists. */
  async start(): Promise<void> {
    await this.boss.start();
    const options = queueOptions(this.limits);
    const existing = new Set((await this.boss.getQueues()).map((queue) => queue.name));
    for (const queue of QUEUES) {
      if (existing.has(queue)) await this.boss.updateQueue(queue, updatable(options[queue]));
      else await this.boss.createQueue(queue, options[queue]);
    }
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 30_000 });
  }

  /** A scheduler whose jobs are part of the given transaction. */
  scheduler(trx: Transaction<Database>): JobScheduler {
    const db = inTransaction(trx);
    return {
      schedule: async (job, startAfter) => {
        const options: SendOptions = { db, singletonKey: singletonOf(job) };
        if (startAfter !== null) options.startAfter = new Date(startAfter);
        if (job.queue === 'run' || job.queue === 'publish') options.group = { id: job.projectId };
        await this.boss.send(job.queue, payloadOf(job), options);
      },
    };
  }

  /**
   * Works the queues with `handlers`. A handler cut short by shutdown fails its job, so it is
   * delivered again and continues where it was, instead of being recorded as done.
   */
  async work(handlers: JobHandlers): Promise<void> {
    for (const queue of QUEUES) {
      const runs = queue === 'run';
      await this.boss.work<Payload>(
        queue,
        {
          localConcurrency: runs ? this.limits.runSlots : 2,
          ...(runs || queue === 'publish'
            ? { groupConcurrency: runs ? this.limits.runsPerProject : 1 }
            : {}),
        },
        async ([delivered]) => {
          if (delivered === undefined) return;
          const job = jobFrom(queue, delivered.data);
          const log = this.logger.child({ queue, taskId: job.taskId, jobId: delivered.id });
          await (handlers[queue] as (job: Job, signal: AbortSignal) => Promise<void>)(
            job,
            delivered.signal,
          );
          if (delivered.signal.aborted) throw new Error('Interrupted before it finished');
          log.debug('Job done');
        },
      );
    }
  }
}
