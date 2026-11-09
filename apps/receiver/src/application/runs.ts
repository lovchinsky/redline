import type { Instant, RunId } from '../domain/ids';
import { endRun } from '../domain/run';
import type { AgentRunner } from '../ports/agent';
import type { Logger } from '../ports/system';
import type { UnitOfWork, WorkScope } from '../ports/tasks';

/**
 * Closes a run the task stopped running (`end-run`), in the unit of work that moved the task:
 * its record says when it ended, and its grants are revoked, so it cannot spend once it is over.
 */
export const closeRun = async (scope: WorkScope, runId: RunId, at: Instant): Promise<void> => {
  const run = await scope.runs.get(runId);
  if (run !== null && run.endedAt === null) await scope.runs.save(endRun(run, at));
  await scope.grants.revoke(runId);
};

/**
 * Frees what runs that are over still hold where they ran: a sandbox whose run its task stopped
 * running but no worker released (the worker stopped in between, or the release ran on another
 * host), or one whose run never got a record.
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
      if (run !== null && run.endedAt === null) continue;
      this.deps.logger.info('Releasing a stray run', { runId, recorded: run !== null });
      await this.deps.runner.release(runId);
    }
  }
}
