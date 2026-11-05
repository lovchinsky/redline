import { parseWith, type FragmentCatalog } from '@redline/core';
import type { ErasedCollector } from './collector';

/** A collector id, or an id with options for it. */
export type PlanEntry = string | readonly [collectorId: string, options: unknown];

/** Which collectors run for every step, with their options. Declarative configuration. */
export interface CaptureProfile {
  readonly collectors: readonly PlanEntry[];
}

export interface PlannedInvocation {
  readonly collector: ErasedCollector;
  readonly options: unknown;
}

export interface CollectionPlan {
  readonly invocations: readonly PlannedInvocation[];
}

export class PlanConfigError extends Error {
  override readonly name = 'PlanConfigError';
}

/**
 * Resolves a profile into a ready-to-run plan. Every collector id is looked up, its options
 * validated and the kind it produces checked against the catalog here, so a misconfigured
 * profile or a module registered by halves fails at start-up, not during every capture.
 */
export const buildCollectionPlan = (
  collectors: readonly ErasedCollector[],
  profile: CaptureProfile,
  catalog: Pick<FragmentCatalog, 'get'>,
): CollectionPlan => {
  const byId = new Map<string, ErasedCollector>();
  for (const collector of collectors) {
    if (byId.has(collector.id)) {
      throw new PlanConfigError(`Collector "${collector.id}" is registered twice`);
    }
    byId.set(collector.id, collector);
  }
  const seen = new Set<string>();
  const invocations = profile.collectors.map((entry): PlannedInvocation => {
    const [id, rawOptions] = typeof entry === 'string' ? [entry, undefined] : entry;
    const collector = byId.get(id);
    if (collector === undefined) {
      throw new PlanConfigError(`The profile uses unknown collector "${id}"`);
    }
    if (seen.has(id)) throw new PlanConfigError(`The profile lists "${id}" twice`);
    if (catalog.get(collector.produces) === undefined) {
      throw new PlanConfigError(
        `Collector "${id}" produces "${collector.produces}", which has no fragment descriptor`,
      );
    }
    seen.add(id);
    const options = parseWith(collector.optionsSchema, rawOptions);
    if (!options.ok) {
      throw new PlanConfigError(
        `The profile has invalid options for "${id}": ${JSON.stringify(options.error.details)}`,
      );
    }
    return { collector, options: options.value };
  });
  return { invocations };
};
