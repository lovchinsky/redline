import {
  SerialQueue,
  TaskId,
  appError,
  createDraft,
  err,
  ok,
  type AppError,
  type Logger,
  type Result,
} from '@redline/core';
import { describe, expect, it } from 'vitest';
import type { WorkspaceStore, WorkspaceWrite } from '../../ports/workspace';
import { WorkspaceWriter, type WorkspaceChange } from './workspace-writer';

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

const notFound = () => Promise.resolve(err(appError('not-found', 'missing')));

/** A store that records what it applied, can be told to fail, and tells when it has saved. */
const recordingStore = () => {
  const applied: (readonly WorkspaceWrite[])[] = [];
  const saves: ((count: number) => void)[] = [];
  let failing = false;
  const store: WorkspaceStore = {
    apply: (writes) => {
      if (failing) return Promise.resolve(err(appError('storage', 'disk full')));
      applied.push(writes);
      for (const saved of saves) saved(applied.length);
      return Promise.resolve(ok(undefined));
    },
  };
  return {
    store,
    applied,
    fail: () => {
      failing = true;
    },
    /** Resolves once `count` units of work have been saved. */
    saved: (count: number) =>
      new Promise<void>((resolve) => {
        saves.push((n) => {
          if (n >= count) resolve();
        });
      }),
  };
};

const writerWith = (store: WorkspaceStore, changed: (change: WorkspaceChange) => Promise<void>) =>
  new WorkspaceWriter({
    drafts: { get: notFound, list: () => Promise.resolve(ok([])) },
    tasks: { get: notFound, list: () => Promise.resolve(ok([])) },
    store,
    queue: new SerialQueue(),
    logger: silent,
    // Each unit of work's changes, one by one, in order.
    observers: [
      {
        name: 'test',
        changed: async (changes) => {
          for (const change of changes) await changed(change);
        },
      },
    ],
  });

const draft = createDraft(TaskId.parse('t1'), 0);

describe('WorkspaceWriter', () => {
  it('saves a unit of work in one apply, then cleans up, then announces', async () => {
    const { store, applied } = recordingStore();
    const order: string[] = [];
    const writer = writerWith(store, (change) => {
      order.push(`announce ${change.kind}`);
      return Promise.resolve();
    });
    await writer.run((tx) => {
      tx.saveDraft(null, draft);
      tx.setActive(draft.id);
      tx.afterCommit(() => {
        order.push(`clean up after ${String(applied.length)} apply`);
        return Promise.resolve();
      });
      return Promise.resolve(ok(undefined));
    });
    expect(applied).toEqual([
      [
        { kind: 'draft', id: 't1', value: draft },
        { kind: 'active', id: 't1' },
      ],
    ]);
    expect(order).toEqual(['clean up after 1 apply', 'announce draft', 'announce active']);
  });

  it('writes, cleans up and announces nothing for a unit of work that fails', async () => {
    const { store, applied } = recordingStore();
    const order: string[] = [];
    const writer = writerWith(store, () => {
      order.push('announce');
      return Promise.resolve();
    });
    const result = await writer.run((tx): Promise<Result<void, AppError>> => {
      tx.saveDraft(null, draft);
      tx.afterCommit(() => {
        order.push('clean up');
        return Promise.resolve();
      });
      return Promise.resolve(err(appError('conflict', 'changed meanwhile')));
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(applied).toEqual([]);
    expect(order).toEqual([]);
  });

  it('reports a store that could not save, and announces nothing', async () => {
    const { store, fail } = recordingStore();
    fail();
    const announced: WorkspaceChange[] = [];
    const writer = writerWith(store, (change) => {
      announced.push(change);
      return Promise.resolve();
    });
    const result = await writer.run((tx) => {
      tx.saveDraft(null, draft);
      return Promise.resolve(ok(undefined));
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'storage' } });
    expect(announced).toEqual([]);
  });

  it('lets the next unit of work go while observers still work, and keeps their order', async () => {
    const { store, saved } = recordingStore();
    const order: string[] = [];
    const gate = Promise.withResolvers<undefined>();
    const writer = writerWith(store, async (change) => {
      const id = change.kind === 'active' ? '' : change.id;
      order.push(`announce ${id}`);
      if (id === 'a') await gate.promise;
    });
    const first = writer.run((tx) => {
      tx.saveDraft(null, createDraft(TaskId.parse('a'), 0));
      return Promise.resolve(ok(undefined));
    });
    const second = writer.run((tx) => {
      order.push('write b');
      tx.saveDraft(null, createDraft(TaskId.parse('b'), 0));
      return Promise.resolve(ok(undefined));
    });
    // b is saved while a's observer is still busy; b is announced only after a.
    await saved(2);
    expect(order).toContain('write b');
    expect(order).not.toContain('announce b');
    gate.resolve(undefined);
    await Promise.all([first, second]);
    expect(order.filter((entry) => entry.startsWith('announce'))).toEqual([
      'announce a',
      'announce b',
    ]);
  });

  it('runs exclusive work in turn with units of work, writing nothing', async () => {
    const { store, applied } = recordingStore();
    const order: string[] = [];
    const writer = writerWith(store, () => Promise.resolve());
    const unit = writer.run((tx) => {
      order.push('unit');
      tx.saveDraft(null, draft);
      return Promise.resolve(ok(undefined));
    });
    const exclusive = writer.exclusive(() => {
      order.push(`exclusive after ${String(applied.length)} apply`);
      return Promise.resolve('done');
    });
    expect(await exclusive).toBe('done');
    await unit;
    expect(order).toEqual(['unit', 'exclusive after 1 apply']);
    expect(applied).toHaveLength(1);
  });
});
