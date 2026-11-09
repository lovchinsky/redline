import { sql, type Kysely } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProjectId, TaskId, UserId, type BlobDigest } from '../../domain/ids';
import { submitTask, type Task } from '../../domain/task';
import { TaskWriter } from '../../application/task-writer';
import { FixedClock, silentLogger } from '../../application/testing/fakes';
import type { Job } from '../../ports/tasks';
import { migrate, openDatabase } from './database';
import { PgBossJobs, type JobHandlers } from './jobs';
import type { Database } from './schema';
import { PostgresStore } from './store';
import { freshDatabase } from './testing/database';
import { PostgresUsers } from './users';

let drop: () => Promise<void>;
let db: Kysely<Database>;
let jobs: PgBossJobs;
let store: PostgresStore;
let users: PostgresUsers;

const limits = { runSlots: 2, runsPerProject: 1, runTimeoutSeconds: 60 };

beforeAll(async () => {
  const database = await freshDatabase();
  drop = database.drop;
  db = openDatabase(database.url);
  expect(await migrate(db)).toEqual(['0001-tasks-runs-users']);
  jobs = PgBossJobs.create(database.url, limits, silentLogger);
  await jobs.start();
  store = new PostgresStore(db, (trx) => jobs.scheduler(trx));
  users = new PostgresUsers(db);
  await users.add({ id: UserId('ann'), name: 'Ann Lee', email: 'ann@example.com' }, new Date());
});

afterAll(async () => {
  await jobs.stop();
  await db.destroy();
  await drop();
});

let sequence = 0;
const transition = (key = `key-${String((sequence += 1))}`) => ({
  key,
  ...submitTask(
    {
      id: TaskId(`task-${String((sequence += 1))}`),
      requester: UserId('ann'),
      projectId: ProjectId('acme'),
      bundle: { manifest: 'a'.repeat(64) as BlobDigest, title: 'Rename the badge' },
      credentials: 'operator',
    },
    1_000,
  ),
});

/** Jobs of a queue for one singleton key, read from pg-boss's own table. */
const queued = async (queue: string, singletonKey: string) => {
  const result = await sql<{ name: string; singleton_key: string; state: string }>`
    select name, singleton_key, state from pgboss.job
    where name = ${queue} and singleton_key = ${singletonKey}`.execute(db);
  return result.rows;
};

describe('PostgresStore', () => {
  it('stores a task with its event and first job in one transaction, and reads it back', async () => {
    const writer = new TaskWriter({ uow: store, clock: new FixedClock() });
    const submitted = transition();
    const created = await writer.create(submitted, submitted.key);
    expect(created.inserted).toBe(true);
    expect(await store.get(submitted.task.id)).toEqual({ ...submitted.task, version: 1 });
    expect(await store.history(submitted.task.id)).toEqual([{ type: 'submitted', at: 1_000 }]);
    expect(await queued('run', submitted.task.id)).toEqual([
      { name: 'run', singleton_key: submitted.task.id, state: 'created' },
    ]);
  });

  it('keeps nothing of a unit of work that throws, jobs included', async () => {
    const submitted = transition();
    await expect(
      store.run(async (scope) => {
        await scope.tasks.insert(submitted.task, submitted.key);
        await scope.jobs.schedule(
          { queue: 'run', taskId: submitted.task.id, projectId: submitted.task.projectId },
          null,
        );
        throw new Error('changed my mind');
      }),
    ).rejects.toThrow('changed my mind');
    expect(await store.get(submitted.task.id)).toBeNull();
    expect(await queued('run', submitted.task.id)).toEqual([]);
  });

  it('lets one of two concurrent submissions with the same key win', async () => {
    const writer = new TaskWriter({ uow: store, clock: new FixedClock() });
    const first = transition('same-key');
    const second = transition('same-key');
    const results = await Promise.all([
      writer.create(first, 'same-key'),
      writer.create(second, 'same-key'),
    ]);
    const winners = results.filter((result) => result.inserted);
    expect(winners).toHaveLength(1);
    const ids = results.map((result) => (result.inserted ? result.task.id : result.existing.id));
    expect(new Set(ids).size).toBe(1);
  });

  it('refuses to save a task that changed since it was read', async () => {
    const writer = new TaskWriter({ uow: store, clock: new FixedClock() });
    const submitted = transition();
    await writer.create(submitted, submitted.key);
    const read = (await store.get(submitted.task.id)) as Task;
    const saved = await store.run((scope) => scope.tasks.save({ ...read, runAttempts: 1 }));
    expect(saved?.version).toBe(2);
    const stale = await store.run((scope) => scope.tasks.save({ ...read, runAttempts: 2 }));
    expect(stale).toBeNull();
  });

  it('collapses repeated schedules of a task’s queued run into one job', async () => {
    const submitted = transition();
    await store.run((scope) => scope.tasks.insert(submitted.task, submitted.key));
    const job: Job = {
      queue: 'run',
      taskId: submitted.task.id,
      projectId: submitted.task.projectId,
    };
    for (let i = 0; i < 3; i += 1) await store.run((scope) => scope.jobs.schedule(job, null));
    expect(await queued('run', submitted.task.id)).toHaveLength(1);
  });

  it('keeps grants as hashes and drops them on revoke', async () => {
    const submitted = transition();
    await store.run((scope) => scope.tasks.insert(submitted.task, submitted.key));
    const runId = 'run-grant' as never;
    const token = await store.run(async (scope) => {
      await scope.runs.insert({
        id: runId,
        taskId: submitted.task.id,
        kind: 'start',
        image: 'image',
        model: 'model',
        startedAt: 1_000,
        state: { kind: 'started' },
      });
      return scope.grants.issue(runId, submitted.task.id);
    });
    const stored = await db
      .selectFrom('run_grants')
      .selectAll()
      .where('run_id', '=', runId)
      .executeTakeFirstOrThrow();
    expect(stored.token_hash).not.toContain(token);
    expect(stored.token_hash).toMatch(/^[a-f0-9]{64}$/);
    await store.run((scope) => scope.grants.revoke(runId));
    expect(
      await db.selectFrom('run_grants').selectAll().where('run_id', '=', runId).execute(),
    ).toEqual([]);
  });
});

describe('PostgresUsers', () => {
  it('authenticates by a token shown once and stops after revocation', async () => {
    const token = await users.issueToken(UserId('ann'), 'laptop', new Date());
    expect(token).toMatch(/^rl_/);
    expect(await users.authenticate(token ?? '')).toEqual({
      id: 'ann',
      name: 'Ann Lee',
      email: 'ann@example.com',
    });
    expect(await users.authenticate('rl_wrong')).toBeNull();
    expect(await users.revokeTokens(UserId('ann'), new Date())).toBe(1);
    expect(await users.authenticate(token ?? '')).toBeNull();
    expect(await users.issueToken(UserId('nobody'), 'x', new Date())).toBeNull();
  });
});

describe('PgBossJobs', () => {
  it('delivers committed jobs to their handler', async () => {
    const submitted = transition();
    await store.run(async (scope) => {
      await scope.tasks.insert(submitted.task, submitted.key);
      await scope.jobs.schedule(
        { queue: 'publish', taskId: submitted.task.id, projectId: submitted.task.projectId },
        null,
      );
    });
    const delivered: Job[] = [];
    const handlers: JobHandlers = {
      run: () => Promise.resolve(),
      publish: (job) => {
        delivered.push(job);
        return Promise.resolve();
      },
      'reply-timeout': () => Promise.resolve(),
      'abort-run': () => Promise.resolve(),
      'withdraw-change': () => Promise.resolve(),
    };
    await jobs.work(handlers);
    await expect
      .poll(() => delivered, { timeout: 20_000, interval: 200 })
      .toEqual([{ queue: 'publish', taskId: submitted.task.id, projectId: 'acme' }]);
  });
});
