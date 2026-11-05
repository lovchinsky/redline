import type { AppProtocol, ProtocolHandlers } from '@redline/rpc';
import type { AssembleBundle } from './assemble-bundle';
import type {
  ActivateDraft,
  CreateDraft,
  DeleteDraft,
  EditDraft,
  RemoveStep,
} from './draft-commands';
import type { GetDraft, ListDrafts } from './draft-queries';

export interface DraftUseCases {
  readonly listDrafts: ListDrafts;
  readonly getDraft: GetDraft;
  readonly createDraft: CreateDraft;
  readonly activateDraft: ActivateDraft;
  readonly editDraft: EditDraft;
  readonly removeStep: RemoveStep;
  readonly deleteDraft: DeleteDraft;
  readonly assembleBundle: AssembleBundle;
}

type DraftMethods =
  | 'drafts.list'
  | 'drafts.get'
  | 'drafts.create'
  | 'drafts.activate'
  | 'drafts.rename'
  | 'steps.editComment'
  | 'steps.move'
  | 'steps.remove'
  | 'drafts.delete'
  | 'drafts.assemble';

export const createDraftHandlers = (
  useCases: DraftUseCases,
): Pick<ProtocolHandlers<AppProtocol>, DraftMethods> => ({
  'drafts.list': () => useCases.listDrafts.execute(),
  'drafts.get': ({ taskId }) => useCases.getDraft.execute(taskId),
  'drafts.create': () => useCases.createDraft.execute(),
  'drafts.activate': ({ taskId }) => useCases.activateDraft.execute(taskId),
  'drafts.rename': ({ taskId, title }) =>
    useCases.editDraft.execute(taskId, { kind: 'rename', title }),
  'steps.editComment': ({ taskId, stepId, comment }) =>
    useCases.editDraft.execute(taskId, { kind: 'edit-comment', stepId, comment }),
  'steps.move': ({ taskId, stepId, toIndex }) =>
    useCases.editDraft.execute(taskId, { kind: 'move-step', stepId, toIndex }),
  'steps.remove': ({ taskId, stepId }) => useCases.removeStep.execute(taskId, stepId),
  'drafts.delete': ({ taskId }) => useCases.deleteDraft.execute(taskId),
  'drafts.assemble': ({ taskId }) => useCases.assembleBundle.execute(taskId),
});
