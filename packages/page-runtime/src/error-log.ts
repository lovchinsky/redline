import { LIMITS, clip, type ObservedError } from './protocol';
import { withoutQuery } from './urls';

const MAX_DISTINCT = 30;

interface Entry {
  message: string;
  source: string | null;
  count: number;
  lastSeen: number;
}

const describeReason = (reason: unknown): string => {
  if (reason instanceof Error) return `${reason.name}: ${reason.message}`;
  if (typeof reason === 'string') return reason;
  try {
    // `undefined` for values JSON cannot represent (functions, undefined).
    const json = JSON.stringify(reason) as string | undefined;
    return json ?? String(reason);
  } catch {
    return String(reason);
  }
};

/**
 * Uncaught errors and unhandled rejections seen in the page, deduplicated by message and
 * source. Only observes: nothing on the page is patched or wrapped.
 */
export class ErrorLog {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly view: Window,
    private readonly now: () => number,
  ) {
    view.addEventListener('error', (event) => {
      if (event instanceof ErrorEvent) {
        const source =
          event.filename === ''
            ? null
            : clip(
                `${withoutQuery(event.filename, view.location.href)}:${String(event.lineno)}:${String(event.colno)}`,
                LIMITS.url,
              );
        this.record(event.message || describeReason(event.error), source);
      }
    });
    view.addEventListener('unhandledrejection', (event) => {
      this.record(`Unhandled rejection: ${describeReason(event.reason)}`, null);
    });
  }

  report(limit: number): ObservedError[] {
    const now = this.now();
    return [...this.entries.values()]
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, limit)
      .map((entry) => ({
        message: entry.message,
        source: entry.source,
        count: entry.count,
        lastSeenMsAgo: Math.max(0, Math.round(now - entry.lastSeen)),
      }));
  }

  private record(rawMessage: string, source: string | null): void {
    const message = clip(rawMessage, LIMITS.message);
    const key = `${message}\u0000${source ?? ''}`;
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      existing.count += 1;
      existing.lastSeen = this.now();
      return;
    }
    if (this.entries.size >= MAX_DISTINCT) {
      const oldest = [...this.entries.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen)[0];
      if (oldest !== undefined) this.entries.delete(oldest[0]);
    }
    this.entries.set(key, { message, source, count: 1, lastSeen: this.now() });
  }
}
