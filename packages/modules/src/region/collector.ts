import { defineCollector } from '@redline/capture';
import { summarizeRegion } from '@redline/dom';
import * as z from 'zod/mini';
import type { RegionData } from './types';

/** What the lasso refers to, as resolved when the shape was drawn. */
export const regionCollector = defineCollector({
  id: 'region',
  produces: 'region',
  level: 'shape',
  priority: 'critical',
  optionsSchema: z.undefined(),
  collect: ({ shape }) => {
    const data: RegionData = summarizeRegion(shape.region);
    return Promise.resolve({ status: 'collected', items: [{ data }] });
  },
});
