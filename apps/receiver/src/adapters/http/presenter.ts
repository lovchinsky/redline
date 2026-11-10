import type { RemoteStatus, TaskStateResponse } from '@redline/contract';
import { openExchange } from '../../domain/exchange';
import type { Task } from '../../domain/task';

/** How soon the extension should ask again, in seconds: often while things move, rarely after. */
export interface Polling {
  readonly queued: number;
  readonly working: number;
  readonly waiting: number;
  readonly finished: number;
}

const pollAfter = (task: Task, polling: Polling): number => {
  switch (task.state.kind) {
    case 'queued':
      return polling.queued;
    case 'running':
    case 'publishing':
      return polling.working;
    case 'awaiting-reply':
      return polling.waiting;
    case 'published':
    case 'failed':
    case 'cancelled':
      return polling.finished;
  }
};

/** A task as `receiver-api.v1` reports it. The domain does not know the contract's phases. */
export const statusOf = (task: Task): RemoteStatus => {
  const { state } = task;
  switch (state.kind) {
    case 'queued':
      return { phase: 'queued' };
    case 'running':
    case 'publishing':
      return { phase: 'working' };
    case 'awaiting-reply': {
      const open = openExchange(task.exchanges);
      if (open === null) return { phase: 'working' };
      const { question } = open;
      return {
        phase: 'needs-input',
        question: {
          id: question.id,
          text: question.text,
          ...(question.options.length > 0 ? { options: [...question.options] } : {}),
        },
      };
    }
    case 'published':
      return { phase: 'result-ready', resultUrl: state.changeRequest.url };
    case 'failed':
      return { phase: 'failed', reason: state.failure.message };
    case 'cancelled':
      return { phase: 'closed' };
  }
};

export const present = (task: Task, polling: Polling): TaskStateResponse => ({
  remoteId: task.id,
  status: statusOf(task),
  pollAfterSec: pollAfter(task, polling),
});
