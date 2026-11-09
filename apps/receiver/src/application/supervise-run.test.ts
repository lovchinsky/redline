import { describe, expect, it } from 'vitest';
import { QuestionId, RunId, type BlobDigest } from '../domain/ids';
import type { RunOutcome } from '../domain/run';
import { apiKey } from './testing/fakes';
import { never, system } from './testing/system';

const report = {
  summary: 'Renamed the badge',
  changes: [],
  verification: 'unit tests pass',
  assumptions: [],
};
const change: RunOutcome = {
  kind: 'change',
  change: { blob: 'c'.repeat(64) as BlobDigest, head: 'b'.repeat(40) },
  report,
};
const pausedAt = {
  blob: 'd'.repeat(64) as BlobDigest,
  image: 'redline-agent@sha256:1',
  model: 'claude-opus-5-5',
  questionId: QuestionId('q1'),
};
const question: RunOutcome = {
  kind: 'question',
  question: { id: QuestionId('q1'), text: 'Every breakpoint?', options: [] },
  snapshot: pausedAt,
};

describe('SuperviseRun', () => {
  it('records the run, fixes the base, starts the agent and applies its outcome', async () => {
    const app = system();
    const task = await app.submit();
    app.runner.outcomes.push(change);
    await app.supervise.handle(task.id, never);

    const [spec] = app.runner.started;
    expect(spec).toMatchObject({
      taskId: task.id,
      baseSha: 'base-sha',
      resumeFrom: null,
      brief: { title: task.bundle.title, questionsLeft: 2 },
    });
    const runId = spec?.runId ?? RunId('');
    expect(spec?.grants).toEqual({ setup: `grant-setup-${runId}`, agent: `grant-agent-${runId}` });
    expect(spec?.credential).toBe('api-key');
    expect(app.store.state.issued).toEqual([
      { phase: 'setup', runId, taskId: task.id, hosts: ['registry.npmjs.org'] },
      {
        phase: 'agent',
        runId,
        taskId: task.id,
        model: 'claude-opus-5-5',
        credentials: 'operator',
        budget: { usd: 10, tokens: 10_000_000 },
      },
    ]);

    const stored = app.store.task(task.id);
    expect(stored.state.kind).toBe('publishing');
    expect(stored.baseSha).toBe('base-sha');
    expect(app.store.state.runs.get(runId)?.state).toMatchObject({
      kind: 'finished',
      applied: true,
    });
    expect(app.store.state.grants.size).toBe(0);
    expect(app.store.jobsOf('publish')).toHaveLength(1);
    expect(app.runner.released).toEqual([runId]);
    expect((await app.store.history(task.id)).map((event) => event.type)).toEqual([
      'submitted',
      'run-started',
      'base-fixed',
      'change-proposed',
    ]);
  });

  it('resumes a paused session from its snapshot after the answer', async () => {
    const app = system();
    const task = await app.submit();
    app.runner.outcomes.push(question, change);
    await app.supervise.handle(task.id, never);
    expect(app.store.task(task.id).state.kind).toBe('awaiting-reply');
    expect(app.store.jobsOf('reply-timeout')).toHaveLength(1);

    await app.requests.reply(
      { id: task.requester, name: 'Ann', email: null },
      task.id,
      { questionId: QuestionId('q1'), text: 'Desktop only' },
      null,
    );
    await app.supervise.handle(task.id, never);
    const resumed = app.runner.started[1];
    expect(resumed).toMatchObject({
      resumeFrom: pausedAt,
      baseSha: 'base-sha',
      brief: { questionsLeft: 1 },
    });
    expect(app.store.state.runs.get(resumed?.runId ?? RunId(''))?.kind).toBe('resume');
    expect(app.store.task(task.id).state.kind).toBe('publishing');
  });

  it('starts over, told the exchanges, when the paused session cannot be resumed', async () => {
    const app = system();
    const task = await app.submit();
    app.runner.outcomes.push(question, change);
    await app.supervise.handle(task.id, never);
    await app.requests.reply(
      { id: task.requester, name: 'Ann', email: null },
      task.id,
      { questionId: QuestionId('q1'), text: 'Desktop only' },
      null,
    );
    // The image was updated while the task waited for the answer.
    app.runner.resumes = false;
    await app.supervise.handle(task.id, never);
    const replayed = app.runner.started[1];
    expect(replayed?.resumeFrom).toBeNull();
    expect(replayed?.brief.exchanges).toMatchObject([
      { question: { id: 'q1' }, answer: { source: 'requester', text: 'Desktop only' } },
    ]);
    expect(app.store.state.runs.get(replayed?.runId ?? RunId(''))?.kind).toBe('replay');
    expect(app.store.task(task.id).state.kind).toBe('publishing');
  });

  it('requeues on the subscription’s limit only when the gateway refused the run so', async () => {
    const claimed: RunOutcome = { kind: 'quota-exhausted', resetAt: 10, snapshot: null };
    const app = system();
    const task = await app.submit();
    app.runner.outcomes.push(claimed);
    await app.supervise.handle(task.id, never);
    // The agent wrote the outcome itself: nothing in the gateway bears it out.
    expect(app.store.task(task.id).state).toMatchObject({
      kind: 'failed',
      failure: { code: 'agent-failed' },
    });

    const confirmed = system();
    const queued = await confirmed.submit();
    confirmed.runner.outcomes.push(claimed);
    confirmed.runner.onStart = (spec) => {
      confirmed.store.state.refusals.set(spec.runId, { kind: 'quota-exhausted', resetAt: 5_000 });
    };
    await confirmed.supervise.handle(queued.id, never);
    expect(confirmed.store.task(queued.id).state.kind).toBe('queued');
    // At the gateway's reset time, not the one the run gave.
    expect(confirmed.store.jobsOf('run').at(-1)?.startAfter).toBe(5_000);
  });

  it('does not start a task whose requester’s credential is not in the vault', async () => {
    const app = system({
      credentials: 'required',
      operator: null,
      acceptRequesterSubscriptions: false,
    });
    const task = await app.submit({ credential: apiKey });
    app.vault.credentials.clear();
    await app.supervise.handle(task.id, never);
    expect(app.runner.started).toEqual([]);
    expect(app.store.task(task.id).state.kind).toBe('queued');
  });

  it('attaches to the run of a running task instead of starting another', async () => {
    const app = system();
    const task = await app.submit();
    app.runner.outcomes.push(change);
    // A supervisor started the run and died before its outcome.
    const originalObserve = app.runner.observe.bind(app.runner);
    app.runner.observe = () => new Promise(() => undefined);
    const dying = new AbortController();
    void app.supervise.handle(task.id, dying.signal);
    await new Promise((resolve) => setImmediate(resolve));
    expect(app.store.task(task.id).state.kind).toBe('running');

    app.runner.observe = originalObserve;
    await app.supervise.handle(task.id, never);
    expect(app.runner.started).toHaveLength(1);
    expect(app.store.task(task.id).state.kind).toBe('publishing');
  });

  it('requeues the task with a delay when the run is lost', async () => {
    const app = system();
    const task = await app.submit();
    app.runner.outcomes.push({ kind: 'lost', detail: 'sandbox vanished' });
    await app.supervise.handle(task.id, never);
    const stored = app.store.task(task.id);
    expect(stored.state).toEqual({ kind: 'queued', resumeFrom: null });
    expect(stored.runAttempts).toBe(1);
    const runId = app.runner.started[0]?.runId ?? RunId('');
    expect(app.store.state.runs.get(runId)?.state.kind).toBe('interrupted');
    expect(app.store.jobsOf('run').at(-1)?.startAfter).toBe(1_000 + 1_000);
  });

  it('turns a refused start into a run outcome', async () => {
    const app = system();
    const task = await app.submit();
    app.runner.startError = { transient: false, detail: 'image not found' };
    await app.supervise.handle(task.id, never);
    expect(app.store.task(task.id).state).toMatchObject({
      kind: 'failed',
      failure: { code: 'agent-failed' },
    });
    expect(app.store.state.grants.size).toBe(0);
  });

  it('fails a task whose repository cannot be read, and retries a transient failure', async () => {
    const permanent = system();
    const task = await permanent.submit();
    permanent.git.failures.set('prepare', { transient: false, detail: 'repository not found' });
    await permanent.supervise.handle(task.id, never);
    expect(permanent.store.task(task.id).state).toMatchObject({
      failure: { code: 'repository-unavailable' },
    });

    const transient = system();
    const other = await transient.submit();
    transient.git.failures.set('prepare', { transient: true, detail: '502' });
    await transient.supervise.handle(other.id, never);
    expect(transient.store.task(other.id).state.kind).toBe('queued');
    expect(transient.runner.started).toEqual([]);
  });

  it('keeps a cancelled task cancelled when its run reports afterwards', async () => {
    const app = system();
    const task = await app.submit();
    app.runner.observe = async () => {
      await app.operations.cancel(task.id, 'not needed');
      return change;
    };
    await app.supervise.handle(task.id, never);
    expect(app.store.task(task.id).state).toEqual({ kind: 'cancelled', reason: 'not needed' });
    const runId = app.runner.started[0]?.runId ?? RunId('');
    expect(app.store.state.runs.get(runId)?.state).toMatchObject({
      kind: 'finished',
      applied: false,
    });
    expect(app.store.jobsOf('abort-run')).toEqual([
      { job: { queue: 'abort-run', taskId: task.id, runId }, startAfter: null },
    ]);
    expect(app.store.state.grants.size).toBe(0);
  });

  it('forgets the requester’s credential when the task ends', async () => {
    const app = system({
      credentials: 'required',
      operator: null,
      acceptRequesterSubscriptions: false,
    });
    const task = await app.submit({ credential: apiKey });
    app.runner.outcomes.push({ kind: 'no-change', explanation: 'Already done' });
    await app.supervise.handle(task.id, never);
    expect(app.vault.credentials.size).toBe(0);
  });

  it('decides again when the task changed while it was being saved', async () => {
    const app = system();
    const task = await app.submit();
    app.runner.outcomes.push(change);
    app.store.concurrentWrites = 2;
    await app.supervise.handle(task.id, never);
    expect(app.store.task(task.id).state.kind).toBe('publishing');
    expect(app.runner.started).toHaveLength(1);
  });
});
