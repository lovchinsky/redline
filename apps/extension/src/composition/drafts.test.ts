/** Draft use cases wired to the real IndexedDB adapters (fake-indexeddb), as in the service worker. */
import { IDBFactory } from 'fake-indexeddb';
import {
  AssemblyEngine,
  MarkdownContextRenderer,
  Packager,
  UNLIMITED_BUDGET,
} from '@redline/assembly';
import {
  FragmentCatalog,
  SerialQueue,
  StepId,
  type AssetId,
  type ErasedFragmentDescriptor,
  type Logger,
  type Result,
  type TaskId,
} from '@redline/core';
import { dedupeProcessor } from '@redline/processors';
import { EventPublisher, EventSubscriber, events, type StepRecord } from '@redline/rpc';
import { createInMemoryBus } from '@redline/rpc/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import * as z from 'zod/mini';
import { DatabaseConnection, openDatabase } from '../adapters/idb/database';
import { IdbActiveDraftStore } from '../adapters/idb/idb-active-draft-store';
import { IdbAssetStore } from '../adapters/idb/idb-asset-store';
import { IdbBundleRepository } from '../adapters/idb/idb-bundle-repository';
import { IdbCaptureRepository } from '../adapters/idb/idb-capture-repository';
import { IdbTaskRepository } from '../adapters/idb/idb-task-repository';
import { AssembleBundle } from '../application/drafts/assemble-bundle';
import { CollectGarbage, GARBAGE_GRACE_MS } from '../application/drafts/collect-garbage';
import { CommitStep } from '../application/drafts/commit-step';
import {
  ActivateDraft,
  CreateDraft,
  DeleteDraft,
  EditDraft,
  RemoveStep,
} from '../application/drafts/draft-commands';
import { GetDraft, ListDrafts } from '../application/drafts/draft-queries';
import { DraftWriter } from '../application/drafts/draft-writer';
import { StoredCaptures } from '../application/drafts/stored-captures';

const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

const value = <T>(result: Result<T, unknown>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};

const picture: ErasedFragmentDescriptor = {
  kind: 'picture',
  title: 'Picture',
  version: 1,
  schema: z.object({ label: z.string() }),
  migrations: [],
  presenter: {
    summarize: (f) => [{ section: 'region', markdown: (f.data as { label: string }).label }],
    thumbnail: (f) => f.assets[0] ?? null,
  },
};

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
  let now = 1_000;
  let n = 0;
  const clock = { now: () => now };
  const ids = { next: () => `id-${String(++n)}` };
  const database = new DatabaseConnection(() =>
    openDatabase({ name: 'drafts', logger: silentLogger }),
  );
  const bus = createInMemoryBus();
  const changes: unknown[] = [];
  new EventSubscriber(events, bus.source, silentLogger).on('drafts.changed', (payload) =>
    changes.push(payload),
  );

  const catalog = new FragmentCatalog([picture]);
  const assets = new IdbAssetStore(database, ids, clock);
  const captureRepository = new IdbCaptureRepository(database);
  const tasks = new IdbTaskRepository(database);
  const active = new IdbActiveDraftStore(database);
  const bundles = new IdbBundleRepository(database);
  const writer = new DraftWriter({
    queue: new SerialQueue(),
    active,
    events: new EventPublisher(events, bus.sink),
    logger: silentLogger,
  });
  const captures = new StoredCaptures({
    repository: captureRepository,
    assets,
    catalog,
    logger: silentLogger,
  });
  const commands = { tasks, active, bundles, captures, writer, ids, clock };
  const queries = { tasks, active, captures, catalog };

  /** Captures a step whose context is one picture fragment with a stored image. */
  const commitStep = new CommitStep({
    catalog,
    captures: captureRepository,
    tasks,
    active,
    writer,
    ids,
    clock,
    logger: silentLogger,
  });
  const commit = async (comment: string, url?: string) => {
    const image = value(await assets.put(new Blob([comment], { type: 'image/png' })));
    return value(
      await commitStep.execute(record(comment, url), {
        fragments: [
          {
            kind: 'picture',
            version: 1,
            target: { level: 'shape', shapeId: 'shape-1' },
            priority: 'high',
            data: { label: comment },
            assets: [image],
          },
        ],
        diagnostics: [],
      }),
    );
  };

  return {
    advance: (ms: number) => {
      now += ms;
    },
    changes,
    assets,
    database,
    tasks,
    commit,
    listDrafts: new ListDrafts(queries),
    getDraft: new GetDraft(queries),
    createDraft: new CreateDraft(commands),
    activateDraft: new ActivateDraft(commands),
    editDraft: new EditDraft(commands),
    removeStep: new RemoveStep(commands),
    deleteDraft: new DeleteDraft(commands),
    assemble: new AssembleBundle({
      tasks,
      captures,
      bundles,
      engine: new AssemblyEngine({
        processors: [dedupeProcessor],
        renderer: new MarkdownContextRenderer(catalog, { budget: UNLIMITED_BUDGET }),
        packager: new Packager(assets),
      }),
      writer,
      clock,
      clientVersion: '0.1.0',
      logger: silentLogger,
    }),
    collectGarbage: new CollectGarbage({
      tasks,
      captures: captureRepository,
      assets,
      writer,
      clock,
      logger: silentLogger,
    }),
  };
};

let app: ReturnType<typeof setup>;
beforeEach(() => {
  app = setup();
});

const stepIds = async (taskId: TaskId) =>
  value(await app.getDraft.execute(taskId)).steps.map((step) => step.comment);

describe('committing steps', () => {
  it('starts a draft on the first step and keeps adding to it', async () => {
    const first = await app.commit('Cards must align');
    const second = await app.commit('Fix the badge');
    expect(second.taskId).toBe(first.taskId);
    expect(second.stepCount).toBe(2);

    const { activeId, drafts } = value(await app.listDrafts.execute());
    expect(activeId).toBe(first.taskId);
    expect(drafts).toMatchObject([
      { id: first.taskId, stepCount: 2, firstComment: 'Cards must align' },
    ]);
    expect(app.changes).toHaveLength(2);
  });

  it('records the route pattern of the page and offers a thumbnail', async () => {
    const { taskId } = await app.commit('Cards must align');
    const [step] = value(await app.getDraft.execute(taskId)).steps;
    expect(step?.page.routePattern).toBe('/orders/:param');
    expect(step?.thumbnail?.mediaType).toBe('image/png');
  });

  it('serializes concurrent commits into one draft', async () => {
    const results = await Promise.all([app.commit('a'), app.commit('b'), app.commit('c')]);
    expect(new Set(results.map((r) => r.taskId)).size).toBe(1);
    expect(await stepIds(results[0].taskId)).toEqual(['a', 'b', 'c']);
  });

  it('rejects context that does not match its schema and stores nothing', async () => {
    const commitStep = await app.commit('valid');
    const bad = await new CommitStep({
      catalog: new FragmentCatalog([picture]),
      captures: new IdbCaptureRepository(app.database),
      tasks: app.tasks,
      active: new IdbActiveDraftStore(app.database),
      writer: new DraftWriter({
        queue: new SerialQueue(),
        active: new IdbActiveDraftStore(app.database),
        events: new EventPublisher(events, createInMemoryBus().sink),
        logger: silentLogger,
      }),
      ids: { next: () => 'x' },
      clock: { now: () => 0 },
      logger: silentLogger,
    }).execute(record('bad'), {
      fragments: [
        {
          kind: 'picture',
          version: 1,
          target: { level: 'step' },
          priority: 'high',
          data: { label: 42 },
          assets: [],
        },
      ],
      diagnostics: [],
    });
    expect(bad).toMatchObject({ ok: false, error: { code: 'validation' } });
    expect(await stepIds(commitStep.taskId)).toEqual(['valid']);
  });
});

describe('managing drafts', () => {
  it('sends new steps to a newly created or re-activated draft', async () => {
    const first = await app.commit('one');
    const created = value(await app.createDraft.execute());
    const second = await app.commit('two');
    expect(second.taskId).toBe(created.taskId);

    value(await app.activateDraft.execute(first.taskId));
    expect((await app.commit('three')).taskId).toBe(first.taskId);
    expect(await stepIds(first.taskId)).toEqual(['one', 'three']);
  });

  it('edits, moves and renames', async () => {
    const { taskId } = await app.commit('one');
    const { stepId } = await app.commit('two');
    value(await app.editDraft.execute(taskId, { kind: 'edit-comment', stepId, comment: 'TWO' }));
    value(await app.editDraft.execute(taskId, { kind: 'move-step', stepId, toIndex: 0 }));
    value(await app.editDraft.execute(taskId, { kind: 'rename', title: 'Orders page' }));
    const draft = value(await app.getDraft.execute(taskId));
    expect(draft.steps.map((s) => s.comment)).toEqual(['TWO', 'one']);
    expect(draft.title).toBe('Orders page');
  });

  it('removing a step deletes its context and images', async () => {
    const { taskId, stepId } = await app.commit('one');
    const [thumbnail] = value(await app.getDraft.execute(taskId)).steps.map((s) => s.thumbnail);
    value(await app.removeStep.execute(taskId, stepId));
    expect(await stepIds(taskId)).toEqual([]);
    expect(await app.assets.get(thumbnail?.id as AssetId)).toMatchObject({ ok: false });
  });

  it('deleting the active draft clears it; the next step starts a new one', async () => {
    const { taskId } = await app.commit('one');
    value(await app.deleteDraft.execute(taskId));
    expect(value(await app.listDrafts.execute())).toEqual({ activeId: null, drafts: [] });
    expect((await app.commit('two')).taskId).not.toBe(taskId);
  });

  it('reports unknown steps and drafts', async () => {
    const { taskId } = await app.commit('one');
    expect(await app.removeStep.execute(taskId, StepId.parse('ghost'))).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
    expect(await app.getDraft.execute('ghost' as TaskId)).toMatchObject({
      ok: false,
      error: { code: 'not-found' },
    });
  });
});

describe('assembling', () => {
  it('reuses the frozen bundle until the task changes', async () => {
    const { taskId, stepId } = await app.commit('one');
    await app.commit('two');
    const first = value(await app.assemble.execute(taskId));
    app.advance(60_000);
    const again = value(await app.assemble.execute(taskId));
    expect(again).toEqual(first);
    expect(first.files.map((f) => f.path)).toContain('context.md');

    value(await app.editDraft.execute(taskId, { kind: 'edit-comment', stepId, comment: 'ONE' }));
    const edited = value(await app.assemble.execute(taskId));
    expect(edited.revision).toBeGreaterThan(first.revision);
    expect(edited.digest).not.toBe(first.digest);
  });

  it('refuses an empty draft', async () => {
    const { taskId } = value(await app.createDraft.execute());
    expect(await app.assemble.execute(taskId)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });
});

describe('garbage collection', () => {
  it('deletes old unreferenced images but keeps everything a draft uses', async () => {
    const orphan = value(await app.assets.put(new Blob(['snapshot'])));
    const { taskId } = await app.commit('one');
    const [kept] = value(await app.getDraft.execute(taskId)).steps.map((s) => s.thumbnail);

    expect(value(await app.collectGarbage.execute())).toEqual({ captures: 0, assets: 0 });
    app.advance(GARBAGE_GRACE_MS + 1);
    expect(value(await app.collectGarbage.execute())).toEqual({ captures: 0, assets: 1 });
    expect(await app.assets.get(orphan.id)).toMatchObject({ ok: false });
    expect((await app.assets.get(kept?.id as AssetId)).ok).toBe(true);
  });
});
