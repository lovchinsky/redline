import { describe, expect, it } from 'vitest';
import { RunId, type BlobDigest } from '../domain/ids';
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
};
const question: RunOutcome = {
  kind: 'question',
  question: { text: 'Every breakpoint?', options: [] },
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
      resume: null,
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
    expect(app.store.state.runs.get(runId)?.endedAt).toBe(1_000);
    expect(app.store.state.grants.size).toBe(0);
    expect(app.store.jobsOf('schedule-publish')).toHaveLength(1);
    expect(app.runner.released).toEqual([runId]);
    expect((await app.store.history(task.id)).map((event) => event.type)).toEqual([
      'submitted',
      'run-started',
      'base-fixed',
      'change-proposed',
    ]);
  });

  it('ends the setup’s grant with the setup: the agent holds only its own', async () => {
    const app = system();
    const task = await app.submit();
    let held: string[] = [];
    app.runner.observe = async (runId, _signal, phases) => {
      await phases.setupDone();
      held = (app.store.state.grants.get(runId) ?? []).map((terms) => terms.phase);
      return change;
    };
    await app.supervise.handle(task.id, never);
    expect(held).toEqual(['agent']);
  });

  it('resumes a paused session from its snapshot after the answer', async () => {
    const app = system();
    const task = await app.submit();
    app.runner.outcomes.push(question, change);
    await app.supervise.handle(task.id, never);
    expect(app.store.task(task.id).state.kind).toBe('awaiting-reply');
    expect(app.store.jobsOf('schedule-reply-timeout')).toHaveLength(1);

    await app.requests.reply(
      { id: task.requester, name: 'Ann', email: null },
      task.id,
      { questionId: app.store.question(task.id), text: 'Desktop only' },
      null,
    );
    await app.supervise.handle(task.id, never);
    const resumed = app.runner.started[1];
    expect(resumed).toMatchObject({
      // The session goes on with the answer it waits on.
      resume: { snapshot: pausedAt, answer: { source: 'requester', text: 'Desktop only' } },
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
      { questionId: app.store.question(task.id), text: 'Desktop only' },
      null,
    );
    // The image was updated while the task waited for the answer.
    app.runner.resumes = false;
    await app.supervise.handle(task.id, never);
    const replayed = app.runner.started[1];
    expect(replayed?.resume).toBeNull();
    expect(replayed?.brief.exchanges).toMatchObject([
      {
        question: { id: `q-${app.runner.started[0]?.runId ?? ''}` },
        answer: { source: 'requester', text: 'Desktop only' },
      },
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
    confirmed.runner.refuseNext({ kind: 'quota-exhausted', resetAt: 5_000 });
    await confirmed.supervise.handle(queued.id, never);
    expect(confirmed.store.task(queued.id).state.kind).toBe('queued');
    // At the gateway's reset time, not the one the run gave.
    expect(confirmed.store.jobsOf('schedule-run').at(-1)?.effect).toEqual({
      kind: 'schedule-run',
      at: 5_000,
    });
  });

  it('makes a task whose requester’s credential is not in the vault wait for it', async () => {
    const app = system({
      credentials: 'required',
      operator: null,
      acceptRequesterSubscriptions: false,
    });
    const task = await app.submit({ credential: apiKey });
    app.vault.credentials.clear();
    await app.supervise.handle(task.id, never);
    expect(app.runner.started).toEqual([]);
    expect(app.store.task(task.id).state).toMatchObject({ kind: 'queued', awaiting: 'credential' });
  });

  it('attaches to the run of a running task instead of starting another', async () => {
    const app = system();
    const task = await app.submit();
    app.runner.outcomes.push(change);
    // A supervisor started the run and died before its outcome.
    app.runner.hangs = true;
    void app.supervise.handle(task.id, new AbortController().signal);
    await app.runner.watched;
    expect(app.store.task(task.id).state.kind).toBe('running');

    app.runner.hangs = false;
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
    expect(stored.state).toEqual({ kind: 'queued', resumeFrom: null, awaiting: null });
    expect(stored.runAttempts).toBe(1);
    const runId = app.runner.started[0]?.runId ?? RunId('');
    expect(app.store.state.runs.get(runId)?.endedAt).toBe(1_000);
    expect(app.runner.released).toEqual([runId]);
    expect(app.store.jobsOf('schedule-run').at(-1)?.effect).toEqual({
      kind: 'schedule-run',
      at: 1_000 + 1_000,
    });
  });

  it('tries a run again when where runs run refused to start it', async () => {
    const app = system();
    const task = await app.submit();
    app.runner.startError = { detail: 'Docker has no image redline-agent@sha256:1' };
    await app.supervise.handle(task.id, never);
    expect(app.store.task(task.id)).toMatchObject({
      state: { kind: 'queued', resumeFrom: null, awaiting: null },
      runAttempts: 1,
    });
    expect(app.store.state.grants.size).toBe(0);
    // Until the task's attempts run out, with the infrastructure's own words.
    for (let attempt = 1; attempt < 3; attempt += 1) {
      await app.supervise.handle(task.id, never);
    }
    expect(app.store.task(task.id).state).toMatchObject({
      kind: 'failed',
      failure: {
        code: 'agent-failed',
        message: expect.stringContaining('Docker has no image redline-agent@sha256:1') as string,
      },
    });
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

  it('readies the task’s base on every run, and fails a task whose base the host lost', async () => {
    const app = system();
    const task = await app.submit();
    app.runner.outcomes.push({ kind: 'failed', reason: 'infra', detail: 'broke', snapshot: null });
    await app.supervise.handle(task.id, never);
    // The second run asks for the base the first one fixed; the host no longer has it.
    app.git.failures.set('prepare', { transient: false, detail: 'no longer has the commit' });
    await app.supervise.handle(task.id, never);
    expect(app.git.prepared).toEqual([null, 'base-sha']);
    expect(app.store.task(task.id).state).toMatchObject({
      failure: { code: 'repository-unavailable' },
    });
  });

  it('runs with the team’s settings at the base, and fails a task whose settings are invalid', async () => {
    const app = system();
    const task = await app.submit();
    app.git.settingsAtBase = {
      setup: { run: 'pnpm install', timeoutMs: 60_000 },
      checks: ['pnpm test'],
    };
    app.runner.outcomes.push({ kind: 'no-change', explanation: 'Already done' });
    await app.supervise.handle(task.id, never);
    expect(app.runner.started[0]).toMatchObject({
      setup: { run: 'pnpm install', timeoutMs: 60_000 },
      brief: { checks: ['pnpm test'] },
    });

    const invalid = system();
    const other = await invalid.submit();
    invalid.git.failures.set('settings', {
      transient: false,
      detail: '.redline/receiver.yaml: setup: Invalid input',
    });
    await invalid.supervise.handle(other.id, never);
    expect(invalid.store.task(other.id).state).toMatchObject({
      failure: {
        code: 'setup-failed',
        message: "The project's setup failed: .redline/receiver.yaml: setup: Invalid input",
      },
    });
    expect(invalid.runner.started).toEqual([]);
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
    // The cancellation closed the run's record with the task: its late outcome changes nothing,
    // and the supervisor frees the run where it ran.
    const runId = app.runner.started[0]?.runId ?? RunId('');
    expect(app.store.state.runs.get(runId)?.endedAt).toBe(1_000);
    expect(app.store.jobsOf('end-run')).toEqual([
      { taskId: task.id, projectId: task.projectId, effect: { kind: 'end-run', runId } },
    ]);
    expect(app.store.state.grants.size).toBe(0);
    expect(app.runner.released).toEqual([runId]);
  });

  it('does not watch a run its task was cancelled while it was being started', async () => {
    const app = system();
    const task = await app.submit();
    const start = app.runner.start.bind(app.runner);
    app.runner.start = async (spec) => {
      const started = await start(spec);
      await app.operations.cancel(task.id, 'not needed');
      return started;
    };
    app.runner.outcomes.push(change);
    await app.supervise.handle(task.id, never);
    const runId = app.runner.started[0]?.runId ?? RunId('');
    expect(app.store.state.runs.get(runId)?.endedAt).toBe(1_000);
    // Nobody waits for its outcome; what the start made goes at once.
    expect(app.runner.outcomes).toEqual([change]);
    expect(app.runner.released).toEqual([runId]);
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
    expect(app.store.jobsOf('forget-credential')).toHaveLength(1);
    await app.work();
    expect(app.vault.credentials.size).toBe(0);
  });

  it('frees the whole sandbox of a run its task no longer wants', async () => {
    const app = system();
    const task = await app.submit();
    app.runner.hangs = true;
    void app.supervise.handle(task.id, never);
    await app.runner.watched;
    await app.operations.cancel(task.id, 'not needed');
    const runId = app.runner.started[0]?.runId ?? RunId('');
    // The run's record and grants closed with the task, whatever becomes of its supervisor.
    expect(app.store.state.runs.get(runId)?.endedAt).toBe(1_000);
    expect(app.store.state.grants.size).toBe(0);
    await app.work();
    expect(app.runner.released).toEqual([runId]);
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

  it('leaves a task it cannot save for the job to try again, rather than take it as superseded', async () => {
    const app = system();
    const task = await app.submit();
    app.store.concurrentWrites = 100;
    await expect(app.supervise.handle(task.id, never)).rejects.toThrow(/kept changing/);
    expect(app.runner.started).toEqual([]);
    expect(app.store.task(task.id).state.kind).toBe('queued');
  });
});
