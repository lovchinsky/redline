import type { TaskStatus } from '@redline/rpc';
import type { MessageKey, Translator } from '../../ports/i18n';
import type { Tone } from '../kit/Badge';
import { describeError } from '../shared/errors';

type RemotePhase = Extract<TaskStatus, { kind: 'with-agent' }>['remote']['phase'];

const REMOTE_PHASES: Readonly<Record<Exclude<RemotePhase, 'failed'>, MessageKey>> = {
  queued: 'remoteQueued',
  working: 'remoteWorking',
  'needs-input': 'remoteNeedsInput',
  'result-ready': 'remoteResultReady',
  closed: 'remoteClosed',
};

const REMOTE_TONES: Readonly<Record<RemotePhase, Tone>> = {
  queued: 'info',
  working: 'info',
  'needs-input': 'warning',
  'result-ready': 'success',
  failed: 'danger',
  closed: 'neutral',
};

/** One line on where a task is: sending, refused, or what the agent is doing. */
export const describeStatus = (t: Translator, status: TaskStatus): string => {
  switch (status.kind) {
    case 'sending':
      return status.retry === null
        ? t.text('stateQueued')
        : t.text('stateRetryAt', describeError(t, status.retry.problem), t.time(status.retry.at));
    case 'refused':
      return t.text('stateFailed', describeError(t, status.problem));
    case 'lost':
      return t.text('stateLost');
    case 'with-agent':
      // What the receiver last said stays true; a failed check only delays news.
      if (status.stale !== null) {
        return t.text(
          'stateCheckFailed',
          describeError(t, status.stale.problem),
          t.time(status.stale.nextCheckAt),
        );
      }
      return status.remote.phase === 'failed'
        ? t.text('remoteFailed', status.remote.reason)
        : t.text(REMOTE_PHASES[status.remote.phase]);
  }
};

/** How a task reads at a glance: waiting, in motion, needs you, done, or broken. */
export const toneOf = (status: TaskStatus): Tone => {
  switch (status.kind) {
    case 'sending':
      return status.retry === null ? 'neutral' : 'warning';
    case 'refused':
    case 'lost':
      return 'danger';
    case 'with-agent':
      return status.stale === null ? REMOTE_TONES[status.remote.phase] : 'warning';
  }
};

export const titleOf = (
  t: Translator,
  task: { readonly title: string | null; readonly firstComment: string | null },
): string => task.title ?? task.firstComment ?? t.text('emptyDraft');

/** Which project, how many steps, and when it last changed. */
export const metaOf = (
  t: Translator,
  task: { readonly projectName: string; readonly stepCount: number; readonly updatedAt: number },
): string =>
  `${task.projectName} · ${t.count('stepCount', task.stepCount)} · ${t.time(task.updatedAt)}`;
