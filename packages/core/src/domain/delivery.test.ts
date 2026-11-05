import { describe, expect, it } from 'vitest';
import type { Result } from '../shared/result';
import { ProjectId } from './binding';
import {
  applyRemoteReport,
  deferStatusCheck,
  isActive,
  markDeliveryFailed,
  markSubmitted,
  mayRefresh,
  needsInput,
  queueForDelivery,
  recordFailedAttempt,
  reopenDraft,
  retryDelivery,
} from './delivery';
import { CaptureId, StepId, TaskId, addStep, createDraft, renameTask, type Task } from './task';

const value = <T>(result: Result<T, unknown>): T => {
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return result.value;
};

const draft = (): Task =>
  value(
    addStep(
      createDraft(TaskId.parse('task-1'), 0),
      {
        id: StepId.parse('s1'),
        page: { url: 'https://acme.io/', routePattern: '/', title: 'Home' },
        viewport: { width: 800, height: 600, devicePixelRatio: 1, scrollX: 0, scrollY: 0 },
        comment: 'Fix',
        shapeIds: ['a'],
        captureId: CaptureId.parse('c1'),
        capturedAt: 0,
      },
      1,
    ),
  );

const target = { projectId: ProjectId.parse('acme'), projectName: 'Acme', digest: 'd'.repeat(64) };
const queued = () => value(queueForDelivery(draft(), target, 10));

describe('delivery lifecycle', () => {
  it('queues a draft without touching its content revision', () => {
    const task = queued();
    expect(task.state).toMatchObject({ kind: 'queued', attempts: 0, nextAttemptAt: 10 });
    expect(task.revision).toBe(draft().revision);
    expect(isActive(task)).toBe(true);
  });

  it('refuses to queue an empty draft and to edit a queued task', () => {
    expect(queueForDelivery(createDraft(TaskId.parse('t'), 0), target, 1)).toMatchObject({
      ok: false,
      error: { code: 'validation' },
    });
    expect(renameTask(queued(), 'x', 11)).toMatchObject({ ok: false, error: { code: 'conflict' } });
  });

  it('counts failed attempts and keeps the bundle digest', () => {
    const retried = value(
      recordFailedAttempt(queued(), { code: 'receiver-unavailable', message: '503' }, 70, 20),
    );
    expect(retried.state).toMatchObject({
      kind: 'queued',
      attempts: 1,
      nextAttemptAt: 70,
      digest: target.digest,
      lastError: { code: 'receiver-unavailable' },
    });
  });

  it('follows the receiver after submission, polling no faster than every 30 s', () => {
    const submitted = value(
      markSubmitted(
        queued(),
        { remoteId: 'r1', status: { phase: 'queued' }, pollAfterSec: 5 },
        100,
      ),
    );
    expect(submitted.state).toMatchObject({
      kind: 'submitted',
      remoteId: 'r1',
      nextCheckAt: 30_100,
    });

    const asking = value(
      applyRemoteReport(
        submitted,
        {
          status: { phase: 'needs-input', question: { id: 'q', text: 'Which?' } },
          pollAfterSec: 60,
        },
        200,
      ),
    );
    expect(needsInput(asking)).toBe(true);
    expect(asking.state).toMatchObject({ nextCheckAt: 60_200 });

    const done = value(
      applyRemoteReport(
        asking,
        {
          status: { phase: 'result-ready', resultUrl: 'https://git.example/pr/1' },
          pollAfterSec: 60,
        },
        300,
      ),
    );
    expect(done.state).toMatchObject({ nextCheckAt: null });
    expect(isActive(done)).toBe(false);
    expect(mayRefresh(done, 1_000_000)).toBe(false);
    expect(value(deferStatusCheck(done, 999, 400))).toBe(done);
  });

  it('a refused task can be retried as is, or reopened for editing', () => {
    const failed = value(markDeliveryFailed(queued(), { code: 'validation', message: '422' }, 50));
    expect(failed.state).toMatchObject({ kind: 'failed', digest: target.digest });
    expect(value(retryDelivery(failed, 60)).state).toMatchObject({ kind: 'queued', attempts: 0 });
    const reopened = value(reopenDraft(failed, 60));
    expect(reopened.state).toEqual({ kind: 'draft' });
    expect(value(renameTask(reopened, 'Again', 61)).title).toBe('Again');
  });

  it('rejects transitions from the wrong state', () => {
    const report = { remoteId: 'r', status: { phase: 'working' as const }, pollAfterSec: 30 };
    expect(markSubmitted(draft(), report, 1)).toMatchObject({
      ok: false,
      error: { code: 'conflict' },
    });
    expect(retryDelivery(queued(), 1)).toMatchObject({ ok: false });
    expect(applyRemoteReport(queued(), report, 1)).toMatchObject({ ok: false });
  });
});
