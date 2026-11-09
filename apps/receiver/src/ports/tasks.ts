import type { GrantTerms } from '../domain/grant';
import type { Instant, ProjectId, QuestionId, RunId, TaskId, UserId } from '../domain/ids';
import type { Run } from '../domain/run';
import type { Task, TaskEvent } from '../domain/task';

export type InsertResult =
  | { readonly inserted: true; readonly task: Task }
  /** Another submission with the same requester and idempotency key got there first. */
  | { readonly inserted: false; readonly existing: Task };

export interface TaskRepository {
  get(id: TaskId): Promise<Task | null>;
  /** The task a requester submitted under an idempotency key, if any. */
  findBySubmission(requester: UserId, idempotencyKey: string): Promise<Task | null>;
  insert(task: Task, idempotencyKey: string): Promise<InsertResult>;
  /**
   * Saves a task read at `task.version` and returns it at its new version, or null when the task
   * changed since it was read: the caller decides again on the task as it is now.
   */
  save(task: Task): Promise<Task | null>;
}

export interface RunRepository {
  get(id: RunId): Promise<Run | null>;
  insert(run: Run): Promise<void>;
  save(run: Run): Promise<void>;
}

/** Reads outside any unit of work, for answering requests. */
export interface TaskQueries {
  get(id: TaskId): Promise<Task | null>;
  findBySubmission(requester: UserId, idempotencyKey: string): Promise<Task | null>;
  history(id: TaskId): Promise<readonly TaskEvent[]>;
}

/** What happened to tasks, in order. Only ever appended to. */
export interface TaskHistory {
  append(taskId: TaskId, event: TaskEvent): Promise<void>;
}

/** Work the receiver does later, in another process or after a restart. */
export type Job =
  /** `projectId`: runs and publications are limited per project. */
  | { readonly queue: 'run'; readonly taskId: TaskId; readonly projectId: ProjectId }
  | { readonly queue: 'publish'; readonly taskId: TaskId; readonly projectId: ProjectId }
  | { readonly queue: 'reply-timeout'; readonly taskId: TaskId; readonly questionId: QuestionId }
  | { readonly queue: 'abort-run'; readonly taskId: TaskId; readonly runId: RunId }
  | { readonly queue: 'withdraw-change'; readonly taskId: TaskId };

export type JobQueue = Job['queue'];

/**
 * Schedules jobs as part of the unit of work that decided them: a job exists exactly when the
 * state change that called for it was committed. Jobs carry ids only; a handler reads the task
 * and acts on its state as it is then, so a job delivered twice does no harm.
 */
export interface JobScheduler {
  schedule(job: Job, startAfter: Instant | null): Promise<void>;
}

/** Grants of model access for runs; the gateway serves a run only while its grant exists. */
/** Grants of a run's sandboxes, issued with the run and revoked when it ends. */
export interface RunGrants {
  issue(terms: GrantTerms): Promise<GrantToken>;
  /** Revokes every grant of the run. */
  revoke(runId: RunId): Promise<void>;
}

/** The secret a run's sandbox presents to the gateway in place of any real credential. */
export type GrantToken = string & { readonly __grant: never };

/** Everything a unit of work may change, all committed together or not at all. */
export interface WorkScope {
  readonly tasks: TaskRepository;
  readonly runs: RunRepository;
  readonly history: TaskHistory;
  readonly jobs: JobScheduler;
  readonly grants: RunGrants;
}

export interface UnitOfWork {
  /** Runs `work` in one transaction: it commits when `work` resolves, and rolls back when it throws. */
  run<T>(work: (scope: WorkScope) => Promise<T>): Promise<T>;
}
