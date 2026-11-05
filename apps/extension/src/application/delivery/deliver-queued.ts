import {
  CoalescingRunner,
  appError,
  err,
  markDeliveryFailed,
  markSubmitted,
  ok,
  recordFailedAttempt,
  startDeliveryAttempt,
  type AppError,
  type Clock,
  type Logger,
  type Result,
  type Task,
} from '@redline/core';
import type { ReceiverPort, ReceiverReport } from '../../ports/delivery';
import type { BundleRepository } from '../../ports/drafts';
import type { TaskRepository } from '../../ports/workspace';
import type { WorkspaceWriter } from '../workspace/workspace-writer';
import { isTransient, nextRetryAt, toDeliveryError } from './retry-policy';

export interface DeliverQueuedDeps {
  readonly tasks: TaskRepository;
  readonly bundles: BundleRepository;
  readonly receiver: ReceiverPort;
  readonly writer: WorkspaceWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

type Queued = Extract<Task['state'], { kind: 'queued' }>;

/**
 * The outbox: delivers every queued task whose attempt is due. Queued tasks are the durable
 * record of what still has to be sent, so a stopped worker, a crash or being offline loses
 * nothing; the delivery id as `Idempotency-Key` makes a repeated send of an accepted bundle
 * return the same remote task instead of a duplicate. Each attempt is written down before the
 * request (write-ahead), so one that never returns still counts and backs off; network calls
 * run outside the write queue.
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

  /** Records the attempt before making it; null when the task is no longer due for one. */
  private async begin(task: Task): Promise<Queued | null> {
    const started = await this.deps.writer.updateTask(task.id, (current) => {
      const now = this.deps.clock.now();
      // Changed meanwhile (sent, refused, rescheduled): not this pass's to deliver.
      if (current.state.kind !== 'queued' || current.state.nextAttemptAt > now) return ok(current);
      return startDeliveryAttempt(current, nextRetryAt(current.state.attempts + 1, now), now);
    });
    if (!started.ok) {
      // Deleted meanwhile is not a failure; anything else is worth knowing about.
      if (started.error.code !== 'not-found') {
        this.deps.logger.error('Could not start a delivery attempt', { ...started.error });
      }
      return null;
    }
    const { before, after } = started.value;
    return after !== before && after.state.kind === 'queued' ? after.state : null;
  }

  private async send(task: Task, queued: Queued): Promise<Result<ReceiverReport, AppError>> {
    const { delivery } = queued;
    const stored = await this.deps.bundles.get(task.id);
    if (!stored.ok) return stored;
    if (stored.value?.bundle.digest !== delivery.digest) {
      return err(appError('not-found', 'The frozen bundle of this task is gone'));
    }
    return this.deps.receiver.submit({
      projectId: delivery.projectId,
      bundle: stored.value.bundle,
      idempotencyKey: delivery.id,
    });
  }

  private async deliver(due: Task): Promise<void> {
    const queued = await this.begin(due);
    if (queued === null) return;
    const outcome = await this.send(due, queued);

    const saved = await this.deps.writer.updateTask(due.id, (current) => {
      // Retried, reopened or sent meanwhile: this attempt's result no longer applies.
      if (current.state.kind !== 'queued' || current.state.delivery.id !== queued.delivery.id) {
        return ok(current);
      }
      const now = this.deps.clock.now();
      if (outcome.ok) return markSubmitted(current, outcome.value, now);
      const error = toDeliveryError(outcome.error);
      if (!isTransient(outcome.error)) return markDeliveryFailed(current, error, now);
      // Moved while this attempt was in flight (the user asked to retry now): that time stands.
      const moved = current.state.nextAttemptAt !== queued.nextAttemptAt;
      const retryAt = moved
        ? current.state.nextAttemptAt
        : nextRetryAt(current.state.attempts, now, outcome.error);
      return recordFailedAttempt(current, error, retryAt, now);
    });
    if (!saved.ok && saved.error.code !== 'not-found') {
      this.deps.logger.error('Could not record a delivery attempt', { ...saved.error });
    }
    if (!outcome.ok) {
      this.deps.logger.warn('Delivery attempt failed', { taskId: due.id, ...outcome.error });
    }
  }
}
