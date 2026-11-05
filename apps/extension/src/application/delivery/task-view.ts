import { isFinished, isTerminal, type Task } from '@redline/core';
import type { TaskAction, TaskStatus, TaskView } from '@redline/rpc';

const statusOf = (state: Task['state']): TaskStatus => {
  switch (state.kind) {
    case 'queued':
      return {
        kind: 'sending',
        attempts: state.attempts,
        retry:
          state.lastError === null ? null : { problem: state.lastError, at: state.nextAttemptAt },
      };
    case 'failed':
      return { kind: 'refused', problem: state.error };
    case 'submitted':
      return {
        kind: 'with-agent',
        remote: state.status,
        stale:
          state.checkError === null || state.nextCheckAt === null
            ? null
            : { problem: state.checkError, nextCheckAt: state.nextCheckAt },
      };
    case 'lost':
      return { kind: 'lost' };
  }
};

/** What the user may do: the same rules the use cases enforce, decided in one place. */
const actionsOf = (state: Task['state']): TaskAction[] => {
  switch (state.kind) {
    case 'queued':
      // Leaving the outbox mid-attempt is not offered; sending now is.
      return ['send-now'];
    case 'failed':
      return ['send-again', 'reopen', 'delete'];
    case 'lost':
      return ['delete'];
    case 'submitted': {
      const { status } = state;
      return [
        ...(isTerminal(status) ? [] : (['refresh'] as const)),
        ...(status.phase === 'needs-input' ? (['answer'] as const) : []),
        ...(status.phase === 'result-ready' ? (['open-result'] as const) : []),
        'delete',
      ];
    }
  }
};

/** A sent task as the UI shows it: where it is and what can be done, never how it is stored. */
export const taskViewOf = (task: Task): TaskView => {
  const { state } = task;
  return {
    id: task.id,
    title: task.title,
    firstComment: task.steps[0]?.comment ?? null,
    stepCount: task.steps.length,
    updatedAt: task.updatedAt,
    projectName: state.delivery.projectName,
    status: statusOf(state),
    actions: actionsOf(state),
    finished: isFinished(task),
  };
};
