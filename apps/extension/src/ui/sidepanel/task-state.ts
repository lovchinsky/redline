import type { TaskSummary } from '@redline/rpc';
import type { MessageKey, Translator } from '../../ports/i18n';
import type { Tone } from '../kit/Badge';
import { describeError } from '../shared/errors';

type RemotePhase = Extract<TaskSummary['state'], { kind: 'submitted' }>['status']['phase'];

const REMOTE_PHASES: Readonly<Record<Exclude<RemotePhase, 'failed'>, MessageKey>> = {
  queued: 'remoteQueued',
  working: 'remoteWorking',
  'needs-input': 'remoteNeedsInput',
  'result-ready': 'remoteResultReady',
  closed: 'remoteClosed',
};

/** One line on where a task is: delivery attempts, refusal, or what the agent is doing. */
export const describeTaskState = (t: Translator, { state }: TaskSummary): string => {
  switch (state.kind) {
    case 'draft':
      return '';
    case 'queued':
      return state.lastError === null
        ? t.text('stateQueued')
        : t.text('stateRetryAt', describeError(t, state.lastError), t.time(state.nextAttemptAt));
    case 'failed':
      return t.text('stateFailed', describeError(t, state.error));
    case 'submitted':
      return state.status.phase === 'failed'
        ? t.text('remoteFailed', state.status.reason)
        : t.text(REMOTE_PHASES[state.status.phase]);
  }
};

export const titleOf = (
  t: Translator,
  task: { readonly title: string | null; readonly firstComment: string | null },
): string => task.title ?? task.firstComment ?? t.text('emptyDraft');

/** How a task's state reads at a glance: waiting, in motion, needs you, done, or broken. */
export const toneOf = ({ state }: TaskSummary): Tone => {
  switch (state.kind) {
    case 'draft':
      return 'neutral';
    case 'queued':
      return state.lastError === null ? 'neutral' : 'warning';
    case 'failed':
      return 'danger';
    case 'submitted':
      return REMOTE_TONES[state.status.phase];
  }
};

const REMOTE_TONES: Readonly<Record<RemotePhase, Tone>> = {
  queued: 'info',
  working: 'info',
  'needs-input': 'warning',
  'result-ready': 'success',
  failed: 'danger',
  closed: 'neutral',
};
