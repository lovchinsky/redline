import type { AppError, Result, StepId, TaskId } from '@redline/core';
import type { DraftSummary, DraftView } from '@redline/rpc';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { UiServices } from '../services';

export interface DraftsState {
  readonly loading: boolean;
  readonly drafts: readonly DraftSummary[];
  /** The draft new steps go to; the panel always shows this one. */
  readonly activeId: TaskId | null;
  readonly draft: DraftView | null;
  /** The last failed action, until the next one succeeds. */
  readonly error: string | null;
}

/** Requests to the service worker; results arrive as `drafts.changed`, failures as `error`. */
export interface DraftActions {
  readonly create: () => void;
  readonly activate: (taskId: TaskId) => void;
  readonly rename: (taskId: TaskId, title: string) => void;
  readonly deleteDraft: (taskId: TaskId) => void;
  readonly editComment: (taskId: TaskId, stepId: StepId, comment: string) => void;
  readonly moveStep: (taskId: TaskId, stepId: StepId, toIndex: number) => void;
  readonly removeStep: (taskId: TaskId, stepId: StepId) => void;
}

const INITIAL: DraftsState = {
  loading: true,
  drafts: [],
  activeId: null,
  draft: null,
  error: null,
};

/**
 * Drafts as the side panel sees them. The service worker owns the data: actions are requests,
 * and the panel re-reads whenever it announces a change (from here, the page or another window).
 */
export const useDrafts = (services: UiServices): readonly [DraftsState, DraftActions] => {
  const [state, setState] = useState<DraftsState>(INITIAL);
  /** Changes can arrive in bursts; only the latest reload may update the state. */
  const latestReload = useRef(0);

  const reload = useCallback(async () => {
    const reloadId = ++latestReload.current;
    const list = await services.rpc.call('drafts.list', {});
    if (reloadId !== latestReload.current) return;
    if (!list.ok) {
      setState((s) => ({ ...s, loading: false, error: list.error.message }));
      return;
    }
    const { activeId, drafts } = list.value;
    const draft =
      activeId === null ? null : await services.rpc.call('drafts.get', { taskId: activeId });
    if (reloadId !== latestReload.current) return;
    setState((s) => ({
      ...s,
      loading: false,
      drafts,
      activeId,
      draft: draft?.ok ? draft.value : null,
      error: draft === null || draft.ok ? s.error : draft.error.message,
    }));
  }, [services]);

  useEffect(() => {
    void reload();
    return services.events.on('tasks.changed', () => void reload());
  }, [services, reload]);

  const actions = useMemo((): DraftActions => {
    const { rpc } = services;
    const run = (request: Promise<Result<unknown, AppError>>) => {
      void request.then((result) => {
        setState((s) => ({ ...s, error: result.ok ? null : result.error.message }));
      });
    };
    return {
      create: () => {
        run(rpc.call('drafts.create', {}));
      },
      activate: (taskId) => {
        run(rpc.call('drafts.activate', { taskId }));
      },
      rename: (taskId, title) => {
        run(rpc.call('drafts.rename', { taskId, title }));
      },
      deleteDraft: (taskId) => {
        run(rpc.call('tasks.delete', { taskId }));
      },
      editComment: (taskId, stepId, comment) => {
        run(rpc.call('steps.editComment', { taskId, stepId, comment }));
      },
      moveStep: (taskId, stepId, toIndex) => {
        run(rpc.call('steps.move', { taskId, stepId, toIndex }));
      },
      removeStep: (taskId, stepId) => {
        run(rpc.call('steps.remove', { taskId, stepId }));
      },
    };
  }, [services]);

  return [state, actions] as const;
};
