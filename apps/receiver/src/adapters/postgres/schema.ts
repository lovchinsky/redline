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
  state: string;
  record: Json;
  started_at: Timestamp;
}

/** Grants of running runs. Only the hash of a grant is stored: the token itself is the sandbox's. */
export interface RunGrantsTable {
  run_id: string;
  task_id: string;
  token_hash: string;
  issued_at: Timestamp;
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

export interface Database {
  tasks: TasksTable;
  task_events: TaskEventsTable;
  runs: RunsTable;
  run_grants: RunGrantsTable;
  users: UsersTable;
  tokens: TokensTable;
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
      // The gateway reads grants with its own, narrower role.
      await sql`comment on table run_grants is 'Grants of model access for running runs; hashes only.'`.execute(
        db,
      );
    },
  },
};
