import type {
  AppError,
  AssetStore,
  CaptureId,
  FragmentCatalog,
  Logger,
  Result,
  StepCapture,
} from '@redline/core';
import type { CaptureRepository } from '../../ports/capture';

export interface StoredCapturesDeps {
  readonly repository: CaptureRepository;
  readonly assets: AssetStore;
  readonly catalog: FragmentCatalog;
  readonly logger: Logger;
}

/** Context collected for steps, as the draft use cases need it. */
export class StoredCaptures {
  constructor(private readonly deps: StoredCapturesDeps) {}

  /**
   * Reads a capture through the catalog, so fragments written by an older version of a
   * module are migrated to the current one before anything renders them.
   */
  async load(id: CaptureId): Promise<Result<StepCapture, AppError>> {
    const record = await this.deps.repository.get(id);
    return record.ok ? this.deps.catalog.parseCapture(record.value.capture) : record;
  }

  /**
   * Deletes captures together with their images, so removed work does not linger. Best
   * effort: anything left behind is unreferenced and garbage collection removes it later.
   */
  async dispose(ids: readonly CaptureId[]): Promise<void> {
    const { repository, assets, logger } = this.deps;
    for (const id of ids) {
      const record = await repository.get(id);
      if (record.ok) {
        for (const asset of record.value.capture.fragments.flatMap((f) => f.assets)) {
          const released = await assets.release(asset.id);
          if (!released.ok) logger.warn('Could not delete an image', { ...released.error });
        }
      }
      const deleted = await repository.delete(id);
      if (!deleted.ok) logger.warn('Could not delete a capture', { ...deleted.error });
    }
  }
}
