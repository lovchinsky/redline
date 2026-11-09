import type { RemoteStatus, TaskStateResponse } from '@redline/contract';
import { openExchange } from '../../domain/exchange';
import type { Task } from '../../domain/task';

/** How soon the extension should ask again: often while things move, rarely once they stop. */
const POLL_AFTER_SEC: Record<Task['state']['kind'], number> = {
  queued: 30,
  running: 60,
  'awaiting-reply': 60,
  publishing: 60,
  published: 3600,
  failed: 3600,
  cancelled: 3600,
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

export const present = (task: Task): TaskStateResponse => ({
  remoteId: task.id,
  status: statusOf(task),
  pollAfterSec: POLL_AFTER_SEC[task.state.kind],
});
