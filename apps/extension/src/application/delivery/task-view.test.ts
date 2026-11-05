import {
  DeliveryId,
  ProjectId,
  TaskId,
  type DeliveryError,
  type RemoteStatus,
  type Task,
} from '@redline/core';
import { describe, expect, it } from 'vitest';
import { taskViewOf } from './task-view';

const delivery = {
  id: DeliveryId.parse('d1'),
  projectId: ProjectId.parse('acme'),
  projectName: 'Acme',
  digest: 'x',
};
const problem: DeliveryError = { code: 'unavailable', message: 'down' };

const task = (state: Task['state']): Task => ({
  id: TaskId.parse('t1'),
  title: null,
  steps: [],
  revision: 1,
  createdAt: 0,
  updatedAt: 9,
  state,
});

const queued = (lastError: DeliveryError | null) =>
  task({ kind: 'queued', delivery, queuedAt: 1, attempts: 2, nextAttemptAt: 50, lastError });

const submitted = (status: RemoteStatus, checkError: DeliveryError | null = null) =>
  task({
    kind: 'submitted',
    delivery,
    remoteId: 'r1',
    submittedAt: 1,
    status,
    checkedAt: 2,
    pollAfterSec: 30,
    nextCheckAt: 60,
    checkFailures: checkError === null ? 0 : 1,
    checkError,
  });

describe('taskViewOf', () => {
  it('shows a task in the outbox as sending, with the retry once an attempt failed', () => {
    expect(taskViewOf(queued(null))).toMatchObject({
      projectName: 'Acme',
      status: { kind: 'sending', attempts: 2, retry: null },
      actions: ['send-now'],
      finished: false,
    });
    expect(taskViewOf(queued(problem)).status).toEqual({
      kind: 'sending',
      attempts: 2,
      retry: { problem, at: 50 },
    });
  });

  it('offers to send a refused task again, reopen or delete it', () => {
    const refused = task({ kind: 'failed', delivery, error: problem, failedAt: 3 });
    expect(taskViewOf(refused)).toMatchObject({
      status: { kind: 'refused', problem },
      actions: ['send-again', 'reopen', 'delete'],
      finished: false,
    });
  });

  it('follows a task with the agent: refresh while it can change, answer when asked', () => {
    expect(taskViewOf(submitted({ phase: 'working' }))).toMatchObject({
      status: { kind: 'with-agent', remote: { phase: 'working' }, stale: null },
      actions: ['refresh', 'delete'],
      finished: false,
    });
    const asked = submitted({ phase: 'needs-input', question: { id: 'q1', text: 'Which?' } });
    expect(taskViewOf(asked).actions).toEqual(['refresh', 'answer', 'delete']);
    expect(taskViewOf(submitted({ phase: 'working' }, problem)).status).toMatchObject({
      stale: { problem, nextCheckAt: 60 },
    });
  });

  it('offers the result once it is ready, and nothing to refresh after the end', () => {
    const ready = submitted({ phase: 'result-ready', resultUrl: 'https://acme.io/pr/1' });
    expect(taskViewOf(ready)).toMatchObject({
      actions: ['open-result', 'delete'],
      finished: true,
    });
    expect(taskViewOf(submitted({ phase: 'closed' })).actions).toEqual(['delete']);
  });

  it('shows a task the receiver no longer knows as lost, with only delete left', () => {
    const lost = task({ kind: 'lost', delivery, remoteId: 'r1', submittedAt: 1, lostAt: 4 });
    expect(taskViewOf(lost)).toMatchObject({
      status: { kind: 'lost' },
      actions: ['delete'],
      finished: true,
    });
  });
});
