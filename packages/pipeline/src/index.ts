import {
  CaptureEngine,
  buildCollectionPlan,
  type CollectionPlan,
  type ExecutionPolicy,
} from '@redline/capture';
import { FragmentCatalog, type Clock } from '@redline/core';
import { collectors } from '@redline/modules/collectors';
import { fragmentDescriptors } from '@redline/modules/descriptors';
import { redactionProcessor } from '@redline/processors';
import { captureProfile } from '@redline/profiles';

/** Screenshots go through the service worker and take longer than collectors in the page. */
export const CAPTURE_POLICY: ExecutionPolicy = {
  defaultTimeoutMs: 2000,
  timeouts: { screenshot: 10_000 },
};

export interface ShippedCapture {
  readonly catalog: FragmentCatalog;
  readonly plan: CollectionPlan;
  readonly engine: CaptureEngine;
}

const idOf = (entry: (typeof captureProfile.collectors)[number]): string =>
  typeof entry === 'string' ? entry : entry[0];

/**
 * The capture the extension ships: its collectors with the profile's options, redaction before
 * anything leaves the page, and its time budgets. Evaluation, golden files and performance runs
 * use exactly this, narrowed with `only` to the collectors they measure, so what they report is
 * what users get.
 */
export const shippedCapture = (
  clock: Clock,
  only: (collectorId: string) => boolean = () => true,
): ShippedCapture => {
  const catalog = new FragmentCatalog(fragmentDescriptors);
  return {
    catalog,
    plan: buildCollectionPlan(collectors, {
      collectors: captureProfile.collectors.filter((entry) => only(idOf(entry))),
    }),
    engine: new CaptureEngine(catalog, [redactionProcessor], CAPTURE_POLICY, clock),
  };
};
