import type { Allocation } from './budget';
import {
  MORE_CONTEXT_NOTE,
  SEPARATOR,
  areaHeading,
  quote,
  referenceText,
  stepHeading,
} from './framing';
import type { PresentedBlock, Presentation } from './presentation';

export interface ComposedContext {
  readonly summary: string;
  /** `null` when everything fit into the summary. */
  readonly more: string | null;
}

/**
 * Writes the documents: `context.md` with the blocks the budget kept, and `more-context.md`
 * with the rest under the same step and area headings. Both live at the bundle root, so the
 * links presenters produced resolve from either file.
 */
export const compose = (presentation: Presentation, allocation: Allocation): ComposedContext => {
  /** A pointer names the file its original ended up in; anything else is written as is. */
  const text = (block: PresentedBlock): string =>
    block.reference === undefined
      ? block.markdown
      : referenceText(
          block.reference.title,
          block.reference.label,
          block.reference.originals.some((original) => allocation.overflow.has(original)),
        );
  const kept = (blocks: readonly PresentedBlock[]) =>
    blocks.filter((block) => !allocation.overflow.has(block)).map(text);
  const moved = (blocks: readonly PresentedBlock[]) =>
    blocks.filter((block) => allocation.overflow.has(block)).map(text);

  const summary: string[] = ['# Redline task'];
  const more: string[] = ['# Redline task · more context'];

  for (const step of presentation.steps) {
    const heading = stepHeading(step.index);
    summary.push(heading, quote(step.comment), ...kept(step.blocks));
    const stepMore: string[] = [...moved(step.blocks)];

    for (const area of step.areas) {
      const title = areaHeading(area.index);
      summary.push(title, ...kept(area.blocks));
      const areaMore = moved(area.blocks);
      if (areaMore.length > 0) stepMore.push(title, ...areaMore);
    }

    if (stepMore.length > 0) {
      summary.push(MORE_CONTEXT_NOTE);
      more.push(heading, ...stepMore);
    }
  }

  const document = (parts: readonly string[]) => `${parts.join(SEPARATOR)}\n`;
  return { summary: document(summary), more: more.length > 1 ? document(more) : null };
};
