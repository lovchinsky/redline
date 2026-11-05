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
  comment,
  viewport: { width: 1280, height: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
  shapeIds: ['shape-1'],
});

interface SetupOptions {
  /** The extension's version. */
  readonly version?: string;
  /** Start on the database the previous worker left, as after a restart or an update. */
  readonly keepDatabase?: boolean;
}

/** The service worker over fakes; `fetch` can stand in for the network (e.g. one that hangs). */
const setup = (
  network: typeof fetch = (input, init) => fetch(input, init),
  { version = '0.1.0', keepDatabase = false }: SetupOptions = {},
) => {
  if (!keepDatabase) globalThis.indexedDB = new IDBFactory();
  const idPrefix = keepDatabase ? `${version}-` : '';
  let now = 1_000_000;
  let n = 0;
  const bus = createInMemoryBus();
  const notices: TaskNotice[] = [];
  const wakeUps = new Map<WakeUpReason, number | null>();
  const activity: { active: number; needsInput: number }[] = [];
  const changes: unknown[] = [];
  const registered: string[][] = [];

  const services = createBackgroundServices(
    {
      version,
      clock: { now: () => now },
      ids: { next: () => `${idPrefix}id-${String(++n)}` },
      database: new DatabaseConnection(() => openDatabase({ name: 'sw', logger: silentLogger })),
      storage: memoryStorageArea(),
      fetch: (input, init) => network(input, init),
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
      pageRuntimeInjector: { inject: unused },
      pageRuntimeRegistration: {
        sync: (patterns) => {
          registered.push([...patterns]);
          return Promise.resolve({ ok: true, value: undefined });
        },
      },
      grantedHosts: { includes: (pattern) => Promise.resolve(pattern !== 'https://denied.io/*') },
    },
    silentLogger,
  );
  new RpcServer(protocol, services.handlers, silentLogger).listen(bus.server);
  new EventSubscriber(events, bus.source, silentLogger).on('tasks.changed', (payload) =>
    changes.push(payload),
  );
  const rpc = new RpcClient(protocol, bus.client, { next: () => `rpc-${String(++n)}` });
  /** The capture content script in a page: a narrower audience than extension pages. */
  const page = new RpcClient(
    protocol,
    bus.clientAs({
      kind: 'content-script',
      tabId: 1,
      frameId: 0,
      url: 'https://acme.io/orders/42',
    }),
    { next: () => `page-${String(++n)}` },
  );

  /** Commits a step whose context is a screenshot with a stored crop, as a page would. */
  const commit = async (comment: string, url?: string) => {
    const crop = value(await services.assets.put(new Blob([comment], { type: 'image/png' })));
    return value(
      await page.call('capture.commitStep', {
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
    page,
    services,
    commit,
    notices,
    wakeUps,
    activity,
    changes,
    registered,
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

/** Sends a draft as the side panel does: the revision on screen, and the project shown. */
const submit = async (
  taskId: TaskId,
  project: { readonly id: never; readonly name: string } | null,
  rpc = app.rpc,
) => {
  const { revision } = value(await rpc.call('drafts.get', { taskId }));
  return rpc.call('task.submit', { taskId, revision, project });
};

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
    const bad = await app.page.call('capture.commitStep', {
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

  it('keeps the token for the same server only, never carrying it to another origin', async () => {
    value(await app.rpc.call('receiver.configure', { baseUrl: `${receiver.url}/v1` }));
    expect(value(await app.rpc.call('receiver.get', {})).receiver?.hasToken).toBe(true);
    value(await app.rpc.call('receiver.configure', { baseUrl: 'https://other.acme.io' }));
    expect(value(await app.rpc.call('receiver.get', {})).receiver).toEqual({
      baseUrl: 'https://other.acme.io',
      hasToken: false,
    });
  });

  it('submits a draft: binds its site, delivers the frozen bundle, starts a new draft next', async () => {
    const { taskId } = await app.commit('Make the cards equal height');
    const preview = value(await app.rpc.call('task.assemble', { taskId }));
    expect(value(await app.rpc.call('task.deliveryTarget', { taskId }))).toMatchObject({
      project: null,
      conflict: false,
      sites: [{ origin: 'https://acme.io', binding: null }],
    });

    value(await submit(taskId, project()));
    await delivered();

    expect(await stateOf(taskId)).toMatchObject({
      kind: 'submitted',
      remoteId: 'remote-1',
      delivery: { projectName: 'Acme Web', digest: preview.digest },
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
    value(await submit(taskId, project()));
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

  it('an attempt that never returns still counts, so the next one backs off', async () => {
    const hanging = setup(() => new Promise<Response>(() => undefined));
    value(await hanging.rpc.call('receiver.configure', { baseUrl: receiver.url, token: 'secret' }));
    const { taskId } = await hanging.commit('Fix it');
    value(await submit(taskId, project(), hanging.rpc));
    // The worker stops while the request is in flight: only what was written before it counts.
    void hanging.services.outbox.run();
    await expect
      .poll(async () => {
        const { tasks } = value(await hanging.rpc.call('tasks.list', {}));
        return tasks.find((task) => task.id === taskId)?.state;
      })
      .toMatchObject({ kind: 'queued', attempts: 1, nextAttemptAt: hanging.now() + 30_000 });
    expect(hanging.wakeUps.get('deliver')).toBe(hanging.now() + 30_000);
  });

  it('a response lost after the receiver accepted creates no duplicate', async () => {
    const { taskId } = await app.commit('Fix it');
    receiver.fail('drop-after-accept');
    value(await submit(taskId, project()));
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
    value(await submit(taskId, project('unknown-project')));
    await delivered();
    expect(await stateOf(taskId)).toMatchObject({ kind: 'failed', error: { code: 'validation' } });
    expect(app.notices).toMatchObject([{ kind: 'delivery-failed', taskId }]);

    value(await app.rpc.call('task.reopen', { taskId }));
    expect(value(await app.rpc.call('drafts.list', {})).activeId).toBe(taskId);
    expect((await app.commit('One more thing')).taskId).toBe(taskId);
  });

  it('follows the agent to the result, answering its question on the way', async () => {
    const { taskId } = await app.commit('Fix it');
    value(await submit(taskId, project()));
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

  it('sends only the revision the user saw', async () => {
    const { taskId } = await app.commit('Fix it');
    const { revision } = value(await app.rpc.call('drafts.get', { taskId }));
    await app.commit('Added from another tab meanwhile');
    expect(
      await app.rpc.call('task.submit', { taskId, revision, project: project() }),
    ).toMatchObject({
      ok: false,
      error: { code: 'conflict', details: { reason: 'draft-changed' } },
    });
    expect(await stateOf(taskId)).toBeUndefined(); // still a draft
  });

  it('sending a refused task again is a new delivery, under a new key', async () => {
    value(await app.rpc.call('receiver.configure', { baseUrl: receiver.url, token: 'wrong' }));
    const { taskId } = await app.commit('Fix it');
    value(await submit(taskId, project()));
    await delivered();
    const refused = await stateOf(taskId);
    if (refused?.kind !== 'failed') throw new Error('expected a refusal');
    // Kept with the task, so the side panel can say what to do about it.
    expect(refused.error).toMatchObject({ code: 'permission-denied', reason: 'token-refused' });

    value(await app.rpc.call('receiver.configure', { baseUrl: receiver.url, token: 'secret' }));
    value(await app.rpc.call('task.retry', { taskId }));
    await delivered();
    const sent = await stateOf(taskId);
    if (sent?.kind !== 'submitted') throw new Error('expected a submission');
    expect(sent.delivery.id).not.toBe(refused.delivery.id);
    expect([...receiver.tasks.values()][0]?.idempotencyKey).toBe(sent.delivery.id);
  });

  it('an update while a task waits in the outbox still sends the bundle the user approved', async () => {
    const { taskId } = await app.commit('Fix it');
    receiver.fail('unavailable');
    value(await submit(taskId, project()));
    await delivered();
    const queued = await stateOf(taskId);
    if (queued?.kind !== 'queued') throw new Error('expected a queued task');

    const updated = setup(undefined, { version: '0.2.0', keepDatabase: true });
    value(await updated.rpc.call('receiver.configure', { baseUrl: receiver.url, token: 'secret' }));
    // Looking at it does not assemble it again with the new version.
    const shown = value(await updated.rpc.call('task.assemble', { taskId }));
    expect(shown.digest).toBe(queued.delivery.digest);
    updated.advance(30_000);
    await updated.services.outbox.run();
    const { tasks } = value(await updated.rpc.call('tasks.list', {}));
    expect(tasks.find((task) => task.id === taskId)?.state).toMatchObject({ kind: 'submitted' });
    const [remote] = receiver.tasks.values();
    expect(remote?.manifest.client.version).toBe('0.1.0');
  });

  it('a task the receiver no longer knows is lost, not failed by the agent', async () => {
    const { taskId } = await app.commit('Fix it');
    value(await submit(taskId, project()));
    await delivered();
    // Another receiver now: it has never seen this task.
    const other = await startMockReceiver({ token: 'secret' });
    value(await app.rpc.call('receiver.configure', { baseUrl: other.url, token: 'secret' }));
    app.advance(30_000);
    await app.services.followRemote.checkStatuses();
    expect(await stateOf(taskId)).toMatchObject({ kind: 'lost', remoteId: 'remote-1' });
    expect(app.notices.at(-1)).toMatchObject({ kind: 'lost', taskId });
    expect(app.activity.at(-1)).toEqual({ active: 0, needsInput: 0 });
    expect(app.wakeUps.get('check-statuses')).toBeNull();
    await other.close();
  });

  it('a failed status check keeps what is known and backs off', async () => {
    const { taskId } = await app.commit('Fix it');
    value(await submit(taskId, project()));
    await delivered();
    const check = async () => {
      app.advance(10 * 60_000);
      receiver.fail('unavailable');
      await app.services.followRemote.checkStatuses();
      return stateOf(taskId);
    };
    expect(await check()).toMatchObject({
      kind: 'submitted',
      status: { phase: 'queued' },
      checkFailures: 1,
      checkError: { code: 'receiver-unavailable' },
      nextCheckAt: app.now() + 30_000,
    });
    expect(await check()).toMatchObject({ checkFailures: 2, nextCheckAt: app.now() + 60_000 });
    app.advance(60_000);
    await app.services.followRemote.checkStatuses();
    expect(await stateOf(taskId)).toMatchObject({
      status: { phase: 'working' },
      checkFailures: 0,
      checkError: null,
    });
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
    expect(await submit(taskId, null)).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
  });
});

describe('page runtime on bound sites', () => {
  it('starts with the page only on bound sites the user granted access to', async () => {
    const project = { id: 'acme-web' as never, name: 'Acme Web' };
    for (const pattern of ['https://acme.io/admin', 'https://*.shop.io', 'https://denied.io']) {
      value(await app.rpc.call('bindings.set', { pattern, project }));
    }
    await app.services.syncPageRuntime.execute();
    expect(app.registered.at(-1)).toEqual(['https://*.shop.io/*', 'https://acme.io/*']);

    for (const pattern of ['https://acme.io/admin', 'https://*.shop.io', 'https://denied.io']) {
      value(await app.rpc.call('bindings.remove', { pattern }));
    }
    await app.services.syncPageRuntime.execute();
    expect(app.registered.at(-1)).toEqual([]);
  });
});

describe('diagnostics journal', () => {
  const report = (page: string) => ({
    page,
    areas: 1,
    durationMs: 42,
    collectors: [
      {
        collector: 'anchors',
        area: 1,
        outcome: 'collected' as const,
        durationMs: 3,
        fragments: 1,
      },
    ],
  });

  it('keeps the most recent captures first, up to its capacity', async () => {
    await Promise.all(
      Array.from({ length: 55 }, (_, index) =>
        app.page.call('diagnostics.record', report(`https://acme.io/${String(index)}`)),
      ),
    );
    const { records } = value(await app.rpc.call('diagnostics.list', {}));
    expect(records).toHaveLength(50);
    expect(records[0]?.page).toBe('https://acme.io/54');
    expect(records.at(-1)?.page).toBe('https://acme.io/5');
    expect(new Set(records.map((entry) => entry.id)).size).toBe(50);
  });

  it('empties on request', async () => {
    value(await app.page.call('diagnostics.record', report('https://acme.io/')));
    value(await app.rpc.call('diagnostics.clear', {}));
    expect(value(await app.rpc.call('diagnostics.list', {})).records).toEqual([]);
  });
});

describe('caller audiences', () => {
  it('keeps settings and tasks away from content scripts in web pages', async () => {
    const configured = await app.page.call('receiver.configure', { baseUrl: 'https://evil.io' });
    expect(configured.ok ? null : configured.error.code).toBe('permission-denied');
    const listed = await app.page.call('tasks.list', {});
    expect(listed.ok ? null : listed.error.code).toBe('permission-denied');
  });

  it('keeps capture plumbing away from extension pages', async () => {
    const snapshot = await app.rpc.call('capture.snapshot', {});
    expect(snapshot.ok ? null : snapshot.error.code).toBe('permission-denied');
  });
});
