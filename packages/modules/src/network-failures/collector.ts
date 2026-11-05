import { defineCollector } from '@redline/capture';
import * as z from 'zod/mini';
import type { NetworkFailuresData } from './types';

/**
 * Requests that failed: HTTP errors from the Resource Timing buffer and resources that did not
 * load at all. Nothing is intercepted; query strings are dropped before they leave the page.
 */
export const networkFailuresCollector = defineCollector({
  id: 'network-failures',
  produces: 'network-failures',
  level: 'step',
  priority: 'normal',
  optionsSchema: z.undefined(),
  collect: async ({ context: { pageRuntime } }) => {
    const report = await pageRuntime.runtimeReport();
    if (!report.ok) return { status: 'not-applicable', reason: report.error.message };
    if (report.value.failedRequests.length === 0) {
      return { status: 'not-applicable', reason: 'No failed requests observed' };
    }
    const data: NetworkFailuresData = {
      requests: report.value.failedRequests.map((request) => ({
        url: request.url,
        status: request.status,
        initiator: request.initiator,
        count: request.count,
        secondsAgo: Math.round(request.lastSeenMsAgo / 1000),
      })),
    };
    return { status: 'collected', items: [{ data }] };
  },
});
