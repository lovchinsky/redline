import type { Instant, TaskId } from '../domain/ids';
import { err, ok, type Result } from '../domain/result';
import type { Task, TaskEffect, Transition, TransitionResult } from '../domain/task';
import type { Clock } from '../ports/system';
import type { InsertResult, Job, UnitOfWork, WorkScope } from '../ports/tasks';
import { conflictError, notFound, type RequestError } from './errors';

/** Optimistic writes that keep losing to concurrent ones: something is wrong, not just busy. */
const MAX_ATTEMPTS = 5;

const jobOf = (task: Task, effect: TaskEffect): Job => {
  const taskId = task.id;
  switch (effect.kind) {
    case 'schedule-run':
      return { queue: 'run', taskId, projectId: task.projectId };
    case 'schedule-publish':
      return { queue: 'publish', taskId, projectId: task.projectId };
    case 'schedule-reply-timeout':
      return { queue: 'reply-timeout', taskId, questionId: effect.questionId };
    case 'abort-run':
      return { queue: 'abort-run', taskId, runId: effect.runId };
    case 'withdraw-change':
      return { queue: 'withdraw-change', taskId };
  }
};

const startAfter = (effect: TaskEffect): Instant | null =>
  effect.kind === 'schedule-run' ||
  effect.kind === 'schedule-publish' ||
  effect.kind === 'schedule-reply-timeout'
    ? effect.at
    : null;

/**
 * Records what a transition did: its event, and its effects as jobs. An aborted run also loses
 * its grant here, at once, so it cannot spend while its sandbox is being stopped.
 */
const carryOut = async (scope: WorkScope, task: Task, transition: Transition): Promise<void> => {
  if (transition.event !== null) await scope.history.append(task.id, transition.event);
  for (const effect of transition.effects) {
    if (effect.kind === 'abort-run') await scope.grants.revoke(effect.runId);
    await scope.jobs.schedule(jobOf(task, effect), startAfter(effect));
  }
};

/**
 * Commits a transition inside a unit of work: the task at its next version, then what it did.
 * Returns the saved task, or null when the task changed since it was read: the transition was
 * decided on a stale task and must be decided again.
 */
export const commitTransition = async (
  scope: WorkScope,
  transition: Transition,
): Promise<Task | null> => {
  if (transition.event === null) return transition.task;
  const saved = await scope.tasks.save(transition.task);
  if (saved === null) return null;
  await carryOut(scope, saved, transition);
  return saved;
};

/** Thrown inside a unit of work to roll it back and decide again on the current task. */
class StaleTask extends Error {}

export type Decision = (task: Task, now: Instant) => TransitionResult;

/**
 * Changes tasks only through domain transitions, each in its own unit of work. A transition
 * decided on a task that changed meanwhile is decided again on the task as it is now, so
 * `decide` must be a pure function of the task and the time.
 */
export class TaskWriter {
  constructor(private readonly deps: { readonly uow: UnitOfWork; readonly clock: Clock }) {}

  /** Inserts a submitted task; a task submitted earlier with the same key is returned instead. */
  async create(transition: Transition, idempotencyKey: string): Promise<InsertResult> {
    return this.deps.uow.run(async (scope) => {
      const inserted = await scope.tasks.insert(transition.task, idempotencyKey);
      if (inserted.inserted) await carryOut(scope, inserted.task, transition);
      return inserted;
    });
  }

  /**
   * Applies `decide` to the task, and `alongside` (if given) in the same unit of work, with the
   * committed transition: for records that change together with the task.
   */
  async update<T = undefined>(
    taskId: TaskId,
    decide: Decision,
    alongside?: (scope: WorkScope, transition: Transition) => Promise<T>,
  ): Promise<
    Result<{ readonly transition: Transition; readonly extra: T | undefined }, RequestError>
  > {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.deps.uow.run(async (scope) => {
          const task = await scope.tasks.get(taskId);
          if (task === null) return err(notFound());
          const decided = decide(task, this.deps.clock.now());
          if (!decided.ok) return err(conflictError(decided.error.message));
          const saved = await commitTransition(scope, decided.value);
          if (saved === null) throw new StaleTask();
          const transition = { ...decided.value, task: saved };
          const extra = alongside === undefined ? undefined : await alongside(scope, transition);
          return ok({ transition, extra });
        });
      } catch (error) {
        if (!(error instanceof StaleTask)) throw error;
      }
    }
    return err(conflictError('The task keeps changing; try again'));
  }

  /** Schedules a job outside any transition, e.g. a run for a task whose credential came back. */
  async schedule(job: Job): Promise<void> {
    await this.deps.uow.run((scope) => scope.jobs.schedule(job, null));
  }
}
