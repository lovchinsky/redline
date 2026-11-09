import type { Clock } from '../../ports/system';

const WINDOW_MS = 60_000;

/**
 * At most `perMinute` submissions per user in any sliding minute, in this process. A refused
 * submission learns how many seconds until the oldest one leaves the window.
 */
export class SubmissionLimiter {
  private readonly recent = new Map<string, number[]>();

  constructor(
    private readonly perMinute: number,
    private readonly clock: Clock,
  ) {}

  /** Takes a slot for `user`; returns null when taken, or the seconds to wait. */
  take(user: string): number | null {
    const now = this.clock.now();
    const kept = (this.recent.get(user) ?? []).filter((at) => at > now - WINDOW_MS);
    if (kept.length >= this.perMinute) {
      this.recent.set(user, kept);
      const oldest = kept[0] ?? now;
      return Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    }
    kept.push(now);
    this.recent.set(user, kept);
    return null;
  }
}
