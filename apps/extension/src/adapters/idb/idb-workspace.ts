import {
  appError,
  draftSchema,
  err,
  ok,
  okVoid,
  parseWith,
  taskSchema,
  type AppError,
  type Draft,
  type Logger,
  type Result,
  type Task,
  type TaskId,
} from '@redline/core';
import type { IDBPTransaction } from 'idb';
import type * as z from 'zod/mini';
import type {
  DraftRepository,
  TaskRepository,
  WorkspaceStore,
  WorkspaceWrite,
} from '../../ports/workspace';
import type { DatabaseConnection } from './database';
import { storageError } from './errors';
import { ACTIVE_DRAFT_KEY } from './idb-active-draft-store';
import type { VfDatabaseSchema } from './schema';

/**
 * Reads the records of one store through their domain schema. A record that no longer matches
 * is reported, never trusted, and left in place (it is still the user's data); it never stops
 * the rest from being read.
 */
class SchemaReader<T> {
  /** Corrupt records already reported, so each is logged once per worker life. */
  private readonly reported = new Set<string>();

  constructor(
    private readonly connection: DatabaseConnection,
    private readonly store: 'drafts' | 'tasks',
    private readonly schema: z.ZodMiniType<T>,
    private readonly logger: Logger,
  ) {}

  async get(id: TaskId): Promise<Result<T, AppError>> {
    try {
      const db = await this.connection.get();
      const raw: unknown = await db.get(this.store, id);
      return raw === undefined
        ? err(appError('not-found', `Not found in ${this.store}`, { id }))
        : this.parse(raw);
    } catch (cause) {
      return err(storageError(cause, `Reading from ${this.store}`));
    }
  }

  async list(): Promise<Result<readonly T[], AppError>> {
    try {
      const db = await this.connection.get();
      const values: T[] = [];
      for (const raw of await db.getAll(this.store)) {
        const parsed = this.parse(raw);
        if (parsed.ok) values.push(parsed.value);
        else this.report(raw, parsed.error);
      }
      return ok(values);
    } catch (cause) {
      return err(storageError(cause, `Listing ${this.store}`));
    }
  }

  private parse(raw: unknown): Result<T, AppError> {
    const parsed = parseWith(this.schema, raw);
    return parsed.ok
      ? parsed
      : err(
          appError('storage', `A record in ${this.store} is corrupted`, {
            ...parsed.error.details,
          }),
        );
  }

  private report(raw: unknown, error: AppError): void {
    const id =
      typeof raw === 'object' && raw !== null && typeof (raw as { id?: unknown }).id === 'string'
        ? (raw as { id: string }).id
        : '(no id)';
    if (this.reported.has(id)) return;
    this.reported.add(id);
    this.logger.error('Skipping a corrupt stored record', { store: this.store, id, ...error });
  }
}

export class IdbDraftRepository implements DraftRepository {
  private readonly reader: SchemaReader<Draft>;

  constructor(connection: DatabaseConnection, logger: Logger) {
    this.reader = new SchemaReader(connection, 'drafts', draftSchema, logger);
  }

  get(id: TaskId): Promise<Result<Draft, AppError>> {
    return this.reader.get(id);
  }

  list(): Promise<Result<readonly Draft[], AppError>> {
    return this.reader.list();
  }
}

export class IdbTaskRepository implements TaskRepository {
  private readonly reader: SchemaReader<Task>;

  constructor(connection: DatabaseConnection, logger: Logger) {
    this.reader = new SchemaReader(connection, 'tasks', taskSchema, logger);
  }

  get(id: TaskId): Promise<Result<Task, AppError>> {
    return this.reader.get(id);
  }

  list(): Promise<Result<readonly Task[], AppError>> {
    return this.reader.list();
  }
}

const STORES = ['drafts', 'tasks', 'workspace'] as const;

type WorkspaceTransaction = IDBPTransaction<VfDatabaseSchema, typeof STORES, 'readwrite'>;

/** Queues one write; IndexedDB may refuse it right away (a value it cannot store). */
const request = (tx: WorkspaceTransaction, write: WorkspaceWrite): Promise<unknown> => {
  switch (write.kind) {
    case 'draft':
      return write.value === null
        ? tx.objectStore('drafts').delete(write.id)
        : tx.objectStore('drafts').put(write.value);
    case 'task':
      return write.value === null
        ? tx.objectStore('tasks').delete(write.id)
        : tx.objectStore('tasks').put(write.value);
    case 'active':
      return write.id === null
        ? tx.objectStore('workspace').delete(ACTIVE_DRAFT_KEY)
        : tx.objectStore('workspace').put(write.id, ACTIVE_DRAFT_KEY);
  }
};

/** Writes a unit of work in one IndexedDB transaction: all of it lands, or none. */
export class IdbWorkspaceStore implements WorkspaceStore {
  constructor(private readonly connection: DatabaseConnection) {}

  async apply(writes: readonly WorkspaceWrite[]): Promise<Result<void, AppError>> {
    if (writes.length === 0) return okVoid();
    try {
      const db = await this.connection.get();
      const tx = db.transaction(STORES, 'readwrite');
      const pending: Promise<unknown>[] = [tx.done];
      try {
        for (const write of writes) pending.push(request(tx, write));
      } catch (refused) {
        // Writes queued before the refused one would otherwise commit on their own.
        tx.abort();
        await Promise.allSettled(pending);
        throw refused;
      }
      // A write that fails later aborts the transaction by itself; every request is awaited.
      await Promise.all(pending);
      return okVoid();
    } catch (cause) {
      return err(storageError(cause, 'Saving the workspace'));
    }
  }
}
