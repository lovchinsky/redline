/**
 * The text the summary puts around the blocks: step and area headings, the quoted comment,
 * the note about `more-context.md`, and the blank lines between them. The composer writes
 * it and the budget counts it from here, so the two cannot drift apart.
 */

/** Bundle path of the file that holds blocks the summary budget left out. */
export const MORE_CONTEXT_PATH = 'more-context.md';

/** Between two parts of a document. */
export const SEPARATOR = '\n\n';

export const stepHeading = (index: number): string => `## Step ${String(index)}`;
export const areaHeading = (index: number): string => `### Area ${String(index)}`;
export const MORE_CONTEXT_NOTE = `_More context for this step is in [${MORE_CONTEXT_PATH}](${MORE_CONTEXT_PATH})._`;

/** A fragment folded into an identical earlier one; where to find that one, once known. */
export const referenceText = (title: string, label: string, moved: boolean): string =>
  moved
    ? `_${title}: same as ${label}, in [${MORE_CONTEXT_PATH}](${MORE_CONTEXT_PATH})._`
    : `_${title}: same as ${label}._`;

export const quote = (text: string): string =>
  text
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');

/**
 * Every part the summary adds for a step besides its blocks. The note about more context is
 * included as if needed: whether it is needed is what the budget is deciding.
 */
export const stepFrame = (step: {
  readonly index: number;
  readonly comment: string;
  readonly areas: readonly { readonly index: number }[];
}): string[] => [
  stepHeading(step.index),
  quote(step.comment),
  ...step.areas.map((area) => areaHeading(area.index)),
  MORE_CONTEXT_NOTE,
];
