import type { AppError, Logger, Result, SerialQueue, TaskId } from '@redline/core';
import type { AppEvents, EventPublisher } from '@redline/rpc';
import type { ActiveDraftStore } from '../../ports/drafts';

export interface DraftWriterDeps {
  readonly queue: SerialQueue;
  readonly active: ActiveDraftStore;
  readonly events: EventPublisher<AppEvents>;
  readonly logger: Logger;
}

/**
 * The single way draft state is written. Writes run one at a time (read → change → save
 * cannot interleave between a step commit and an edit from the side panel) and every change
 * is announced to UI contexts.
 */
export class DraftWriter {
  constructor(private readonly deps: DraftWriterDeps) {}

  run<T>(work: () => Promise<Result<T, AppError>>): Promise<Result<T, AppError>> {
    return this.deps.queue.run(work);
  }

  /** Tells UI contexts that a draft changed. A failure to announce never fails the write. */
  async announce(taskId: TaskId): Promise<void> {
    const active = await this.deps.active.get();
    const published = this.deps.events.publish('drafts.changed', {
      taskId,
      activeId: active.ok ? active.value : null,
    });
    if (!published.ok) {
      this.deps.logger.error('Could not announce a draft change', { ...published.error });
    }
  }
}
