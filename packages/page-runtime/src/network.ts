import type { FailedRequest } from './protocol';
import { withoutQuery } from './urls';

interface Failure {
  url: string;
  status: number;
  initiator: string;
  count: number;
  lastSeen: number;
}

/**
 * Requests that failed: an HTTP error status from the Resource Timing buffer (no fetch or XHR
 * wrapping), plus resources whose loading failed outright, seen as `error` events.
 */
export class NetworkLog {
  private readonly loadFailures = new Map<string, Failure>();

  constructor(
    private readonly view: Window,
    private readonly now: () => number,
  ) {
    // Resource errors do not bubble; the capture phase on window sees them.
    view.addEventListener(
      'error',
      (event) => {
        const target = event.target;
        if (event instanceof ErrorEvent || !(target instanceof Element)) return;
        const url = target.getAttribute('src') ?? target.getAttribute('href');
        if (url === null) return;
        this.add(this.loadFailures, withoutQuery(url, view.location.href), 0, target.localName);
      },
      true,
    );
  }

  report(limit: number): FailedRequest[] {
    const failures = new Map(this.loadFailures);
    const entries = this.view.performance.getEntriesByType('resource');
    for (const entry of entries) {
      if (!(entry instanceof PerformanceResourceTiming)) continue;
      if (entry.responseStatus < 400) continue;
      this.add(
        failures,
        withoutQuery(entry.name, this.view.location.href),
        entry.responseStatus,
        entry.initiatorType,
        entry.responseEnd,
      );
    }
    const now = this.now();
    return [...failures.values()]
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

  private add(
    into: Map<string, Failure>,
    url: string,
    status: number,
    initiator: string,
    at = this.now(),
  ): void {
    const key = `${String(status)} ${url}`;
    const existing = into.get(key);
    if (existing === undefined) {
      into.set(key, { url, status, initiator, count: 1, lastSeen: at });
    } else {
      into.set(key, {
        ...existing,
        count: existing.count + 1,
        lastSeen: Math.max(existing.lastSeen, at),
      });
    }
  }
}
