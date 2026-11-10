import { sql, type ColumnType, type Generated, type Kysely } from 'kysely';
import type { Migration } from 'kysely/migration';

/** JSON as stored: written as text, read back parsed. */
type Json = ColumnType<unknown, string, string>;
type Timestamp = ColumnType<Date, Date, Date>;

export interface TasksTable {
  id: string;
  requester: string;
  idempotency_key: string;
  project_id: string;
  /** The state's kind, for finding tasks by state without reading records. */
  state: string;
  version: number;
  record: Json;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface TaskEventsTable {
  seq: Generated<string>;
  task_id: string;
  at: Timestamp;
  type: string;
  event: Json;
}

export interface RunsTable {
  id: string;
  task_id: string;
  record: Json;
  started_at: Timestamp;
  /** When the task stopped running it; null while it is the task's current run. */
  ended_at: Timestamp | null;
}

/**
 * Grants of running runs, one per sandbox of a run. Only the hash of a grant is stored: the
 * token itself is the sandbox's. `terms` is what the grant allows (`GrantTerms`).
 */
export interface RunGrantsTable {
  token_hash: string;
  run_id: string;
  task_id: string;
  terms: Json;
  issued_at: Timestamp;
}

/** Why the gateway last refused each run (`GatewayRefusal`), for the run and its worker. */
export interface RunRefusalsTable {
  run_id: string;
  refusal: Json;
  at: Timestamp;
}

/**
 * What each model request of a run takes from its task's budget, as the gateway metered it:
 * its reservation while it is in flight (`settled` false), its usage once answered.
 * `cost_usd` and `counted_tokens` are what it takes either way.
 */
export interface RunUsageTable {
  seq: Generated<string>;
  reservation: string | null;
  run_id: string;
  task_id: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_write_tokens: number;
  cache_read_tokens: number;
  cost_usd: number;
  counted_tokens: number;
  settled: boolean;
  at: Timestamp;
}

export interface UsersTable {
  id: string;
  name: string;
  email: string | null;
  created_at: Timestamp;
}

/** Access tokens of users, by the SHA-256 of the token. */
export interface TokensTable {
  token_hash: string;
  user_id: string;
  label: string;
  created_at: Timestamp;
  revoked_at: Timestamp | null;
}

/** The repositories the worker last found on the git host: each is a project. */
export interface RepositoriesTable {
  name: string;
  base_branch: string;
  found_at: Timestamp;
}

export interface Database {
  tasks: TasksTable;
  task_events: TaskEventsTable;
  runs: RunsTable;
  run_grants: RunGrantsTable;
  run_usage: RunUsageTable;
  run_refusals: RunRefusalsTable;
  users: UsersTable;
  tokens: TokensTable;
  repositories: RepositoriesTable;
}

/**
 * Migrations, in order. Append-only: a released migration never changes, a change of the schema
 * is a new one. Their names sort in the order they run.
 */
export const migrations: Record<string, Migration> = {
  '0001-tasks-runs-users': {
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable('users')
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('name', 'text', (column) => column.notNull())
        .addColumn('email', 'text')
        .addColumn('created_at', 'timestamptz', (column) => column.notNull())
        .execute();
      await db.schema
        .createTable('tokens')
        .addColumn('token_hash', 'text', (column) => column.primaryKey())
        .addColumn('user_id', 'text', (column) =>
          column.notNull().references('users.id').onDelete('cascade'),
        )
        .addColumn('label', 'text', (column) => column.notNull())
        .addColumn('created_at', 'timestamptz', (column) => column.notNull())
        .addColumn('revoked_at', 'timestamptz')
        .execute();
      await db.schema
        .createTable('tasks')
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('requester', 'text', (column) => column.notNull().references('users.id'))
        .addColumn('idempotency_key', 'text', (column) => column.notNull())
        .addColumn('project_id', 'text', (column) => column.notNull())
        .addColumn('state', 'text', (column) => column.notNull())
        .addColumn('version', 'integer', (column) => column.notNull())
        .addColumn('record', 'jsonb', (column) => column.notNull())
        .addColumn('created_at', 'timestamptz', (column) => column.notNull())
        .addColumn('updated_at', 'timestamptz', (column) => column.notNull())
        .addUniqueConstraint('tasks_submission', ['requester', 'idempotency_key'])
        .execute();
      await db.schema
        .createIndex('tasks_by_state')
        .on('tasks')
        .columns(['state', 'updated_at'])
        .execute();
      await db.schema
        .createTable('task_events')
        .addColumn('seq', 'bigserial', (column) => column.primaryKey())
        .addColumn('task_id', 'text', (column) =>
          column.notNull().references('tasks.id').onDelete('cascade'),
        )
        .addColumn('at', 'timestamptz', (column) => column.notNull())
        .addColumn('type', 'text', (column) => column.notNull())
        .addColumn('event', 'jsonb', (column) => column.notNull())
        .execute();
      await db.schema
        .createIndex('task_events_by_task')
        .on('task_events')
        .columns(['task_id', 'seq'])
        .execute();
      await db.schema
        .createTable('runs')
        .addColumn('id', 'text', (column) => column.primaryKey())
        .addColumn('task_id', 'text', (column) =>
          column.notNull().references('tasks.id').onDelete('cascade'),
        )
        .addColumn('state', 'text', (column) => column.notNull())
        .addColumn('record', 'jsonb', (column) => column.notNull())
        .addColumn('started_at', 'timestamptz', (column) => column.notNull())
        .execute();
      await db.schema.createIndex('runs_by_task').on('runs').column('task_id').execute();
      await db.schema
        .createTable('run_grants')
        .addColumn('run_id', 'text', (column) =>
          column.primaryKey().references('runs.id').onDelete('cascade'),
        )
        .addColumn('task_id', 'text', (column) => column.notNull())
        .addColumn('token_hash', 'text', (column) => column.notNull().unique())
        .addColumn('issued_at', 'timestamptz', (column) => column.notNull())
        .execute();
      // A grant's token is the run's: the receiver keeps only its hash.
      await sql`comment on table run_grants is 'Grants of model access for running runs; hashes only.'`.execute(
        db,
      );
    },
  },
  '0002-grant-terms-and-usage': {
    async up(db: Kysely<unknown>) {
      // A run has a grant per sandbox, each with its terms. Grants issued without terms cannot
      // be read by the gateway: their runs are fenced like any run whose grant is revoked.
      await sql`delete from run_grants`.execute(db);
      await db.schema.alterTable('run_grants').dropConstraint('run_grants_pkey').execute();
      await db.schema
        .alterTable('run_grants')
        .dropConstraint('run_grants_token_hash_key')
        .execute();
      await db.schema
        .alterTable('run_grants')
        .addPrimaryKeyConstraint('run_grants_pkey', ['token_hash'])
        .execute();
      await db.schema
        .alterTable('run_grants')
        .addColumn('terms', 'jsonb', (column) => column.notNull())
        .execute();
      await db.schema.createIndex('run_grants_run').on('run_grants').column('run_id').execute();
      await db.schema
        .createTable('run_usage')
        .addColumn('seq', 'bigserial', (column) => column.primaryKey())
        .addColumn('run_id', 'text', (column) => column.notNull())
        .addColumn('task_id', 'text', (column) => column.notNull())
        .addColumn('model', 'text', (column) => column.notNull())
        .addColumn('input_tokens', 'integer', (column) => column.notNull())
        .addColumn('output_tokens', 'integer', (column) => column.notNull())
        .addColumn('cache_write_tokens', 'integer', (column) => column.notNull())
        .addColumn('cache_read_tokens', 'integer', (column) => column.notNull())
        .addColumn('cost_usd', 'double precision', (column) => column.notNull())
        .addColumn('at', 'timestamptz', (column) => column.notNull())
        .execute();
      // Kept after the run and its task are gone: what was spent stays spent.
      await db.schema.createIndex('run_usage_task').on('run_usage').column('task_id').execute();
    },
  },
  '0003-run-refusals': {
    async up(db: Kysely<unknown>) {
      await db.schema
        .createTable('run_refusals')
        .addColumn('run_id', 'text', (column) => column.primaryKey())
        .addColumn('refusal', 'jsonb', (column) => column.notNull())
        .addColumn('at', 'timestamptz', (column) => column.notNull())
        .execute();
    },
  },
  '0004-usage-reservations': {
    async up(db: Kysely<unknown>) {
      // Each request is recorded as it is let through, with what it may cost at most, and
      // settled with what it did cost: what a task holds counts against its budget too.
      await db.schema.alterTable('run_usage').addColumn('reservation', 'text').execute();
      await db.schema
        .alterTable('run_usage')
        .addColumn('counted_tokens', 'bigint', (column) => column.notNull().defaultTo(0))
        .execute();
      await db.schema
        .alterTable('run_usage')
        .addColumn('settled', 'boolean', (column) => column.notNull().defaultTo(true))
        .execute();
      await sql`update run_usage set counted_tokens = input_tokens + output_tokens + cache_write_tokens`.execute(
        db,
      );
      await db.schema
        .createIndex('run_usage_reservation')
        .on('run_usage')
        .column('reservation')
        .unique()
        .execute();
    },
  },
  '0005-runs-ended': {
    async up(db: Kysely<unknown>) {
      // Whether a run is wanted is its task's to say; the run's row records when it ended.
      await db.schema.alterTable('runs').dropColumn('state').execute();
      await db.schema.alterTable('runs').addColumn('ended_at', 'timestamptz').execute();
    },
  },
  '0006-repositories': {
    async up(db: Kysely<unknown>) {
      // Found by the worker, which holds the git host's credentials; read by every role.
      await db.schema
        .createTable('repositories')
        .addColumn('name', 'text', (column) => column.primaryKey())
        .addColumn('base_branch', 'text', (column) => column.notNull())
        .addColumn('found_at', 'timestamptz', (column) => column.notNull())
        .execute();
    },
  },
};
