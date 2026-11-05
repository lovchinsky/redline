import { defineCollector } from '@redline/capture';
import * as z from 'zod/mini';
import type { RuntimeErrorsData } from './types';

/**
 * Uncaught errors and unhandled rejections the page produced, newest first. Observed in the
 * page's world without patching anything; on a bound site from page load, otherwise from the
 * moment capture started.
 */
export const runtimeErrorsCollector = defineCollector({
  id: 'runtime-errors',
  produces: 'runtime-errors',
  level: 'step',
  priority: 'high',
  optionsSchema: z.undefined(),
  collect: async ({ context: { pageRuntime } }) => {
    const report = await pageRuntime.runtimeReport();
    if (!report.ok) return { status: 'not-applicable', reason: report.error.message };
    if (report.value.errors.length === 0) {
      return { status: 'not-applicable', reason: 'No errors observed' };
    }
    const data: RuntimeErrorsData = {
      observedSince: report.value.observedSince,
      errors: report.value.errors.map((error) => ({
        message: error.message,
        source: error.source,
        count: error.count,
        secondsAgo: Math.round(error.lastSeenMsAgo / 1000),
      })),
    };
    return { status: 'collected', items: [{ data }] };
  },
});
