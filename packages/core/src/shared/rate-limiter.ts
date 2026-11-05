import type { Clock } from '../ports/clock';
import { SerialQueue } from './serial-queue';

export type Sleep = (ms: number) => Promise<void>;

/**
 * Runs tasks one at a time with at least `minIntervalMs` between their starts.
 * For APIs with a call-rate quota (e.g. `tabs.captureVisibleTab`).
 */
export class SerialRateLimiter {
  private readonly queue = new SerialQueue();
  private lastStart = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly minIntervalMs: number,
    private readonly clock: Clock,
    private readonly sleep: Sleep,
  ) {}

  run<T>(task: () => Promise<T>): Promise<T> {
    return this.queue.run(async () => {
      const wait = this.lastStart + this.minIntervalMs - this.clock.now();
      if (wait > 0) await this.sleep(wait);
      this.lastStart = this.clock.now();
      return task();
    });
  }
}
