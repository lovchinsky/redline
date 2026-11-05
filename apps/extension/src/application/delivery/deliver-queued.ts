import {
  CoalescingRunner,
  markDeliveryFailed,
  markSubmitted,
  ok,
  recordFailedAttempt,
  type AppError,
  type Clock,
  type DeliveryError,
  type Logger,
  type Result,
  type Task,
} from '@redline/core';
import type { ReceiverPort, ReceiverReport } from '../../ports/delivery';
import type { BundleRepository, TaskRepository } from '../../ports/drafts';
import type { TaskWriter } from '../tasks/task-writer';

const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 30 * 60_000;

/** Failures that may pass by themselves; anything else needs the user. */
const TRANSIENT: ReadonlySet<AppError['code']> = new Set([
  'receiver-unavailable',
  'timeout',
  'transport',
  'not-configured',
]);

export const isTransient = (error: AppError): boolean => TRANSIENT.has(error.code);

/**
 * When to try again after `attempts` failures: 30 s, doubling, at most 30 min, and never
 * sooner than the receiver asked for with `Retry-After`.
 */
export const retryDelayMs = (attempts: number, retryAfterSec?: number): number =>
  Math.max(
    Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, attempts - 1)),
    (retryAfterSec ?? 0) * 1000,
  );

const retryAfterOf = (error: AppError): number | undefined => {
  const value = error.details?.['retryAfterSec'];
  return typeof value === 'number' ? value : undefined;
};

const asDeliveryError = (error: AppError): DeliveryError => ({
  code: error.code,
  message: error.message,
});

export interface DeliverQueuedDeps {
  readonly tasks: TaskRepository;
  readonly bundles: BundleRepository;
  readonly receiver: ReceiverPort;
  readonly writer: TaskWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * The outbox: delivers every queued task whose attempt is due. Queued tasks are the durable
 * record of what still has to be sent, so a stopped worker, a crash or being offline loses
 * nothing; the task id as `Idempotency-Key` makes a repeated send of an accepted bundle return
 * the same remote task instead of a duplicate. Network calls run outside the write queue.
 */
export class DeliverQueued {
  private readonly runner = new CoalescingRunner(() => this.pass());

  constructor(private readonly deps: DeliverQueuedDeps) {}

  /** Delivers what is due now; concurrent calls share one pass plus at most one more. */
  run(): Promise<void> {
    return this.runner.run();
  }

  private async pass(): Promise<void> {
    const tasks = await this.deps.tasks.list();
    if (!tasks.ok) {
      this.deps.logger.error('Could not read the outbox', { ...tasks.error });
      return;
    }
    const now = this.deps.clock.now();
    const due = tasks.value
      .filter((task) => task.state.kind === 'queued' && task.state.nextAttemptAt <= now)
      .sort((a, b) => a.updatedAt - b.updatedAt);
    for (const task of due) await this.deliver(task);
  }

  private async deliver(task: Task): Promise<void> {
    if (task.state.kind !== 'queued') return;
    const { projectId, digest } = task.state;
    const stored = await this.deps.bundles.get(task.id);
    const outcome: Result<ReceiverReport, AppError> = !stored.ok
      ? stored
      : stored.value?.bundle.digest !== digest
        ? {
            ok: false,
            error: { code: 'not-found', message: 'The frozen bundle of this task is gone' },
          }
        : await this.deps.receiver.submit({
            projectId,
            bundle: stored.value.bundle,
            idempotencyKey: task.id,
          });

    const saved = await this.deps.writer.run(async () => {
      const current = await this.deps.tasks.get(task.id);
      // Deleted, retried or reopened meanwhile: this attempt's result no longer applies.
      if (
        !current.ok ||
        current.value.state.kind !== 'queued' ||
        current.value.state.digest !== digest
      ) {
        return ok(undefined);
      }
      const now = this.deps.clock.now();
      const next = outcome.ok
        ? markSubmitted(current.value, outcome.value, now)
        : isTransient(outcome.error)
          ? recordFailedAttempt(
              current.value,
              asDeliveryError(outcome.error),
              now + retryDelayMs(current.value.state.attempts + 1, retryAfterOf(outcome.error)),
              now,
            )
          : markDeliveryFailed(current.value, asDeliveryError(outcome.error), now);
      if (!next.ok) return next;
      const written = await this.deps.tasks.save(next.value);
      if (!written.ok) return written;
      await this.deps.writer.announce({
        taskId: task.id,
        before: current.value,
        after: next.value,
      });
      return ok(undefined);
    });
    if (!saved.ok)
      this.deps.logger.error('Could not record a delivery attempt', { ...saved.error });
    if (!outcome.ok) {
      this.deps.logger.warn('Delivery attempt failed', { taskId: task.id, ...outcome.error });
    }
  }
}
