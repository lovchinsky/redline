import {
  CoalescingRunner,
  applyRemoteReport,
  appError,
  deferStatusCheck,
  err,
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
import type { TaskRepository } from '../../ports/drafts';
import type { TaskWriter } from '../tasks/task-writer';
import { retryDelayMs } from './deliver-queued';

export interface FollowRemoteDeps {
  readonly tasks: TaskRepository;
  readonly receiver: ReceiverPort;
  readonly writer: TaskWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

type Done = Result<Record<string, never>, AppError>;

/** A receiver that forgot the task cannot report on it again: that is final. */
const forgotten = (error: AppError, remoteId: string): ReceiverReport | null =>
  error.code === 'not-found'
    ? {
        remoteId,
        status: { phase: 'failed', reason: 'The receiver no longer knows this task' },
        pollAfterSec: 1,
      }
    : null;

/**
 * Follows submitted tasks on the receiver: scheduled checks for everything due, an explicit
 * refresh of one task, and answers to the agent's questions. Each report is applied in the
 * write queue against the task as it is then, so a deleted task simply stops being followed.
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
    if (!applied.ok) this.deps.logger.error('Could not record a status', { ...applied.error });
  }

  private apply(
    taskId: TaskId,
    remoteId: string,
    report: Result<ReceiverReport, AppError>,
  ): Promise<Result<void, AppError>> {
    return this.deps.writer.run(async () => {
      const current = await this.deps.tasks.get(taskId);
      if (
        !current.ok ||
        current.value.state.kind !== 'submitted' ||
        current.value.state.remoteId !== remoteId
      ) {
        return ok(undefined);
      }
      const now = this.deps.clock.now();
      const known = report.ok ? report.value : forgotten(report.error, remoteId);
      if (!report.ok && known === null) {
        this.deps.logger.warn('Status check failed', { taskId, ...report.error });
      }
      const next =
        known !== null
          ? applyRemoteReport(current.value, known, now)
          : deferStatusCheck(current.value, now + retryDelayMs(1), now);
      if (!next.ok) return next;
      if (next.value === current.value) return ok(undefined);
      const saved = await this.deps.tasks.save(next.value);
      if (!saved.ok) return saved;
      await this.deps.writer.announce({ taskId, before: current.value, after: next.value });
      return ok(undefined);
    });
  }
}
