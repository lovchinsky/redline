import { defineCollector } from '@redline/capture';
import { DEFAULT_SERIALIZE_OPTIONS, describeElement, serializeElement } from '@redline/dom';
import * as z from 'zod/mini';
import type { DomSnapshotData } from './types';

const optionsSchema = z.prefault(
  z.object({
    maxLength: z._default(z.int().check(z.positive()), 4096),
    maxDepth: z._default(z.int().check(z.positive()), 4),
  }),
  {},
);

/** Compact, sanitized HTML of the region's container; goes to a detail file, not context.md. */
export const domSnapshotCollector = defineCollector({
  id: 'dom-snapshot',
  produces: 'dom-snapshot',
  level: 'shape',
  priority: 'low',
  optionsSchema,
  collect: ({ shape, options, context: { dom } }) => {
    const { container, groups } = shape.region;
    const { html, truncated } = serializeElement(dom, container, {
      ...DEFAULT_SERIALIZE_OPTIONS,
      ...options,
      marked: new Set(groups.flatMap((group) => group.elements)),
    });
    const data: DomSnapshotData = { root: describeElement(container), html, truncated };
    return Promise.resolve({ status: 'collected', items: [{ data }] });
  },
});
