import {
  ok,
  type AppError,
  type Clock,
  type IdGenerator,
  type Logger,
  type Result,
  type SerialQueue,
} from '@redline/core';
import type { AppEvents, CaptureRecord, CaptureReportInput, EventPublisher } from '@redline/rpc';
import type { JournalStore } from '../../ports/diagnostics';

export interface DiagnosticsJournalDeps {
  readonly store: JournalStore;
  /** Writes are read-modify-write; one queue keeps concurrent captures from losing entries. */
  readonly queue: SerialQueue;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly events: EventPublisher<AppEvents>;
  /** How many captures are kept; older ones drop out (a ring buffer). */
  readonly capacity: number;
  readonly logger: Logger;
}

/** The local journal of capture runs behind Options → Diagnostics. Nothing leaves the browser. */
export class DiagnosticsJournal {
  constructor(private readonly deps: DiagnosticsJournalDeps) {}

  record(report: CaptureReportInput): Promise<Result<Record<string, never>, AppError>> {
    const { store, ids, clock, capacity } = this.deps;
    return this.change(async () => {
      const records = await store.read();
      if (!records.ok) return records;
      const entry: CaptureRecord = { ...report, id: ids.next(), at: clock.now() };
      return store.write([entry, ...records.value].slice(0, capacity));
    });
  }

  /** Most recent first. */
  async list(): Promise<Result<{ records: readonly CaptureRecord[] }, AppError>> {
    const records = await this.deps.store.read();
    return records.ok ? ok({ records: records.value }) : records;
  }

  clear(): Promise<Result<Record<string, never>, AppError>> {
    return this.change(() => this.deps.store.write([]));
  }

  private async change(
    write: () => Promise<Result<void, AppError>>,
  ): Promise<Result<Record<string, never>, AppError>> {
    const written = await this.deps.queue.run(write);
    if (!written.ok) return written;
    const published = this.deps.events.publish('diagnostics.changed', {});
    if (!published.ok)
      this.deps.logger.warn('Could not announce the journal change', { ...published.error });
    return ok({});
  }
}
