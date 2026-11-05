import { PRIORITIES, SECTIONS, type Intent } from '@redline/core';
import type { PresentedBlock, Presentation, PresentedStep } from './presentation';

/** Estimates how many model tokens a text costs. */
export interface TokenEstimator {
  estimate(text: string): number;
}

/** About four characters per token for English prose and code; good enough for budgeting. */
export const approximateTokens: TokenEstimator = {
  estimate: (text) => Math.ceil(text.length / 4),
};

/** How many tokens a step's summary in `context.md` may take. */
export interface BudgetPolicy {
  summaryTokens(intent: Intent): number;
}

export const UNLIMITED_BUDGET: BudgetPolicy = { summaryTokens: () => Number.POSITIVE_INFINITY };

/** Blocks that did not fit their step's budget; they move to `more-context.md`. */
export interface Allocation {
  readonly overflow: ReadonlySet<PresentedBlock>;
}

const blocksOf = (step: PresentedStep): PresentedBlock[] => [
  ...step.blocks,
  ...step.areas.flatMap((area) => area.blocks),
];

/**
 * Decides which blocks stay in the summary. Per step: the header, the user's comment and
 * critical blocks always stay; the rest are admitted by priority, then section, then document
 * order, while they fit. Steps have separate budgets so one large step cannot crowd out another.
 */
export const allocate = (
  presentation: Presentation,
  policy: BudgetPolicy,
  estimator: TokenEstimator,
): Allocation => {
  const overflow = new Set<PresentedBlock>();
  for (const step of presentation.steps) {
    const blocks = blocksOf(step);
    const cost = (block: PresentedBlock) => estimator.estimate(block.markdown);
    let spent =
      estimator.estimate(step.comment) +
      blocks.filter((block) => block.priority === 'critical').reduce((sum, b) => sum + cost(b), 0);

    const optional = blocks
      .map((block, position) => ({ block, position }))
      .filter(({ block }) => block.priority !== 'critical')
      .sort(
        (a, b) =>
          PRIORITIES.indexOf(a.block.priority) - PRIORITIES.indexOf(b.block.priority) ||
          SECTIONS.indexOf(a.block.section) - SECTIONS.indexOf(b.block.section) ||
          a.position - b.position,
      );
    const budget = policy.summaryTokens(step.intent);
    for (const { block } of optional) {
      const blockCost = cost(block);
      if (spent + blockCost <= budget) spent += blockCost;
      else overflow.add(block);
    }
  }
  return { overflow };
};
