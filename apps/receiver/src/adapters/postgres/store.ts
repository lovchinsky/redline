import { randomBytes } from 'node:crypto';
import { sql, type Kysely, type Transaction } from 'kysely';
import type { RunId, TaskId, UserId } from '../../domain/ids';
import type { Run } from '../../domain/run';
import type { Task } from '../../domain/task';
import type {
  GrantToken,
  InsertResult,
  JobScheduler,
  TaskQueries,
  UnitOfWork,
  WorkScope,
} from '../../ports/tasks';
import {
  eventFromRecord,
  runFromRecord,
  runToRecord,
  taskFromRecord,
  taskToRecord,
  grantTermsToRecord,
} from './records';
import type { Database } from './schema';
import { refusalOf, sha256, type Executor } from './shared';

const json = (value: unknown): string => JSON.stringify(value);

const readTask = (row: { id: string; record: unknown; version: number }): Task =>
  taskFromRecord(row.record, row.version, row.id);

const getTask = async (db: Executor, id: TaskId): Promise<Task | null> => {
  const row = await db
    .selectFrom('tasks')
    .select(['id', 'record', 'version'])
    .where('id', '=', id)
    .executeTakeFirst();
  return row === undefined ? null : readTask(row);
};

const findBySubmission = async (
  db: Executor,
  requester: UserId,
  key: string,
): Promise<Task | null> => {
  const row = await db
    .selectFrom('tasks')
    .select(['id', 'record', 'version'])
    .where('requester', '=', requester)
    .where('idempotency_key', '=', key)
    .executeTakeFirst();
  return row === undefined ? null : readTask(row);
};

/**
 * Tasks, runs, history and grants in Postgres. A unit of work is one transaction, and the jobs
 * it schedules are rows of the same transaction: they exist exactly when its changes do.
 */
export class PostgresStore implements UnitOfWork, TaskQueries {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly schedulerFor: (trx: Transaction<Database>) => JobScheduler,
  ) {}

  run<T>(work: (scope: WorkScope) => Promise<T>): Promise<T> {
    return this.db.transaction().execute((trx) => work(this.scope(trx)));
  }

  get(id: TaskId): Promise<Task | null> {
    return getTask(this.db, id);
  }

  findBySubmission(requester: UserId, key: string): Promise<Task | null> {
    return findBySubmission(this.db, requester, key);
  }

  async history(id: TaskId) {
    const rows = await this.db
      .selectFrom('task_events')
      .select('event')
      .where('task_id', '=', id)
      .orderBy('seq')
      .execute();
    return rows.map((row) => eventFromRecord(row.event, id));
  }

  private scope(trx: Transaction<Database>): WorkScope {
    return {
      tasks: {
        get: (id) => getTask(trx, id),
        findBySubmission: (requester, key) => findBySubmission(trx, requester, key),
        insert: async (task, key): Promise<InsertResult> => {
          // A concurrent insert with the same key waits here for the other transaction, then
          // finds its task: the key decides, whichever request came first.
          const inserted = await trx
            .insertInto('tasks')
            .values({
              id: task.id,
              requester: task.requester,
              idempotency_key: key,
              project_id: task.projectId,
              state: task.state.kind,
              version: 1,
              record: json(taskToRecord(task)),
              created_at: new Date(task.createdAt),
              updated_at: new Date(task.updatedAt),
            })
            .onConflict((conflict) => conflict.constraint('tasks_submission').doNothing())
            .returning('id')
            .executeTakeFirst();
          if (inserted !== undefined) return { inserted: true, task: { ...task, version: 1 } };
          const existing = await findBySubmission(trx, task.requester, key);
          if (existing === null)
            throw new Error('A submission conflicted with a task that does not exist');
          return { inserted: false, existing };
        },
        save: async (task) => {
          const saved = await trx
            .updateTable('tasks')
            .set({
              state: task.state.kind,
              record: json(taskToRecord(task)),
              version: task.version + 1,
              updated_at: new Date(task.updatedAt),
            })
            .where('id', '=', task.id)
            .where('version', '=', task.version)
            .returning('version')
            .executeTakeFirst();
          return saved === undefined ? null : { ...task, version: saved.version };
        },
      },
      runs: {
        get: async (id: RunId): Promise<Run | null> => {
          const row = await trx
            .selectFrom('runs')
            .select(['id', 'record'])
            .where('id', '=', id)
            .executeTakeFirst();
          return row === undefined ? null : runFromRecord(row.record, row.id);
        },
        insert: async (run) => {
          await trx
            .insertInto('runs')
            .values({
              id: run.id,
              task_id: run.taskId,
              state: run.state.kind,
              record: json(runToRecord(run)),
              started_at: new Date(run.startedAt),
            })
            .execute();
        },
        save: async (run) => {
          await trx
            .updateTable('runs')
            .set({ state: run.state.kind, record: json(runToRecord(run)) })
            .where('id', '=', run.id)
            .execute();
        },
      },
      history: {
        append: async (taskId, event) => {
          await trx
            .insertInto('task_events')
            .values({
              task_id: taskId,
              at: new Date(event.at),
              type: event.type,
              event: json(event),
            })
            .execute();
        },
      },
      jobs: this.schedulerFor(trx),
      grants: {
        issue: async (terms) => {
          const token = randomBytes(32).toString('base64url');
          await trx
            .insertInto('run_grants')
            .values({
              token_hash: sha256(token),
              run_id: terms.runId,
              task_id: terms.taskId,
              terms: json(grantTermsToRecord(terms)),
              issued_at: new Date(),
            })
            .execute();
          return token as GrantToken;
        },
        revoke: async (runId, phase) => {
          await trx
            .deleteFrom('run_grants')
            .where('run_id', '=', runId)
            .$if(phase !== undefined, (query) =>
              query.where(sql<string>`terms->>'phase'`, '=', phase ?? ''),
            )
            .execute();
        },
        refusal: (runId) => refusalOf(trx, runId),
      },
    };
  }
}
