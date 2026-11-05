import { parseWith, type Intent } from '@redline/core';
import type { ErasedCollector } from './collector';

/** A collector id, or an id with options for it. */
export type PlanEntry = string | readonly [collectorId: string, options: unknown];

export interface ProfileDefinition {
  readonly collectors: readonly PlanEntry[];
}

export type Profiles = Readonly<Record<Intent, ProfileDefinition>>;

export interface PlannedInvocation {
  readonly collector: ErasedCollector;
  readonly options: unknown;
}

export interface CollectionPlan {
  readonly intent: Intent;
  readonly invocations: readonly PlannedInvocation[];
}

export class PlanConfigError extends Error {
  override readonly name = 'PlanConfigError';
}

/**
 * Turns intent profiles into ready-to-run plans. Every profile is resolved and its options
 * validated up front, so a misconfigured profile fails at start-up, not during a capture.
 */
export class CollectionPlanner {
  private readonly plans: ReadonlyMap<Intent, CollectionPlan>;

  constructor(collectors: readonly ErasedCollector[], profiles: Profiles) {
    const byId = new Map<string, ErasedCollector>();
    for (const collector of collectors) {
      if (byId.has(collector.id))
        throw new PlanConfigError(`Collector "${collector.id}" is registered twice`);
      byId.set(collector.id, collector);
    }

    const plans = new Map<Intent, CollectionPlan>();
    for (const [intent, profile] of Object.entries(profiles) as [Intent, ProfileDefinition][]) {
      plans.set(intent, {
        intent,
        invocations: profile.collectors.map((entry) => resolve(byId, intent, entry)),
      });
    }
    this.plans = plans;
  }

  plan(intent: Intent): CollectionPlan {
    const plan = this.plans.get(intent);
    if (plan === undefined) throw new PlanConfigError(`No profile for intent "${intent}"`);
    return plan;
  }
}

const resolve = (
  byId: ReadonlyMap<string, ErasedCollector>,
  intent: Intent,
  entry: PlanEntry,
): PlannedInvocation => {
  const [id, rawOptions] = typeof entry === 'string' ? [entry, undefined] : entry;
  const collector = byId.get(id);
  if (collector === undefined) {
    throw new PlanConfigError(`Profile "${intent}" uses unknown collector "${id}"`);
  }
  const options = parseWith(collector.optionsSchema, rawOptions);
  if (!options.ok) {
    throw new PlanConfigError(
      `Profile "${intent}" has invalid options for "${id}": ${JSON.stringify(options.error.details)}`,
    );
  }
  return { collector, options: options.value };
};
