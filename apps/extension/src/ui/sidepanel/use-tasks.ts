import { isTerminal, type AppError, type Result, type TaskId } from '@redline/core';
import type { TaskSummary } from '@redline/rpc';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { UiServices } from '../services';

export interface TasksState {
  readonly loading: boolean;
  /** In flight, or waiting for the user (refused by the receiver). */
  readonly active: readonly TaskSummary[];
  /** Finished on the receiver. */
  readonly history: readonly TaskSummary[];
  readonly error: string | null;
}

export interface TaskActions {
  readonly retry: (taskId: TaskId) => void;
  readonly reopen: (taskId: TaskId) => void;
  readonly refresh: (taskId: TaskId) => void;
  readonly reply: (taskId: TaskId, questionId: string, text: string) => Promise<boolean>;
  readonly remove: (taskId: TaskId) => void;
}

const finished = (task: TaskSummary): boolean =>
  task.state.kind === 'submitted' && isTerminal(task.state.status);

/** Tasks past the draft stage, re-read whenever the service worker announces a change. */
export const useTasks = (services: UiServices): readonly [TasksState, TaskActions] => {
  const [state, setState] = useState<TasksState>({
    loading: true,
    active: [],
    history: [],
    error: null,
  });
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const id = ++latest.current;
    const list = await services.rpc.call('tasks.list', {});
    if (id !== latest.current) return;
    setState((s) =>
      list.ok
        ? {
            ...s,
            loading: false,
            active: list.value.tasks.filter((task) => !finished(task)),
            history: list.value.tasks.filter(finished),
          }
        : { ...s, loading: false, error: list.error.message },
    );
  }, [services]);

  useEffect(() => {
    void reload();
    return services.events.on('tasks.changed', () => void reload());
  }, [services, reload]);

  const actions = useMemo((): TaskActions => {
    const { rpc } = services;
    const report = (result: Result<unknown, AppError>) => {
      setState((s) => ({ ...s, error: result.ok ? null : result.error.message }));
      return result.ok;
    };
    const run = (request: Promise<Result<unknown, AppError>>) => {
      void request.then(report);
    };
    return {
      retry: (taskId) => {
        run(rpc.call('task.retry', { taskId }));
      },
      reopen: (taskId) => {
        run(rpc.call('task.reopen', { taskId }));
      },
      refresh: (taskId) => {
        run(rpc.call('task.refresh', { taskId }));
      },
      reply: async (taskId, questionId, text) =>
        report(await rpc.call('task.reply', { taskId, questionId, text })),
      remove: (taskId) => {
        run(rpc.call('tasks.delete', { taskId }));
      },
    };
  }, [services]);

  return [state, actions] as const;
};
