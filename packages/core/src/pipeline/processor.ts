import type { FragmentSet } from './fragment-set';

/**
 * One stage of fragment post-processing (redaction, grouping, budgeting…).
 * Pure with respect to its input: returns a new set instead of mutating.
 */
export interface FragmentProcessor<Context> {
  readonly id: string;
  process(set: FragmentSet, context: Context): Promise<FragmentSet> | FragmentSet;
}

/** Runs processors in order, each receiving the previous one's output. */
export const runProcessors = async <Context>(
  processors: readonly FragmentProcessor<Context>[],
  set: FragmentSet,
  context: Context,
): Promise<FragmentSet> => {
  let current = set;
  for (const processor of processors) current = await processor.process(current, context);
  return current;
};
