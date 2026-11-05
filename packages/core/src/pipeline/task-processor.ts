import type { FragmentTarget } from './fragment';
import type { FragmentSet } from './fragment-set';

/** Where a fragment sits in a task. */
export interface FragmentLocation {
  readonly stepId: string;
  readonly target: FragmentTarget;
}

/** Stands in for a fragment that was dropped because the same one appears earlier in the task. */
export interface FragmentReference {
  readonly kind: string;
  readonly target: FragmentTarget;
  readonly original: FragmentLocation;
}

/** One step's context as it moves through assembly. */
export interface AssemblyStep {
  readonly id: string;
  /** Circled areas in the order they were drawn; defines document order within the step. */
  readonly shapeIds: readonly string[];
  readonly fragments: FragmentSet;
  readonly references: readonly FragmentReference[];
}

/**
 * A stage of assembly that needs the whole task at once (deduplication across steps…).
 * Pure: returns new steps instead of mutating its input.
 */
export interface TaskProcessor {
  readonly id: string;
  process(steps: readonly AssemblyStep[]): readonly AssemblyStep[];
}

/** Targets of a step in document order: the step itself, then its areas as drawn. */
export const targetsInOrder = (step: Pick<AssemblyStep, 'shapeIds'>): FragmentTarget[] => [
  { level: 'step' },
  ...step.shapeIds.map((shapeId) => ({ level: 'shape' as const, shapeId })),
];

export const runTaskProcessors = (
  processors: readonly TaskProcessor[],
  steps: readonly AssemblyStep[],
): readonly AssemblyStep[] =>
  processors.reduce<readonly AssemblyStep[]>(
    (current, processor) => processor.process(current),
    steps,
  );
