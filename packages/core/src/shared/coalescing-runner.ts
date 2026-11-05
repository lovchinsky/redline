/**
 * Runs a job so that it never overlaps itself. A request while the job runs is not lost and
 * not queued many times: the job runs exactly once more afterwards. For "process everything
 * that is due" jobs, where one extra pass covers any number of requests.
 */
export class CoalescingRunner {
  private running: Promise<void> | null = null;
  private requested = false;

  constructor(private readonly job: () => Promise<void>) {}

  /** Resolves when a pass that started after this call has finished. */
  run(): Promise<void> {
    if (this.running !== null) {
      this.requested = true;
      return this.running;
    }
    this.running = this.drain().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async drain(): Promise<void> {
    do {
      this.requested = false;
      await this.job();
    } while (this.takeRequest());
  }

  /** Read through a call: the flag is set by `run` while `job` is awaited. */
  private takeRequest(): boolean {
    return this.requested;
  }
}
