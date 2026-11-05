import {
  CaptureId,
  FragmentCatalog,
  StepId,
  TaskId,
  addStep,
  createDraft,
  ok,
  type ErasedFragmentDescriptor,
  type StepCapture,
  type Task,
  type TaskProcessor,
} from '@redline/core';
import { describe, expect, it } from 'vitest';
import * as z from 'zod/mini';
import { UNLIMITED_BUDGET } from './budget';
import { AssemblyEngine } from './engine';
import { Packager } from './packager';
import { MarkdownContextRenderer } from './renderer';

const note: ErasedFragmentDescriptor = {
  kind: 'note',
  title: 'Note',
  version: 1,
  schema: z.object({ text: z.string() }),
  migrations: [],
  presenter: {
    summarize: (f) => [{ section: 'page', markdown: (f.data as { text: string }).text }],
  },
};
const catalog = new FragmentCatalog([note]);

const captureOf = (text: string): StepCapture => ({
  fragments: [
    {
      kind: 'note',
      version: 1,
      target: { level: 'step' },
      priority: 'normal',
      data: { text },
      assets: [],
    } as unknown as StepCapture['fragments'][number],
  ],
  diagnostics: [],
});

const taskWith = (count: number): Task => {
  let task = createDraft(TaskId.parse('task-1'), 0);
  for (let n = 1; n <= count; n += 1) {
    const added = addStep(
      task,
      {
        id: StepId.parse(`step-${String(n)}`),
        page: { url: 'https://acme.io/', routePattern: '/', title: 'Home' },
        viewport: { width: 800, height: 600, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
        intent: 'text',
        comment: `Step ${String(n)}`,
        shapeIds: ['shape'],
        captureId: CaptureId.parse(`capture-${String(n)}`),
        capturedAt: n,
      },
      n,
    );
    if (!added.ok) throw new Error(added.error.message);
    task = added.value;
  }
  return task;
};

const engine = (processors: readonly TaskProcessor[] = []) =>
  new AssemblyEngine({
    processors,
    renderer: new MarkdownContextRenderer(catalog, { budget: UNLIMITED_BUDGET }),
    packager: new Packager({ get: () => Promise.resolve(ok(new Blob())) }),
  });

const request = (task: Task, captures = new Map<string, StepCapture>()) => ({
  task,
  captures,
  createdAt: '2026-11-05T10:00:00.000Z',
  clientVersion: '0.1.0',
});

const allCaptures = new Map([
  ['capture-1', captureOf('first note')],
  ['capture-2', captureOf('second note')],
]);

describe('AssemblyEngine', () => {
  it('assembles every step in task order', async () => {
    const bundle = await engine().assemble(request(taskWith(2), allCaptures));
    if (!bundle.ok) throw new Error(bundle.error.message);
    const context = (await bundle.value.bundle.files.get('context.md')?.text()) ?? '';
    expect(context.indexOf('first note')).toBeLessThan(context.indexOf('second note'));
    expect(bundle.value.bundle.manifest.taskId).toBe('task-1');
  });

  it('is deterministic: the same task yields the same digest', async () => {
    const [a, b] = await Promise.all([
      engine().assemble(request(taskWith(2), allCaptures)),
      engine().assemble(request(taskWith(2), allCaptures)),
    ]);
    if (!a.ok || !b.ok) throw new Error('Expected bundles');
    expect(a.value.bundle.digest).toBe(b.value.bundle.digest);
  });

  it('refuses an empty task and a step whose context is missing', async () => {
    expect(await engine().assemble(request(taskWith(0)))).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(
      await engine().assemble(request(taskWith(2), new Map([['capture-1', captureOf('x')]]))),
    ).toMatchObject({ ok: false, error: { code: 'not-found', details: { stepId: 'step-2' } } });
  });

  it('rejects a processor that changes the list of steps', async () => {
    const reversing: TaskProcessor = { id: 'bad', process: (steps) => [...steps].reverse() };
    expect(await engine([reversing]).assemble(request(taskWith(2), allCaptures))).toMatchObject({
      ok: false,
      error: { code: 'internal' },
    });
  });
});
