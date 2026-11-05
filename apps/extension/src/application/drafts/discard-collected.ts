import type { Logger, Step, TaskId } from '@redline/core';
import type { BundleRepository } from '../../ports/drafts';
import type { StoredCaptures } from './stored-captures';

export interface DiscardCollectedDeps {
  readonly bundles: BundleRepository;
  readonly captures: StoredCaptures;
  readonly logger: Logger;
}

/**
 * Discards what was collected for a draft or task that is gone: its frozen bundle and the
 * context of its steps. Best effort: what is left is unreferenced, and garbage collection
 * removes it later.
 */
export const discardCollected = async (
  { bundles, captures, logger }: DiscardCollectedDeps,
  taskId: TaskId,
  steps: readonly Step[],
): Promise<void> => {
  const bundle = await bundles.delete(taskId);
  if (!bundle.ok) logger.warn('Could not delete a bundle', { taskId, ...bundle.error });
  await captures.dispose(steps.map((step) => step.captureId));
};
