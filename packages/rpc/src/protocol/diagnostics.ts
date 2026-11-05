/** How capturing went, kept for the user to look at and export. */
import * as z from 'zod/mini';
import { defineProtocol } from '../runtime/define';
import { empty } from './shared';

export const collectorRunSchema = z.object({
  collector: z.string(),
  /** 1-based number of the area; `null` for collectors that run once per step. */
  area: z.nullable(z.int().check(z.positive())),
  outcome: z.enum([
    'collected',
    'not-applicable',
    'unavailable',
    'failed',
    'timed-out',
    'invalid-output',
  ]),
  durationMs: z.number().check(z.nonnegative()),
  fragments: z.int().check(z.nonnegative()),
});

/** How collecting context for one step went, as the page reports it. */
export const captureReportSchema = z.object({
  /** Origin and path of the page, without query or fragment. */
  page: z.string(),
  areas: z.int().check(z.positive()),
  durationMs: z.number().check(z.nonnegative()),
  collectors: z.readonly(z.array(collectorRunSchema)),
});

export type CaptureReportInput = z.infer<typeof captureReportSchema>;

/** A journal entry: the report, stamped by the service worker. */
export const captureRecordSchema = z.extend(captureReportSchema, {
  id: z.string(),
  at: z.number(),
});

export type CaptureRecord = z.infer<typeof captureRecordSchema>;

export const diagnosticsMethods = defineProtocol({
  /** Adds a capture to the local Diagnostics journal. */
  'diagnostics.record': {
    request: captureReportSchema,
    response: empty,
    callers: ['content-script'],
  },
  /** The journal, most recent first. */
  'diagnostics.list': {
    request: empty,
    response: z.object({ records: z.readonly(z.array(captureRecordSchema)) }),
    callers: ['extension'],
  },
  'diagnostics.clear': { request: empty, response: empty, callers: ['extension'] },
});
