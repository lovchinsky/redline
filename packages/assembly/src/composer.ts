import type { Allocation } from './budget';
import type { PresentedBlock, Presentation } from './presentation';

/** Bundle path of the file that holds blocks the summary budget left out. */
export const MORE_CONTEXT_PATH = 'more-context.md';

const quote = (text: string): string =>
  text
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');

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
  const kept = (blocks: readonly PresentedBlock[]) =>
    blocks.filter((block) => !allocation.overflow.has(block)).map((block) => block.markdown);
  const moved = (blocks: readonly PresentedBlock[]) =>
    blocks.filter((block) => allocation.overflow.has(block)).map((block) => block.markdown);

  const summary: string[] = ['# Redline task'];
  const more: string[] = ['# Redline task · more context'];

  for (const step of presentation.steps) {
    const heading = `## Step ${String(step.index)}`;
    summary.push(heading, quote(step.comment), ...kept(step.blocks));
    const stepMore: string[] = [...moved(step.blocks)];

    for (const area of step.areas) {
      const areaHeading = `### Area ${String(area.index)}`;
      summary.push(areaHeading, ...kept(area.blocks));
      const areaMore = moved(area.blocks);
      if (areaMore.length > 0) stepMore.push(areaHeading, ...areaMore);
    }

    if (stepMore.length > 0) {
      summary.push(
        `_More context for this step is in [${MORE_CONTEXT_PATH}](${MORE_CONTEXT_PATH})._`,
      );
      more.push(heading, ...stepMore);
    }
  }

  const document = (parts: readonly string[]) => `${parts.join('\n\n')}\n`;
  return { summary: document(summary), more: more.length > 1 ? document(more) : null };
};
