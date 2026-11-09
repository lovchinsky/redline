import type { RunId } from '../domain/ids';
import type { Run } from '../domain/run';
import type { WorkScope } from '../ports/tasks';

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
