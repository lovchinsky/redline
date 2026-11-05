/**
 * The service worker's real object graph (`createBackgroundServices`) behind real RPC, with
 * in-memory platform adapters: fake IndexedDB, in-memory storage, and the mock receiver over
 * real HTTP. What these tests exercise is what the extension runs.
 */
import { startMockReceiver, type MockReceiver } from '@redline/mock-receiver';
import {
  StepId,
  type AppError,
  type AssetId,
  type Logger,
  type Result,
  type TaskId,
} from '@redline/core';
import {
  EventSubscriber,
  RpcClient,
  RpcServer,
  events,
  protocol,
  type StepRecord,
} from '@redline/rpc';
import { createInMemoryBus } from '@redline/rpc/testing';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DatabaseConnection, openDatabase } from '../adapters/idb/database';
import { memoryStorageArea } from '../adapters/storage/storage-area';
import { GARBAGE_GRACE_MS } from '../application/drafts/collect-garbage';
import type { TaskNotice, WakeUpReason } from '../ports/delivery';
import { createBackgroundServices } from './background.services';

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

const value = <T>(result: Result<T, AppError>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};

const unused = () => Promise.reject(new Error('not used in these tests'));

const record = (comment: string, url = 'https://acme.io/orders/42'): StepRecord => ({
  url,
  title: 'Orders',
  intent: 'layout',
  comment,
  viewport: { width: 1280, height: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
  shapeIds: ['shape-1'],
});

const setup = () => {
  globalThis.indexedDB = new IDBFactory();
  let now = 1_000_000;
  let n = 0;
  const bus = createInMemoryBus({});
  const notices: TaskNotice[] = [];
  const wakeUps = new Map<WakeUpReason, number | null>();
  const activity: { active: number; needsInput: number }[] = [];
  const changes: unknown[] = [];

  const services = createBackgroundServices(
    {
      version: '0.1.0',
      clock: { now: () => now },
      ids: { next: () => `id-${String(++n)}` },
      database: new DatabaseConnection(() => openDatabase({ name: 'sw', logger: silentLogger })),
      storage: memoryStorageArea(),
      fetch: (input, init) => fetch(input, init),
      eventSink: bus.sink,
      wakeUps: {
        schedule: (reason, time) => {
          wakeUps.set(reason, time);
          return Promise.resolve();
        },
      },
      notifier: {
        notify: (notice) => {
          notices.push(notice);
          return Promise.resolve();
        },
      },
      activity: {
        show: (shown) => {
          activity.push(shown);
          return Promise.resolve();
        },
      },
      notice: { show: () => Promise.resolve(), clear: () => Promise.resolve() },
      injector: { inject: unused },
      tabs: { start: unused },
      capturer: { capture: unused },
      deriver: { derive: unused },
    },
    silentLogger,
  );
  new RpcServer(protocol, services.handlers, silentLogger).listen(bus.server);
  new EventSubscriber(events, bus.source, silentLogger).on('tasks.changed', (payload) =>
    changes.push(payload),
  );
  const rpc = new RpcClient(protocol, bus.client, { next: () => `rpc-${String(++n)}` });

  /** Commits a step whose context is a screenshot with a stored crop, as a page would. */
  const commit = async (comment: string, url?: string) => {
    const crop = value(await services.assets.put(new Blob([comment], { type: 'image/png' })));
    return value(
      await rpc.call('capture.commitStep', {
        step: record(comment, url),
        capture: {
          fragments: [
            {
              kind: 'screenshot',
              version: 1,
              target: { level: 'shape', shapeId: 'shape-1' },
              priority: 'high',
              data: { images: [{ role: 'crop', assetId: crop.id, width: 10, height: 10 }] },
              assets: [crop],
            },
          ],
          diagnostics: [],
        },
      }),
    );
  };

  return {
    rpc,
    services,
    commit,
    notices,
    wakeUps,
    activity,
    changes,
    advance: (ms: number) => {
      now += ms;
    },
    now: () => now,
  };
};

let app: ReturnType<typeof setup>;
beforeEach(() => {
  app = setup();
});

const comments = async (taskId: TaskId) =>
  value(await app.rpc.call('drafts.get', { taskId })).steps.map((step) => step.comment);

const stateOf = async (taskId: TaskId) => {
  const { tasks } = value(await app.rpc.call('tasks.list', {}));
  return tasks.find((task) => task.id === taskId)?.state;
};

describe('drafts', () => {
  it('starts a draft on the first step and keeps adding to it', async () => {
    const first = await app.commit('Cards must align');
    const second = await app.commit('Fix the badge');
    expect(second.taskId).toBe(first.taskId);
    expect(second.stepCount).toBe(2);

    const { activeId, drafts } = value(await app.rpc.call('drafts.list', {}));
    expect(activeId).toBe(first.taskId);
    expect(drafts).toMatchObject([
      { id: first.taskId, stepCount: 2, firstComment: 'Cards must align' },
    ]);
    expect(app.changes).toHaveLength(2);
  });

  it('records the route pattern of the page and offers a thumbnail', async () => {
    const { taskId } = await app.commit('Cards must align');
    const [step] = value(await app.rpc.call('drafts.get', { taskId })).steps;
    expect(step?.page.routePattern).toBe('/orders/:param');
    expect(step?.thumbnail?.mediaType).toBe('image/png');
  });

  it('serializes concurrent commits into one draft', async () => {
    const results = await Promise.all([app.commit('a'), app.commit('b'), app.commit('c')]);
    expect(new Set(results.map((r) => r.taskId)).size).toBe(1);
    expect(await comments(results[0].taskId)).toEqual(['a', 'b', 'c']);
  });

  it('rejects context that does not match its schema and stores nothing', async () => {
    const { taskId } = await app.commit('valid');
    const bad = await app.rpc.call('capture.commitStep', {
      step: record('bad'),
      capture: {
        fragments: [
          {
            kind: 'screenshot',
            version: 1,
            target: { level: 'step' },
            priority: 'high',
            data: { images: 'nope' },
            assets: [],
          },
        ],
        diagnostics: [],
      },
    });
    expect(bad).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await comments(taskId)).toEqual(['valid']);
  });

  it('sends new steps to a newly created or re-activated draft', async () => {
    const first = await app.commit('one');
    const created = value(await app.rpc.call('drafts.create', {}));
    expect((await app.commit('two')).taskId).toBe(created.taskId);
    value(await app.rpc.call('drafts.activate', { taskId: first.taskId }));
    expect((await app.commit('three')).taskId).toBe(first.taskId);
    expect(await comments(first.taskId)).toEqual(['one', 'three']);
  });

  it('edits, moves and renames', async () => {
    const { taskId } = await app.commit('one');
    const { stepId } = await app.commit('two');
    value(await app.rpc.call('steps.editComment', { taskId, stepId, comment: 'TWO' }));
    value(await app.rpc.call('steps.move', { taskId, stepId, toIndex: 0 }));
    value(await app.rpc.call('drafts.rename', { taskId, title: 'Orders page' }));
    const draft = value(await app.rpc.call('drafts.get', { taskId }));
    expect(draft.steps.map((s) => s.comment)).toEqual(['TWO', 'one']);
    expect(draft.title).toBe('Orders page');
  });

  it('removing a step deletes its context and images', async () => {
    const { taskId, stepId } = await app.commit('one');
    const [thumbnail] = value(await app.rpc.call('drafts.get', { taskId })).steps.map(
      (s) => s.thumbnail,
    );
    value(await app.rpc.call('steps.remove', { taskId, stepId }));
    expect(await comments(taskId)).toEqual([]);
    expect(await app.services.assets.get(thumbnail?.id as AssetId)).toMatchObject({ ok: false });
  });

  it('deleting the active draft clears it; the next step starts a new one', async () => {
    const { taskId } = await app.commit('one');
    value(await app.rpc.call('tasks.delete', { taskId }));
    expect(value(await app.rpc.call('drafts.list', {}))).toEqual({ activeId: null, drafts: [] });
    expect((await app.commit('two')).taskId).not.toBe(taskId);
  });

  it('reports unknown steps and drafts', async () => {
    const { taskId } = await app.commit('one');
    expect(
      await app.rpc.call('steps.remove', { taskId, stepId: StepId.parse('ghost') }),
    ).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await app.rpc.call('drafts.get', { taskId: 'ghost' as TaskId })).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
  });
});

describe('assembling', () => {
  it('reuses the frozen bundle until the task changes', async () => {
    const { taskId, stepId } = await app.commit('one');
    await app.commit('two');
    const first = value(await app.rpc.call('task.assemble', { taskId }));
    app.advance(60_000);
    expect(value(await app.rpc.call('task.assemble', { taskId }))).toEqual(first);
    expect(first.files.map((f) => f.path)).toContain('context.md');

    value(await app.rpc.call('steps.editComment', { taskId, stepId, comment: 'ONE' }));
    const edited = value(await app.rpc.call('task.assemble', { taskId }));
    expect(edited.revision).toBeGreaterThan(first.revision);
    expect(edited.digest).not.toBe(first.digest);
  });

  it('refuses an empty draft', async () => {
    const { taskId } = value(await app.rpc.call('drafts.create', {}));
    expect(await app.rpc.call('task.assemble', { taskId })).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });
});

describe('garbage collection', () => {
  it('deletes old unreferenced images but keeps everything a draft uses', async () => {
    const orphan = value(await app.services.assets.put(new Blob(['snapshot'])));
    const { taskId } = await app.commit('one');
    const [kept] = value(await app.rpc.call('drafts.get', { taskId })).steps.map(
      (s) => s.thumbnail,
    );
    expect(value(await app.services.collectGarbage.execute())).toEqual({ captures: 0, assets: 0 });
    app.advance(GARBAGE_GRACE_MS + 1);
    expect(value(await app.services.collectGarbage.execute())).toEqual({ captures: 0, assets: 1 });
    expect(await app.services.assets.get(orphan.id)).toMatchObject({ ok: false });
    expect((await app.services.assets.get(kept?.id as AssetId)).ok).toBe(true);
  });
});

describe('delivery', () => {
  let receiver: MockReceiver;
  const acme = { id: 'acme-web', name: 'Acme Web' } as const;

  beforeEach(async () => {
    receiver = await startMockReceiver({ token: 'secret' });
    value(
      await app.rpc.call('receiver.configure', { baseUrl: `${receiver.url}/`, token: 'secret' }),
    );
  });
  afterEach(async () => {
    await receiver.close();
  });

  /** Waits until the outbox (which runs in the background after submit) has settled. */
  const delivered = () => app.services.outbox.run();
  const project = (id: string = acme.id) => ({ id: id as never, name: acme.name });

  it('accepts only https receivers (http on localhost) and never exposes the token', async () => {
    expect(
      await app.rpc.call('receiver.configure', { baseUrl: 'http://receiver.acme.io' }),
    ).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(value(await app.rpc.call('receiver.get', {}))).toEqual({
      receiver: { baseUrl: receiver.url, hasToken: true },
    });
    value(await app.rpc.call('receiver.configure', { baseUrl: receiver.url }));
    expect(value(await app.rpc.call('receiver.get', {})).receiver?.hasToken).toBe(true);
    expect(value(await app.rpc.call('projects.list', {})).projects).toEqual([acme]);
  });

  it('submits a draft: binds its site, delivers the frozen bundle, starts a new draft next', async () => {
    const { taskId } = await app.commit('Make the cards equal height');
    const preview = value(await app.rpc.call('task.assemble', { taskId }));
    expect(value(await app.rpc.call('task.deliveryTarget', { taskId }))).toMatchObject({
      project: null,
      conflict: false,
      sites: [{ origin: 'https://acme.io', binding: null }],
    });

    value(await app.rpc.call('task.submit', { taskId, project: project() }));
    await delivered();

    expect(await stateOf(taskId)).toMatchObject({
      kind: 'submitted',
      remoteId: 'remote-1',
      projectName: 'Acme Web',
      status: { phase: 'queued' },
    });
    const [remote] = receiver.tasks.values();
    expect(remote?.manifest.taskId).toBe(taskId);
    expect(remote?.files.get('context.md')?.toString()).toContain('Make the cards equal height');
    // What was sent is exactly what the preview showed.
    expect(preview.files.map((f) => f.path).sort()).toEqual(
      [...(remote?.files.keys() ?? [])].sort(),
    );

    expect(value(await app.rpc.call('bindings.list', {})).bindings).toMatchObject([
      { pattern: 'https://acme.io', projectId: 'acme-web' },
    ]);
    expect(value(await app.rpc.call('drafts.list', {})).activeId).toBeNull();
    const next = await app.commit('Another page, same site', 'https://acme.io/pricing');
    expect(next.taskId).not.toBe(taskId);
    expect(
      value(await app.rpc.call('task.deliveryTarget', { taskId: next.taskId })).project,
    ).toEqual(acme);
    expect(app.activity.at(-1)).toEqual({ active: 1, needsInput: 0 });
  });

  it('offline: keeps the task queued, retries later, and delivers it once', async () => {
    const { taskId } = await app.commit('Fix it');
    receiver.fail('unavailable');
    value(await app.rpc.call('task.submit', { taskId, project: project() }));
    await delivered();

    expect(await stateOf(taskId)).toMatchObject({
      kind: 'queued',
      attempts: 1,
      nextAttemptAt: app.now() + 30_000,
      lastError: { code: 'receiver-unavailable' },
    });
    expect(app.wakeUps.get('deliver')).toBe(app.now() + 30_000);

    await app.services.outbox.run(); // not due yet: nothing is sent
    expect(receiver.submissions()).toBe(1);
    app.advance(30_000);
    await app.services.outbox.run();
    expect(await stateOf(taskId)).toMatchObject({ kind: 'submitted' });
    expect(receiver.tasks.size).toBe(1);
    expect(app.wakeUps.get('deliver')).toBeNull();
  });

  it('a response lost after the receiver accepted creates no duplicate', async () => {
    const { taskId } = await app.commit('Fix it');
    receiver.fail('drop-after-accept');
    value(await app.rpc.call('task.submit', { taskId, project: project() }));
    await delivered();
    expect(await stateOf(taskId)).toMatchObject({ kind: 'queued', attempts: 1 });

    value(await app.rpc.call('task.retry', { taskId }));
    await delivered();
    expect(await stateOf(taskId)).toMatchObject({ kind: 'submitted', remoteId: 'remote-1' });
    expect(receiver.submissions()).toBe(2);
    expect(receiver.tasks.size).toBe(1);
  });

  it('a refused task is reported and can be reopened as the active draft', async () => {
    const { taskId } = await app.commit('Fix it');
    value(await app.rpc.call('task.submit', { taskId, project: project('unknown-project') }));
    await delivered();
    expect(await stateOf(taskId)).toMatchObject({ kind: 'failed', error: { code: 'validation' } });
    expect(app.notices).toMatchObject([{ kind: 'delivery-failed', taskId }]);

    value(await app.rpc.call('task.reopen', { taskId }));
    expect(value(await app.rpc.call('drafts.list', {})).activeId).toBe(taskId);
    expect((await app.commit('One more thing')).taskId).toBe(taskId);
  });

  it('follows the agent to the result, answering its question on the way', async () => {
    const { taskId } = await app.commit('Fix it');
    value(await app.rpc.call('task.submit', { taskId, project: project() }));
    await delivered();

    // The receiver asked for 1 s between checks: an earlier refresh changes nothing.
    value(await app.rpc.call('task.refresh', { taskId }));
    expect(await stateOf(taskId)).toMatchObject({ status: { phase: 'queued' } });

    const refresh = async () => {
      app.advance(1_000);
      value(await app.rpc.call('task.refresh', { taskId }));
      return stateOf(taskId);
    };
    expect(await refresh()).toMatchObject({ status: { phase: 'working' } });
    expect(await refresh()).toMatchObject({ status: { phase: 'needs-input' } });
    expect(app.notices.at(-1)).toMatchObject({ kind: 'needs-input', taskId });
    expect(app.activity.at(-1)).toEqual({ active: 1, needsInput: 1 });

    expect(
      await app.rpc.call('task.reply', { taskId, questionId: 'other', text: 'Yes' }),
    ).toMatchObject({ ok: false, error: { code: 'conflict' } });
    value(await app.rpc.call('task.reply', { taskId, questionId: 'q1', text: 'Desktop only' }));
    expect([...receiver.tasks.values()][0]?.replies).toEqual([
      { questionId: 'q1', text: 'Desktop only' },
    ]);
    expect(await stateOf(taskId)).toMatchObject({ status: { phase: 'working' } });

    // Scheduled checks do the same without the user: here, once the 30 s floor has passed.
    app.advance(30_000);
    await app.services.followRemote.checkStatuses();
    expect(await stateOf(taskId)).toMatchObject({
      status: { phase: 'result-ready', resultUrl: 'https://git.example/acme/web/pull/42' },
      nextCheckAt: null,
    });
    expect(app.notices.at(-1)).toMatchObject({ kind: 'result-ready', taskId });
    expect(app.activity.at(-1)).toEqual({ active: 0, needsInput: 0 });
    expect(app.wakeUps.get('check-statuses')).toBeNull();
  });

  it('refuses to mix projects in one task', async () => {
    value(await app.rpc.call('bindings.set', { pattern: 'https://acme.io', project: project() }));
    value(
      await app.rpc.call('bindings.set', {
        pattern: 'https://admin.acme.io',
        project: { id: 'admin' as never, name: 'Admin' },
      }),
    );
    const { taskId } = await app.commit('Site');
    await app.commit('Admin', 'https://admin.acme.io/users');
    expect(value(await app.rpc.call('task.deliveryTarget', { taskId }))).toMatchObject({
      project: null,
      conflict: true,
    });
    expect(await app.rpc.call('task.submit', { taskId, project: null })).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
  });
});
