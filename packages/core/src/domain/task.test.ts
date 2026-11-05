import { describe, expect, it } from 'vitest';
import type { Result } from '../shared/result';
import {
  CaptureId,
  StepId,
  TaskId,
  addStep,
  createDraft,
  editStepComment,
  moveStep,
  removeStep,
  renameTask,
  taskSchema,
  type Step,
  type Task,
} from './task';

const step = (id: string, comment = `Comment ${id}`): Step => ({
  id: StepId.parse(id),
  page: { url: 'https://acme.io/pricing', routePattern: '/pricing', title: 'Pricing' },
  viewport: { width: 1280, height: 800, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
  intent: 'layout',
  comment,
  shapeIds: ['shape-1'],
  captureId: CaptureId.parse(`capture-${id}`),
  capturedAt: 10,
});

const value = <T>(result: Result<T, unknown>): T => {
  if (!result.ok) throw new Error(`Expected ok, got ${JSON.stringify(result.error)}`);
  return result.value;
};

const draftWith = (...ids: string[]): Task =>
  ids.reduce(
    (task, id, n) => value(addStep(task, step(id), 100 + n)),
    createDraft(TaskId.parse('task-1'), 1),
  );

const order = (task: Task) => task.steps.map((s) => s.id);

describe('Task', () => {
  it('starts as an empty draft at revision 0', () => {
    const task = createDraft(TaskId.parse('task-1'), 5);
    expect(task).toMatchObject({ state: { kind: 'draft' }, steps: [], revision: 0, title: null });
    expect(taskSchema.parse(task)).toEqual(task);
  });

  it('appends steps, trims comments and bumps the revision on every change', () => {
    const task = value(addStep(createDraft(TaskId.parse('t'), 1), step('a', '  Fix  \n'), 7));
    expect(task.steps[0]?.comment).toBe('Fix');
    expect(task).toMatchObject({ revision: 1, updatedAt: 7 });
  });

  it('rejects a duplicate step and an empty comment', () => {
    const task = draftWith('a');
    expect(addStep(task, step('a'), 2)).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(addStep(task, step('b', '   '), 2)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });

  it('edits a comment without touching other steps', () => {
    const task = value(editStepComment(draftWith('a', 'b'), StepId.parse('b'), ' New ', 9));
    expect(task.steps.map((s) => s.comment)).toEqual(['Comment a', 'New']);
    expect(task.revision).toBe(3);
  });

  it('removes a step and returns it (its context must be released)', () => {
    const { task, removed } = value(removeStep(draftWith('a', 'b', 'c'), StepId.parse('b'), 9));
    expect(order(task)).toEqual(['a', 'c']);
    expect(removed.captureId).toBe('capture-b');
  });

  it('moves a step to its new position', () => {
    const task = draftWith('a', 'b', 'c');
    expect(order(value(moveStep(task, StepId.parse('c'), 0, 9)))).toEqual(['c', 'a', 'b']);
    expect(order(value(moveStep(task, StepId.parse('a'), 2, 9)))).toEqual(['b', 'c', 'a']);
    expect(value(moveStep(task, StepId.parse('b'), 1, 9))).toBe(task);
    expect(moveStep(task, StepId.parse('a'), 3, 9)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
  });

  it('reports unknown steps as not found', () => {
    const task = draftWith('a');
    const missing = StepId.parse('zzz');
    for (const result of [
      editStepComment(task, missing, 'x', 2),
      removeStep(task, missing, 2),
      moveStep(task, missing, 0, 2),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'not-found' } });
    }
  });

  it('sets and clears the title; an unchanged title is not a change', () => {
    const named = value(renameTask(draftWith('a'), '  Pricing fixes ', 3));
    expect(named.title).toBe('Pricing fixes');
    expect(value(renameTask(named, 'Pricing fixes', 4))).toBe(named);
    expect(value(renameTask(named, '', 5)).title).toBeNull();
  });

  it('never mutates the task it was given', () => {
    const task = draftWith('a', 'b');
    const snapshot = structuredClone(task);
    value(moveStep(task, StepId.parse('b'), 0, 9));
    value(removeStep(task, StepId.parse('a'), 9));
    expect(task).toEqual(snapshot);
  });
});
