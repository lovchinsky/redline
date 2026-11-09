import { describe, expect, it } from 'vitest';
import { ProjectId, QuestionId, TaskId } from '../domain/ids';
import { ann, apiKey, bob, MANIFEST, project, subscription } from './testing/fakes';
import { never, system } from './testing/system';

const requiring = {
  credentials: 'required',
  operator: null,
  acceptRequesterSubscriptions: false,
} as const;

describe('listing projects', () => {
  it('lists the projects a user may submit to, and what credential the receiver needs', () => {
    const app = system(requiring);
    app.catalog.projects.push(
      project({
        id: ProjectId('secret'),
        name: 'Secret',
        access: { kind: 'users', users: [bob.id] },
      }),
    );
    expect(app.requests.listProjects(ann)).toEqual({
      projects: [{ id: 'acme', name: 'Acme Web' }],
      modelCredential: 'required',
    });
  });
});

describe('submitting', () => {
  it('stores a queued task, records it and schedules its first run in one unit of work', async () => {
    const app = system();
    const task = await app.submit();
    expect(task).toMatchObject({
      requester: 'ann',
      projectId: 'acme',
      bundle: { manifest: MANIFEST, title: 'Rename "Most popular" to "Best value"' },
      credentials: 'operator',
      state: { kind: 'queued', resumeFrom: null },
      version: 1,
    });
    expect(await app.store.history(task.id)).toEqual([{ type: 'submitted', at: 1_000 }]);
    expect(app.store.jobsOf('run')).toEqual([
      { job: { queue: 'run', taskId: task.id, projectId: 'acme' }, startAfter: null },
    ]);
  });

  it('returns the task submitted earlier under the same key, once', async () => {
    const app = system();
    const first = await app.submit({ key: 'delivery-7' });
    const again = await app.submit({ key: 'delivery-7' });
    expect(again.id).toBe(first.id);
    expect(app.store.state.tasks.size).toBe(1);
    expect(app.store.jobsOf('run')).toHaveLength(1);
    expect(await app.requests.findSubmitted(ann, 'delivery-7', null)).toEqual(first);
    // Keys belong to their requester.
    expect((await app.submit({ key: 'delivery-7', user: bob })).id).not.toBe(first.id);
  });

  it('treats a project the user may not use as unknown', async () => {
    const app = system();
    app.catalog.projects = [project({ access: { kind: 'users', users: [bob.id] } })];
    const refused = await app.requests.submit({
      requester: ann,
      idempotencyKey: 'k',
      projectId: ProjectId('acme'),
      manifest: MANIFEST,
      credential: null,
    });
    expect(refused).toEqual({ ok: false, error: { code: 'invalid', message: 'Unknown project' } });
  });

  it('runs a task with the requester’s credential when the receiver requires one', async () => {
    const app = system(requiring);
    const refused = await app.requests.submit({
      requester: ann,
      idempotencyKey: 'k',
      projectId: ProjectId('acme'),
      manifest: MANIFEST,
      credential: null,
    });
    expect(refused.ok).toBe(false);

    const task = await app.submit({ credential: apiKey });
    expect(task.credentials).toBe('requester');
    expect(app.vault.credentials.get(task.id)).toBe(apiKey);
  });

  it('accepts a subscription token only where the receiver allows it', async () => {
    const refusing = system(requiring);
    await expect(refusing.submit({ credential: subscription })).rejects.toThrow(
      'subscription tokens',
    );
    const accepting = system({
      credentials: 'required',
      operator: null,
      acceptRequesterSubscriptions: true,
    });
    expect((await accepting.submit({ credential: subscription })).credentials).toBe('requester');
  });

  it('falls back to the operator’s credential when the requester’s is optional', async () => {
    const app = system({
      credentials: 'optional',
      operator: 'api-key',
      acceptRequesterSubscriptions: false,
    });
    expect((await app.submit()).credentials).toBe('operator');
    expect((await app.submit({ key: 'k2', credential: apiKey })).credentials).toBe('requester');
  });

  it('never keeps a credential a managed receiver does not need', async () => {
    const app = system();
    const task = await app.submit({ credential: apiKey });
    expect(task.credentials).toBe('operator');
    expect(app.vault.credentials.size).toBe(0);
  });
});

describe('following a task', () => {
  it('hides other people’s tasks and unknown ones alike', async () => {
    const app = system();
    const task = await app.submit();
    expect((await app.requests.state(bob, task.id, null)).ok).toBe(false);
    expect(await app.requests.state(ann, TaskId('nope'), null)).toEqual({
      ok: false,
      error: { code: 'not-found', message: 'Unknown task' },
    });
  });

  it('schedules the run of a queued task whenever its credential comes', async () => {
    const app = system(requiring);
    const task = await app.submit({ credential: apiKey });
    // The gateway lost the credential, and the run found it missing; the extension sent it again
    // while the run was still running, so the vault holds it before the task is queued.
    app.runner.outcomes.push({
      kind: 'failed',
      reason: 'credential-missing',
      detail: 'gone',
      snapshot: null,
    });
    app.runner.onStart = (spec) => {
      app.store.state.refusals.set(spec.runId, { kind: 'credential-missing' });
    };
    await app.supervise.handle(task.id, never);
    expect(app.store.task(task.id).state.kind).toBe('queued');
    const scheduled = app.store.jobsOf('run').length;
    await app.requests.state(ann, task.id, apiKey);
    expect(app.vault.credentials.get(task.id)).toBe(apiKey);
    expect(app.store.jobsOf('run')).toHaveLength(scheduled + 1);
  });
});

describe('answering', () => {
  it('answers the open question and schedules the resumed run', async () => {
    const app = system();
    const task = await app.submit();
    app.runner.outcomes.push({
      kind: 'question',
      question: {
        id: QuestionId('q1'),
        text: 'Every breakpoint?',
        options: ['Yes', 'Desktop only'],
      },
      snapshot: null,
    });
    await app.supervise.handle(task.id, new AbortController().signal);
    const answered = await app.requests.reply(
      ann,
      task.id,
      { questionId: QuestionId('q1'), text: 'Yes' },
      null,
    );
    expect(answered.ok && answered.value.state.kind).toBe('queued');
    expect(app.store.jobsOf('run')).toHaveLength(2);

    const wrong = await app.requests.reply(
      ann,
      task.id,
      { questionId: QuestionId('q9'), text: 'Yes' },
      null,
    );
    expect(wrong.ok ? null : wrong.error.code).toBe('conflict');
  });
});
