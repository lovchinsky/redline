import {
  CoalescingRunner,
  applyRemoteReport,
  appError,
  deferStatusCheck,
  err,
  loseTrack,
  mayRefresh,
  ok,
  type AppError,
  type Clock,
  type Logger,
  type Result,
  type Task,
  type TaskId,
} from '@redline/core';
import type { ReceiverPort, ReceiverReport } from '../../ports/delivery';
import type { TaskRepository } from '../../ports/workspace';
import type { WorkspaceWriter } from '../workspace/workspace-writer';
import { nextRetryAt, toDeliveryError } from './retry-policy';

export interface FollowRemoteDeps {
  readonly tasks: TaskRepository;
  readonly receiver: ReceiverPort;
  readonly writer: WorkspaceWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

type Done = Result<Record<string, never>, AppError>;

/**
 * Follows submitted tasks on the receiver: scheduled checks for everything due, an explicit
 * refresh of one task, and answers to the agent's questions. Each report is applied in the
 * write queue against the task as it is then, so a deleted task simply stops being followed.
 * A receiver that no longer knows a task ends the following; any other failure is retried
 * with the same backoff as deliveries.
 */
export class FollowRemote {
  private readonly runner = new CoalescingRunner(() => this.checkDue());

  constructor(private readonly deps: FollowRemoteDeps) {}

  /** Asks the receiver about every task whose check is due. */
  checkStatuses(): Promise<void> {
    return this.runner.run();
  }

  /** Asks now about one task, unless the receiver's interval has not passed yet. */
  async refresh(taskId: TaskId): Promise<Done> {
    const task = await this.deps.tasks.get(taskId);
    if (!task.ok) return task;
    if (mayRefresh(task.value, this.deps.clock.now())) await this.check(task.value);
    return ok({});
  }

  /**
   * Sends the user's answer. The receiver treats a repeated answer to the same question as the
   * same answer, so sending it again after a lost response is safe.
   */
  async reply(taskId: TaskId, questionId: string, text: string): Promise<Done> {
    const task = await this.deps.tasks.get(taskId);
    if (!task.ok) return task;
    const { state } = task.value;
    if (
      state.kind !== 'submitted' ||
      state.status.phase !== 'needs-input' ||
      state.status.question.id !== questionId
    ) {
      return err(
        appError('conflict', 'The agent is not waiting for this answer', { reason: 'not-waiting' }),
      );
    }
    const answer = text.trim();
    if (answer === '')
      return err(appError('validation', 'The answer is empty', { reason: 'answer-empty' }));
    const report = await this.deps.receiver.reply(state.remoteId, { questionId, text: answer });
    if (!report.ok) return report;
    const applied = await this.apply(task.value.id, state.remoteId, report);
    return applied.ok ? ok({}) : applied;
  }

  private async checkDue(): Promise<void> {
    const tasks = await this.deps.tasks.list();
    if (!tasks.ok) return;
    const now = this.deps.clock.now();
    for (const task of tasks.value) {
      if (
        task.state.kind === 'submitted' &&
        task.state.nextCheckAt !== null &&
        task.state.nextCheckAt <= now
      ) {
        await this.check(task);
      }
    }
  }

  private async check(task: Task): Promise<void> {
    if (task.state.kind !== 'submitted') return;
    const report = await this.deps.receiver.getTask(task.state.remoteId);
    const applied = await this.apply(task.id, task.state.remoteId, report);
    if (!applied.ok && applied.error.code !== 'not-found') {
      this.deps.logger.error('Could not record a status', { ...applied.error });
    }
  }

  private async apply(
    taskId: TaskId,
    remoteId: string,
    report: Result<ReceiverReport, AppError>,
  ): Promise<Result<void, AppError>> {
    if (!report.ok) this.deps.logger.warn('Status check failed', { taskId, ...report.error });
    const applied = await this.deps.writer.updateTask(taskId, (current) => {
      // Deleted or no longer followed: the report is about a task that is gone.
      if (current.state.kind !== 'submitted' || current.state.remoteId !== remoteId) {
        return ok(current);
      }
      const now = this.deps.clock.now();
      if (report.ok) return applyRemoteReport(current, report.value, now);
      if (report.error.code === 'not-found') return loseTrack(current, now);
      return deferStatusCheck(
        current,
        toDeliveryError(report.error),
        nextRetryAt(current.state.checkFailures + 1, now, report.error),
        now,
      );
    });
    return applied.ok ? ok(undefined) : applied;
  }
}
