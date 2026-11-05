import {
  mayReturnToDrafts,
  ok,
  type AppError,
  type AssetStore,
  type Clock,
  type Logger,
  type Result,
} from '@redline/core';
import type { CaptureRepository } from '../../ports/capture';
import type { AssetInventory } from '../../ports/drafts';
import type { DraftRepository, TaskRepository } from '../../ports/workspace';
import type { WorkspaceWriter } from '../workspace/workspace-writer';

/** Data younger than this may belong to a capture still in progress. */
export const GARBAGE_GRACE_MS = 60 * 60 * 1000;

export interface CollectGarbageDeps {
  readonly drafts: DraftRepository;
  readonly tasks: TaskRepository;
  readonly captures: CaptureRepository;
  readonly assets: AssetStore & AssetInventory;
  readonly writer: WorkspaceWriter;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Deletes what nothing refers to: captures no draft (or task that may become one again) uses,
 * and assets no capture uses (viewport snapshots once their crops are made, leftovers of failed
 * commits). Reachability is the only rule, so no use case has to remember to clean up after
 * itself for correctness.
 */
export class CollectGarbage {
  constructor(private readonly deps: CollectGarbageDeps) {}

  execute(): Promise<Result<{ captures: number; assets: number }, AppError>> {
    return this.deps.writer.exclusive(async () => {
      const { drafts, tasks, captures, assets, clock, logger } = this.deps;
      const cutoff = clock.now() - GARBAGE_GRACE_MS;

      const [allDrafts, allTasks] = await Promise.all([drafts.list(), tasks.list()]);
      if (!allDrafts.ok) return allDrafts;
      if (!allTasks.ok) return allTasks;
      // A sent task's bundle is frozen; its raw context matters only if it may be reopened.
      const usedCaptures = new Set<string>(
        [...allDrafts.value, ...allTasks.value.filter(mayReturnToDrafts)].flatMap((entry) =>
          entry.steps.map((step) => step.captureId),
        ),
      );

      const allCaptures = await captures.list();
      if (!allCaptures.ok) return allCaptures;
      const usedAssets = new Set<string>();
      let deletedCaptures = 0;
      for (const record of allCaptures.value) {
        if (usedCaptures.has(record.id) || record.createdAt >= cutoff) {
          for (const fragment of record.capture.fragments) {
            for (const asset of fragment.assets) usedAssets.add(asset.id);
          }
          continue;
        }
        const deleted = await captures.delete(record.id);
        if (deleted.ok) deletedCaptures += 1;
        else logger.warn('Could not delete an unused capture', { ...deleted.error });
      }

      const oldAssets = await assets.idsCreatedBefore(cutoff);
      if (!oldAssets.ok) return oldAssets;
      let deletedAssets = 0;
      for (const id of oldAssets.value.filter((asset) => !usedAssets.has(asset))) {
        const released = await assets.release(id);
        if (released.ok) deletedAssets += 1;
        else logger.warn('Could not delete an unused asset', { ...released.error });
      }
      return ok({ captures: deletedCaptures, assets: deletedAssets });
    });
  }
}
