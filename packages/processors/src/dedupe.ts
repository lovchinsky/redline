import {
  canonicalJson,
  sameTarget,
  targetsInOrder,
  type AnyFragment,
  type FragmentLocation,
  type FragmentReference,
  type TaskProcessor,
} from '@redline/core';

const identity = (fragment: AnyFragment): string =>
  canonicalJson([fragment.kind, fragment.version, fragment.data]);

/**
 * Keeps the first occurrence of every fragment and replaces later identical ones with a
 * reference to it: the same page visited twice, the same component circled in two steps.
 * Fragments with assets are never folded; their images differ even when the data matches.
 */
export const dedupeProcessor: TaskProcessor = {
  id: 'dedupe',
  process(steps) {
    const firstSeen = new Map<string, FragmentLocation>();
    return steps.map((step) => {
      const dropped = new Set<AnyFragment>();
      const references: FragmentReference[] = [];
      for (const target of targetsInOrder(step)) {
        for (const fragment of step.fragments.forTarget(target)) {
          if (fragment.assets.length > 0) continue;
          const key = identity(fragment);
          const original = firstSeen.get(key);
          if (original === undefined) {
            firstSeen.set(key, { stepId: step.id, target });
            continue;
          }
          dropped.add(fragment);
          // An exact repeat in the same place carries nothing worth pointing at.
          if (original.stepId !== step.id || !sameTarget(original.target, target)) {
            references.push({ kind: fragment.kind, target, original });
          }
        }
      }
      return dropped.size === 0
        ? step
        : {
            ...step,
            fragments: step.fragments.filter((fragment) => !dropped.has(fragment)),
            references: [...step.references, ...references],
          };
    });
  },
};
