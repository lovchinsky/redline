import { CoalescingRunner, isActive, needsInput, type Logger, type Task } from '@redline/core';
import type { AppEvents, EventPublisher } from '@redline/rpc';
import type { ActivityIndicator, Notifier, TaskNotice, WakeUps } from '../../ports/delivery';
import type { ActiveDraftStore, TaskRepository } from '../../ports/workspace';
import type { WorkspaceChange, WorkspaceObserver } from '../workspace/workspace-writer';
import { taskTitleOf } from './task-title';

/** Tells UI contexts which task changed and which draft is active now. */
export class UiTaskEvents implements WorkspaceObserver {
  readonly name = 'ui-events';

  constructor(
    private readonly active: ActiveDraftStore,
    private readonly events: EventPublisher<AppEvents>,
    private readonly logger: Logger,
  ) {}

  /** One event per task a unit of work touched, however many writes it took. */
  async changed(changes: readonly WorkspaceChange[]): Promise<void> {
    const touched = new Set(changes.flatMap((change) => (change.id === null ? [] : [change.id])));
    if (touched.size === 0) return;
    const active = await this.active.get();
    for (const taskId of touched) {
      const published = this.events.publish('tasks.changed', {
        taskId,
        activeId: active.ok ? active.value : null,
      });
      if (!published.ok) {
        this.logger.error('Could not publish a task change', { ...published.error });
      }
    }
  }
}

/** Keeps the toolbar badge equal to the number of tasks in flight. */
export class ActivityObserver implements WorkspaceObserver {
  readonly name = 'activity';

  constructor(
    private readonly tasks: TaskRepository,
    private readonly indicator: ActivityIndicator,
  ) {}

  /** Recomputed from all tasks; a call during a pass gets one more pass, never a stale one. */
  private readonly runner = new CoalescingRunner(() => this.show());

  async changed(changes: readonly WorkspaceChange[]): Promise<void> {
    if (changes.some((change) => change.kind === 'task')) await this.refresh();
  }

  /** Also called when the worker starts, since the badge does not survive a browser restart. */
  refresh(): Promise<void> {
    return this.runner.run();
  }

  private async show(): Promise<void> {
    const tasks = await this.tasks.list();
    if (!tasks.ok) return;
    await this.indicator.show({
      active: tasks.value.filter(isActive).length,
      needsInput: tasks.value.filter(needsInput).length,
    });
  }
}

/** The notice a state change deserves, if any: only news the user has not caused. */
export const noticeFor = (before: Task | null, after: Task | null): TaskNotice | null => {
  if (after === null) return null;
  const base = { taskId: after.id, taskTitle: taskTitleOf(after) };
  const was = before?.state;
  const now = after.state;
  if (now.kind === 'failed' && was?.kind === 'queued') {
    return { ...base, kind: 'delivery-failed', reason: now.error.message };
  }
  if (now.kind === 'lost' && was?.kind === 'submitted') return { ...base, kind: 'lost' };
  if (now.kind !== 'submitted') return null;
  const previous = was?.kind === 'submitted' ? was.status : null;
  const status = now.status;
  const changed =
    previous === null ||
    previous.phase !== status.phase ||
    (status.phase === 'needs-input' &&
      previous.phase === 'needs-input' &&
      previous.question.id !== status.question.id);
  if (!changed) return null;
  switch (status.phase) {
    case 'needs-input':
      return { ...base, kind: 'needs-input', question: status.question.text };
    case 'result-ready':
      return { ...base, kind: 'result-ready', resultUrl: status.resultUrl };
    case 'failed':
      return { ...base, kind: 'remote-failed', reason: status.reason };
    default:
      return null;
  }
};

export class NotificationObserver implements WorkspaceObserver {
  readonly name = 'notifications';

  constructor(private readonly notifier: Notifier) {}

  async changed(changes: readonly WorkspaceChange[]): Promise<void> {
    for (const change of changes) {
      if (change.kind !== 'task') continue;
      const notice = noticeFor(change.before, change.after);
      if (notice !== null) await this.notifier.notify(notice);
    }
  }
}

/**
 * Keeps the two wake-ups at the earliest moment there is work: the next delivery attempt and
 * the next status check. Derived from the tasks every time, so it cannot drift from them.
 */
export class WakeUpPlanner implements WorkspaceObserver {
  readonly name = 'wake-ups';

  constructor(
    private readonly tasks: TaskRepository,
    private readonly wakeUps: WakeUps,
  ) {}

  /** Recomputed from all tasks; a call during a pass gets one more pass, never a stale one. */
  private readonly runner = new CoalescingRunner(() => this.schedule());

  async changed(changes: readonly WorkspaceChange[]): Promise<void> {
    if (changes.some((change) => change.kind === 'task')) await this.plan();
  }

  plan(): Promise<void> {
    return this.runner.run();
  }

  private async schedule(): Promise<void> {
    const tasks = await this.tasks.list();
    if (!tasks.ok) return;
    const earliest = (times: readonly number[]) => (times.length === 0 ? null : Math.min(...times));
    await this.wakeUps.schedule(
      'deliver',
      earliest(
        tasks.value.flatMap((task) =>
          task.state.kind === 'queued' ? [task.state.nextAttemptAt] : [],
        ),
      ),
    );
    await this.wakeUps.schedule(
      'check-statuses',
      earliest(
        tasks.value.flatMap((task) =>
          task.state.kind === 'submitted' && task.state.nextCheckAt !== null
            ? [task.state.nextCheckAt]
            : [],
        ),
      ),
    );
  }
}
