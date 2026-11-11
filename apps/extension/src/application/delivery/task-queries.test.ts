import type { BundleManifest } from '@redline/contract';
import {
  CaptureId,
  DeliveryId,
  ProjectId,
  StepId,
  TaskId,
  appError,
  err,
  ok,
  type Task,
} from '@redline/core';
import { describe, expect, it } from 'vitest';
import type { BundleRepository, StoredBundle } from '../../ports/drafts';
import type { TaskRepository } from '../../ports/workspace';
import { GetTask } from './task-queries';

const DIGEST = 'a'.repeat(64);
const taskId = TaskId.parse('t1');

const step = (id: string, comment: string): Task['steps'][number] => ({
  id: StepId.parse(id),
  page: { url: `https://app.example/${id}`, routePattern: `/${id}`, title: id },
  viewport: { width: 1280, height: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
  comment,
  shapeIds: ['shape-1'],
  captureId: CaptureId.parse(`c-${id}`),
  capturedAt: 1,
});

const task: Task = {
  id: taskId,
  title: null,
  steps: [step('s1', 'Rename the button'), step('s2', 'Hide the banner')],
  revision: 3,
  createdAt: 0,
  updatedAt: 5,
  state: {
    kind: 'queued',
    delivery: {
      id: DeliveryId.parse('d1'),
      projectId: ProjectId.parse('acme'),
      projectName: 'Acme',
      digest: DIGEST,
    },
    queuedAt: 1,
    attempts: 0,
    nextAttemptAt: 1,
    lastError: null,
  },
};

const file = (path: string, mediaType: string) => ({
  path,
  mediaType,
  sha256: 'b'.repeat(64),
  bytes: 10,
});

/** Step 1's area has its notes first and its picture second; step 2's area has no picture. */
const manifest = {
  schemaVersion: 1,
  taskId: 't1',
  createdAt: '2026-01-01T00:00:00.000Z',
  client: { version: '1.0.0' },
  steps: [
    {
      id: 's1',
      url: 'https://app.example/s1',
      routePattern: '/s1',
      comment: 'Rename the button',
      viewport: { width: 1280, height: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
      shapes: [{ id: 'shape-1', files: ['steps/1/notes.md', 'steps/1/area.png'] }],
    },
    {
      id: 's2',
      url: 'https://app.example/s2',
      routePattern: '/s2',
      comment: 'Hide the banner',
      viewport: { width: 1280, height: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
      shapes: [{ id: 'shape-1', files: ['steps/2/notes.md'] }],
    },
  ],
  files: [
    file('context.md', 'text/markdown'),
    file('steps/1/notes.md', 'text/markdown'),
    file('steps/1/area.png', 'image/png'),
    file('steps/2/notes.md', 'text/markdown'),
  ],
  entry: 'context.md',
} satisfies BundleManifest;

const stored = (digest: string): StoredBundle => ({
  taskId,
  revision: 3,
  clientVersion: '1.0.0',
  bundle: { manifest, files: new Map(), digest },
  warnings: [],
});

const tasks = (value: Task | null): TaskRepository => ({
  get: () =>
    Promise.resolve(value === null ? err(appError('not-found', 'No such task')) : ok(value)),
  list: () => Promise.resolve(ok(value === null ? [] : [value])),
});

const bundles = (value: StoredBundle | null): BundleRepository => ({
  get: () => Promise.resolve(ok(value)),
  put: () => Promise.resolve(ok(undefined)),
  delete: () => Promise.resolve(ok(undefined)),
  taskIds: () => Promise.resolve(ok(value === null ? [] : [value.taskId])),
});

describe('GetTask', () => {
  it('lists every step in full, with the first picture of its first area', async () => {
    const result = await new GetTask(tasks(task), bundles(stored(DIGEST))).execute(taskId);
    expect(result).toEqual(
      ok({
        id: taskId,
        steps: [
          {
            id: 's1',
            comment: 'Rename the button',
            page: task.steps[0]?.page,
            image: 'steps/1/area.png',
          },
          { id: 's2', comment: 'Hide the banner', page: task.steps[1]?.page, image: null },
        ],
        bundle: {
          taskId,
          digest: DIGEST,
          entry: 'context.md',
          files: manifest.files.map(({ path, mediaType, bytes }) => ({ path, mediaType, bytes })),
        },
      }),
    );
  });

  it('shows the steps without pictures when the delivered bundle is not stored', async () => {
    for (const bundle of [null, stored('c'.repeat(64))]) {
      const result = await new GetTask(tasks(task), bundles(bundle)).execute(taskId);
      expect(result.ok && result.value.bundle).toBeNull();
      expect(result.ok && result.value.steps.map((s) => s.image)).toEqual([null, null]);
    }
  });

  it('fails for a task it does not know', async () => {
    const result = await new GetTask(tasks(null), bundles(null)).execute(taskId);
    expect(result.ok).toBe(false);
  });
});
