import { LIMITS, clip, type FailedRequest } from './protocol';
import { withoutQuery } from './urls';

/** Distinct failures kept; the oldest goes first. */
const MAX_DISTINCT = 50;

interface Failure {
  readonly url: string;
  readonly status: number;
  readonly initiator: string;
  readonly count: number;
  readonly lastSeen: number;
}

/** The page's window, with the constructors the log checks against. */
export type ObservedWindow = Window &
  Pick<typeof globalThis, 'PerformanceObserver' | 'PerformanceResourceTiming' | 'Element'>;

/**
 * Requests that failed, observed without wrapping fetch or XHR: HTTP error statuses as the
 * browser's resource timing reports them, and resources whose loading failed outright, seen as
 * `error` events. A resource that did get an error status (an image answered 404) fires the
 * event too; its status says more, so it is reported once, with the status.
 */
export class NetworkLog {
  private readonly failures = new Map<string, Failure>();

  constructor(
    private readonly view: ObservedWindow,
    private readonly now: () => number,
  ) {
    const record = (entries: readonly PerformanceEntry[]) => {
      for (const entry of entries) {
        if (!(entry instanceof view.PerformanceResourceTiming) || entry.responseStatus < 400) {
          continue;
        }
        this.add(entry.name, entry.responseStatus, entry.initiatorType, entry.responseEnd);
      }
    };
    // An observer rather than the timing buffer, which stops recording at 250 entries.
    try {
      new view.PerformanceObserver((list) => {
        record(list.getEntries());
      }).observe({ type: 'resource', buffered: true });
    } catch {
      record(view.performance.getEntriesByType('resource'));
    }

    // Resource errors do not bubble; the capture phase on window sees them.
    view.addEventListener(
      'error',
      (event) => {
        const target = event.target;
        if (event instanceof ErrorEvent || !(target instanceof view.Element)) return;
        const url = target.getAttribute('src') ?? target.getAttribute('href');
        if (url !== null) this.add(url, 0, target.localName, this.now());
      },
      true,
    );
  }

  report(limit: number): FailedRequest[] {
    const withStatus = new Set(
      [...this.failures.values()].filter((f) => f.status !== 0).map((f) => f.url),
    );
    const now = this.now();
    return [...this.failures.values()]
      .filter((failure) => failure.status !== 0 || !withStatus.has(failure.url))
      .sort((a, b) => b.lastSeen - a.lastSeen)
      .slice(0, limit)
      .map(({ url, status, initiator, count, lastSeen }) => ({
        url,
        status,
        initiator,
        count,
        lastSeenMsAgo: Math.max(0, Math.round(now - lastSeen)),
      }));
  }

  private add(rawUrl: string, status: number, rawInitiator: string, at: number): void {
    const url = clip(withoutQuery(rawUrl, this.view.location.href), LIMITS.url);
    const initiator = clip(rawInitiator, LIMITS.initiator);
    const key = `${String(status)} ${url}`;
    const existing = this.failures.get(key);
    if (existing !== undefined) {
      this.failures.set(key, {
        ...existing,
        count: existing.count + 1,
        lastSeen: Math.max(existing.lastSeen, at),
      });
      return;
    }
    if (this.failures.size >= MAX_DISTINCT) {
      const [oldest] = [...this.failures.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
      if (oldest !== undefined) this.failures.delete(oldest[0]);
    }
    this.failures.set(key, { url, status, initiator, count: 1, lastSeen: at });
  }
}
