import {
  SerialQueue,
  ok,
  type AppError,
  type Draft,
  type Logger,
  type Result,
  type Task,
  type TaskId,
} from '@redline/core';
import type {
  DraftRepository,
  TaskRepository,
  WorkspaceStore,
  WorkspaceWrite,
} from '../../ports/workspace';

/** One saved change of the workspace; `before` is `null` for a new entry, `after` for a deleted one. */
export type WorkspaceChange =
  | {
      readonly kind: 'draft';
      readonly id: TaskId;
      readonly before: Draft | null;
      readonly after: Draft | null;
    }
  | {
      readonly kind: 'task';
      readonly id: TaskId;
      readonly before: Task | null;
      readonly after: Task | null;
    }
  /** Another draft became the one new steps go to, or none did. */
  | { readonly kind: 'active'; readonly id: TaskId | null };

/**
 * Reacts to saved changes: UI events, the toolbar badge, notifications, wake-ups. Gets each
 * unit of work's changes together, so it can react once to what belongs together.
 */
export interface WorkspaceObserver {
  readonly name: string;
  changed(changes: readonly WorkspaceChange[]): Promise<void>;
}

/**
 * What a unit of work may do. Writes are collected and applied together when the work
 * succeeds; a work that fails writes nothing.
 */
export interface WorkspaceTransaction {
  saveDraft(before: Draft | null, after: Draft | null): void;
  saveTask(before: Task | null, after: Task | null): void;
  setActive(id: TaskId | null): void;
  /** Runs once the writes are saved, e.g. disposing of what a deleted step collected. */
  afterCommit(effect: () => Promise<void>): void;
}

export interface WorkspaceWriterDeps {
  readonly drafts: DraftRepository;
  readonly tasks: TaskRepository;
  readonly store: WorkspaceStore;
  readonly queue: SerialQueue;
  readonly observers: readonly WorkspaceObserver[];
  readonly logger: Logger;
}

/** What an update did: `after` is `before` itself when there was nothing to change. */
export interface Update<T> {
  readonly before: T;
  readonly after: T;
}

/**
 * The single way the service worker's workspace is written. Units of work run one at a time
 * (read → change → save cannot interleave between a step commit, an edit and a delivery), and
 * each is saved all together or not at all: a draft that becomes a task never shows up twice
 * or not at all. What was saved is announced afterwards, outside the queue and in order, so
 * observers only ever see complete state and the next write does not wait for them.
 */
export class WorkspaceWriter {
  /** Announcements run one after another too, so observers see changes in commit order. */
  private readonly announcements = new SerialQueue();

  constructor(private readonly deps: WorkspaceWriterDeps) {}

  /**
   * Runs a unit of work in its turn of the queue. Resolves once its changes are saved and
   * announced, so a caller that awaits it sees every effect, observers included.
   */
  async run<T>(
    work: (tx: WorkspaceTransaction) => Promise<Result<T, AppError>>,
  ): Promise<Result<T, AppError>> {
    const changes: WorkspaceChange[] = [];
    const result = await this.deps.queue.run(async () => {
      const writes: WorkspaceWrite[] = [];
      const pending: WorkspaceChange[] = [];
      const effects: (() => Promise<void>)[] = [];
      const tx: WorkspaceTransaction = {
        saveDraft: (before, after) => {
          const id = after?.id ?? before?.id;
          if (id === undefined) return;
          writes.push({ kind: 'draft', id, value: after });
          pending.push({ kind: 'draft', id, before, after });
        },
        saveTask: (before, after) => {
          const id = after?.id ?? before?.id;
          if (id === undefined) return;
          writes.push({ kind: 'task', id, value: after });
          pending.push({ kind: 'task', id, before, after });
        },
        setActive: (id) => {
          writes.push({ kind: 'active', id });
          pending.push({ kind: 'active', id });
        },
        afterCommit: (effect) => {
          effects.push(effect);
        },
      };
      const outcome = await work(tx);
      if (!outcome.ok) return outcome;
      const saved = await this.deps.store.apply(writes);
      if (!saved.ok) return saved;
      changes.push(...pending);
      for (const effect of effects) await this.runEffect(effect);
      return outcome;
    });
    if (changes.length > 0) await this.announcements.run(() => this.announce(changes));
    return result;
  }

  /**
   * Changes one draft in one unit of work: `decide` sees it as it is now and returns its next
   * version, the same draft when there is nothing to do, or why it cannot change.
   */
  updateDraft(
    id: TaskId,
    decide: (draft: Draft) => Result<Draft, AppError>,
  ): Promise<Result<Update<Draft>, AppError>> {
    return this.run(async (tx) => {
      const before = await this.deps.drafts.get(id);
      if (!before.ok) return before;
      const after = decide(before.value);
      if (!after.ok) return after;
      if (after.value !== before.value) tx.saveDraft(before.value, after.value);
      return ok({ before: before.value, after: after.value });
    });
  }

  /** Like `updateDraft`, for a sent task. */
  updateTask(
    id: TaskId,
    decide: (task: Task) => Result<Task, AppError>,
  ): Promise<Result<Update<Task>, AppError>> {
    return this.run(async (tx) => {
      const before = await this.deps.tasks.get(id);
      if (!before.ok) return before;
      const after = decide(before.value);
      if (!after.ok) return after;
      if (after.value !== before.value) tx.saveTask(before.value, after.value);
      return ok({ before: before.value, after: after.value });
    });
  }

  private async runEffect(effect: () => Promise<void>): Promise<void> {
    try {
      await effect();
    } catch (cause) {
      // The writes are saved; what follows them is cleanup that the garbage collector repeats.
      this.deps.logger.error('An after-commit effect failed', { cause: String(cause) });
    }
  }

  private async announce(changes: readonly WorkspaceChange[]): Promise<void> {
    for (const observer of this.deps.observers) {
      try {
        await observer.changed(changes);
      } catch (cause) {
        this.deps.logger.error('A workspace observer failed', {
          observer: observer.name,
          cause: String(cause),
        });
      }
    }
  }
}
