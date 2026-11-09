import type { Instant, TaskId } from '../domain/ids';
import { err, ok, type Result } from '../domain/result';
import type { Task, TaskConflict, Transition, TransitionResult } from '../domain/task';
import type { Clock } from '../ports/system';
import type { InsertResult, UnitOfWork, WorkScope } from '../ports/tasks';
import { closeRun } from './runs';

/** Optimistic writes that keep losing to concurrent ones: something is wrong, not just busy. */
const MAX_ATTEMPTS = 5;

/** Why a task did not move: it is not stored, or its state does not allow the transition. */
export type WriteRefusal = TaskConflict | { readonly code: 'not-found'; readonly message: string };

const TASK_GONE: WriteRefusal = { code: 'not-found', message: 'Unknown task' };

/**
 * Records what a transition did: its event, and its effects as jobs. A run the task is done
 * with is closed here, at once, with the task: its record says it is over, and its grants go,
 * so it cannot spend while its sandbox is being stopped.
 */
const carryOut = async (scope: WorkScope, task: Task, transition: Transition): Promise<void> => {
  const { event } = transition;
  if (event !== null) await scope.history.append(task.id, event);
  for (const effect of transition.effects) {
    if (effect.kind === 'end-run') await closeRun(scope, effect.runId, task.updatedAt);
    await scope.jobs.schedule({ taskId: task.id, projectId: task.projectId, effect });
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
    Result<{ readonly transition: Transition; readonly extra: T | undefined }, WriteRefusal>
  > {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      try {
        return await this.deps.uow.run(async (scope) => {
          const task = await scope.tasks.get(taskId);
          if (task === null) return err(TASK_GONE);
          const decided = decide(task, this.deps.clock.now());
          if (!decided.ok) return err(decided.error);
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
    // Not a conflict of the task's state: the job or request that asked is tried again.
    throw new Error(`Task ${taskId} kept changing while it was being saved`);
  }
}
