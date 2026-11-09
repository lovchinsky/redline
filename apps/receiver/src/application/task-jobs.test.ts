import { describe, expect, it } from 'vitest';
import type { RunOutcome } from '../domain/run';
import { ReleaseStrays } from './task-jobs';
import { silentLogger } from './testing/fakes';
import { never, system } from './testing/system';

const noChange: RunOutcome = { kind: 'no-change', explanation: 'Already equal' };

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
