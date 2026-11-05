import {
  SerialQueue,
  TaskId,
  createDraft,
  ok,
  type Logger,
  type Result,
  type Task,
} from '@redline/core';
import { describe, expect, it } from 'vitest';
import type { TaskRepository } from '../../ports/drafts';
import { TaskWriter, type TaskChange } from './task-writer';

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

const memoryTasks = (): TaskRepository => {
  const stored = new Map<string, Task>();
  return {
    get: (id) => {
      const task = stored.get(id);
      return Promise.resolve(
        task === undefined
          ? { ok: false, error: { code: 'not-found', message: 'missing' } }
          : ok(task),
      );
    },
    list: () => Promise.resolve(ok([...stored.values()])),
    save: (task) => {
      stored.set(task.id, task);
      return Promise.resolve(ok(undefined));
    },
    delete: (id) => {
      stored.delete(id);
      return Promise.resolve(ok(undefined));
    },
  };
};

describe('TaskWriter', () => {
  it('announces after the work, so observers see everything it wrote, in any order', async () => {
    let active: string | null = null;
    const seen: (string | null)[] = [];
    const writer = new TaskWriter({
      tasks: memoryTasks(),
      queue: new SerialQueue(),
      logger: silent,
      observers: [
        {
          name: 'reads-other-state',
          taskChanged: () => {
            seen.push(active);
            return Promise.resolve();
          },
        },
      ],
    });
    const draft = createDraft(TaskId.parse('t1'), 0);
    await writer.run(async (tx): Promise<Result<void, never>> => {
      await tx.commit(null, draft); // saved first…
      active = draft.id; // …the other state after
      return ok(undefined);
    });
    expect(seen).toEqual(['t1']);
  });

  it('lets the next write go while observers still work, and keeps their order', async () => {
    const order: string[] = [];
    const gate = Promise.withResolvers<undefined>();
    const slow = gate.promise;
    const release = () => {
      gate.resolve(undefined);
    };
    const writer = new TaskWriter({
      tasks: memoryTasks(),
      queue: new SerialQueue(),
      logger: silent,
      observers: [
        {
          name: 'slow',
          taskChanged: async ({ taskId }: TaskChange) => {
            order.push(`announce ${taskId}`);
            if (taskId === 'a') await slow;
          },
        },
      ],
    });
    const first = writer.run(async (tx) => {
      await tx.commit(null, createDraft(TaskId.parse('a'), 0));
      return ok(undefined);
    });
    const second = writer.run(async (tx) => {
      order.push('write b');
      await tx.commit(null, createDraft(TaskId.parse('b'), 0));
      return ok(undefined);
    });
    await Promise.resolve().then(() => new Promise((resolve) => setTimeout(resolve, 0)));
    // b is written while a's observer is still busy; b is announced only after a.
    expect(order).toContain('write b');
    expect(order).not.toContain('announce b');
    release();
    await Promise.all([first, second]);
    expect(order.filter((entry) => entry.startsWith('announce'))).toEqual([
      'announce a',
      'announce b',
    ]);
  });
});
