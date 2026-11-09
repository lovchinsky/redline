import { describe, expect, it } from 'vitest';
import type { RunOutcome } from '../domain/run';
import { ReleaseStrays } from './runs';
import { silentLogger } from './testing/fakes';
import { never, system } from './testing/system';

const noChange: RunOutcome = { kind: 'no-change', explanation: 'Already equal' };

describe('TaskJobs', () => {
  it('carries a task from submission to its change request, job by job', async () => {
    const app = system();
    const task = await app.submit();
    app.runner.outcomes.push({
      kind: 'change',
      change: { blob: 'c'.repeat(64) as never, head: 'd'.repeat(40) },
      report: { summary: 'Renamed', changes: [], verification: '', assumptions: [] },
    });
    // The run job starts the run and applies its outcome; the run's end frees its sandbox, and
    // the publish job opens the change request.
    expect(await app.work()).toBe(3);
    expect(app.store.task(task.id).state.kind).toBe('published');
  });

  it('works a job when it is due, not before', async () => {
    const app = system();
    const task = await app.submit();
    app.runner.outcomes.push({
      kind: 'question',
      question: { text: 'Which button?', options: [] },
      snapshot: null,
    });
    expect(await app.work()).toBe(2);
    expect(app.store.task(task.id).state.kind).toBe('awaiting-reply');
    // The question's timeout waits for its time.
    expect(await app.work()).toBe(0);

    // Its time runs out: the agent goes on with its own judgement, in a run due at once.
    app.clock.time += 60_000;
    app.runner.outcomes.push({ kind: 'no-change', explanation: 'Nothing to do' });
    expect(await app.work()).toBe(3);
    expect(app.store.task(task.id).state).toMatchObject({
      kind: 'failed',
      failure: { code: 'no-change' },
    });
    // Each run was freed where it ran, and again by its end's job: releasing twice is harmless.
    expect(new Set(app.runner.released)).toEqual(
      new Set(app.runner.started.map((spec) => spec.runId)),
    );
  });

  it('stops at the limit when jobs keep coming', async () => {
    const app = system();
    await app.submit();
    await expect(app.work(0)).rejects.toThrow(/More than 0 jobs/);
  });
});

describe('ReleaseStrays', () => {
  it('releases what finished runs still hold, and leaves a running one alone', async () => {
    const app = system();
    const finished = await app.submit({ key: 'one' });
    app.runner.outcomes.push(noChange);
    await app.supervise.handle(finished.id, never);
    const [done] = app.runner.started;
    // The worker stopped after applying the outcome and before releasing the sandbox.
    app.runner.released.splice(0);

    const running = await app.submit({ key: 'two' });
    // The worker shuts down while it waits: the run goes on, recorded as started.
    const stopping = new AbortController();
    stopping.abort();
    app.runner.outcomes.push(noChange);
    await app.supervise.handle(running.id, stopping.signal);
    const live = app.runner.started[1];

    await new ReleaseStrays({ uow: app.store, runner: app.runner, logger: silentLogger }).handle();
    expect(app.runner.released).toEqual([done?.runId]);
    expect(await app.runner.live()).toEqual([live?.runId]);
  });
});
