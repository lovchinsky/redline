import type { RunId } from '../domain/ids';
import type { Run } from '../domain/run';
import type { AgentRunner } from '../ports/agent';
import type { Logger } from '../ports/system';
import type { UnitOfWork, WorkScope } from '../ports/tasks';

/**
 * Ends a run, however it ends: its record is closed by `close` while it is still open, and its
 * grants are revoked, so it cannot spend once it is over.
 */
export const closeRun = async (
  scope: WorkScope,
  runId: RunId,
  close: (run: Run) => Run,
): Promise<void> => {
  const run = await scope.runs.get(runId);
  if (run?.state.kind === 'started') await scope.runs.save(close(run));
  await scope.grants.revoke(runId);
};

/**
 * Frees what runs that are over still hold where they ran: a sandbox whose outcome was applied
 * but not released (the worker stopped in between), or one whose run never got a record.
 */
export class ReleaseStrays {
  constructor(
    private readonly deps: {
      readonly uow: UnitOfWork;
      readonly runner: AgentRunner;
      readonly logger: Logger;
    },
  ) {}

  async handle(): Promise<void> {
    for (const runId of await this.deps.runner.live()) {
      const run = await this.deps.uow.run((scope) => scope.runs.get(runId));
      if (run?.state.kind === 'started') continue;
      this.deps.logger.info('Releasing a stray run', { runId, state: run?.state.kind ?? 'none' });
      await this.deps.runner.release(runId);
    }
  }
}
