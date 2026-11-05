import type { AppProtocol, ProtocolHandlers } from '@redline/rpc';
import type { FollowRemote } from './follow-remote';
import type { ManageSettings } from './settings';
import type { ReopenDraft, ResolveDeliveryTarget, RetryDelivery, SubmitTask } from './submit-task';

export interface DeliveryUseCases {
  readonly resolveTarget: ResolveDeliveryTarget;
  readonly submitTask: SubmitTask;
  readonly retryDelivery: RetryDelivery;
  readonly reopenDraft: ReopenDraft;
  readonly followRemote: FollowRemote;
  readonly settings: ManageSettings;
}

type DeliveryMethods =
  | 'task.deliveryTarget'
  | 'task.submit'
  | 'task.retry'
  | 'task.reopen'
  | 'task.refresh'
  | 'task.reply'
  | 'receiver.get'
  | 'receiver.configure'
  | 'receiver.clear'
  | 'projects.list'
  | 'bindings.list'
  | 'bindings.set'
  | 'bindings.remove';

export const createDeliveryHandlers = ({
  resolveTarget,
  submitTask,
  retryDelivery,
  reopenDraft,
  followRemote,
  settings,
}: DeliveryUseCases): Pick<ProtocolHandlers<AppProtocol>, DeliveryMethods> => ({
  'task.deliveryTarget': ({ taskId }) => resolveTarget.execute(taskId),
  'task.submit': ({ taskId, project }) => submitTask.execute(taskId, project),
  'task.retry': ({ taskId }) => retryDelivery.execute(taskId),
  'task.reopen': ({ taskId }) => reopenDraft.execute(taskId),
  'task.refresh': ({ taskId }) => followRemote.refresh(taskId),
  'task.reply': ({ taskId, questionId, text }) => followRemote.reply(taskId, questionId, text),
  'receiver.get': () => settings.receiver(),
  'receiver.configure': ({ baseUrl, token }) => settings.configureReceiver(baseUrl, token),
  'receiver.clear': () => settings.clearReceiver(),
  'projects.list': () => settings.projects(),
  'bindings.list': () => settings.bindings(),
  'bindings.set': ({ pattern, project }) => settings.bind(pattern, project),
  'bindings.remove': ({ pattern }) => settings.unbind(pattern),
});
