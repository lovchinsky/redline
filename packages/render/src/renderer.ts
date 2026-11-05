import {
  SECTIONS,
  sameTarget,
  type FragmentBase,
  type FragmentCatalog,
  type FragmentTarget,
  type Intent,
  type MarkdownBlock,
} from '@redline/core';
import { BundlePaths, type RenderedFile } from './paths';

export interface RenderStep {
  readonly id: string;
  readonly intent: Intent;
  readonly comment: string;
  readonly shapeIds: readonly string[];
  readonly fragments: readonly FragmentBase[];
}

export interface RenderInput {
  readonly steps: readonly RenderStep[];
}

export interface RenderedContext {
  readonly markdown: string;
  /** Assets and detail files referenced from the Markdown, with their bundle paths. */
  readonly files: readonly RenderedFile[];
  /** Fragments that could not be rendered (unknown kinds). */
  readonly warnings: readonly string[];
}

const INTENT_TITLES: Readonly<Record<Intent, string>> = {
  text: 'Text',
  style: 'Style',
  layout: 'Layout',
  bug: 'Bug',
  'new-element': 'New element',
};

const quote = (text: string): string =>
  text
    .split('\n')
    .map((line) => `> ${line}`.trimEnd())
    .join('\n');

/**
 * Renders steps into `context.md`: the step's comment, then page facts, then one section per
 * circled area. Fragment kinds render through their own presenters; sections keep a fixed
 * order so the document reads the same regardless of collection order.
 */
export class MarkdownContextRenderer {
  constructor(private readonly catalog: FragmentCatalog) {}

  render(input: RenderInput): RenderedContext {
    const paths = new BundlePaths();
    const warnings: string[] = [];
    const parts: string[] = ['# Redline task'];

    input.steps.forEach((step, stepPosition) => {
      const stepIndex = stepPosition + 1;
      parts.push(
        `## Step ${String(stepIndex)} · ${INTENT_TITLES[step.intent]}`,
        quote(step.comment),
      );

      const stepScope = paths.scope(stepIndex, null, { stepId: step.id, shapeId: null });
      parts.push(...this.blocks(step.fragments, { level: 'step' }, stepScope, warnings));

      step.shapeIds.forEach((shapeId, areaPosition) => {
        const areaIndex = areaPosition + 1;
        const scope = paths.scope(stepIndex, areaIndex, { stepId: step.id, shapeId });
        parts.push(`### Area ${String(areaIndex)}`);
        parts.push(...this.blocks(step.fragments, { level: 'shape', shapeId }, scope, warnings));
      });
    });

    return { markdown: `${parts.join('\n\n')}\n`, files: paths.all(), warnings };
  }

  private blocks(
    fragments: readonly FragmentBase[],
    target: FragmentTarget,
    scope: ReturnType<BundlePaths['scope']>,
    warnings: string[],
  ): string[] {
    const blocks: MarkdownBlock[] = [];
    for (const fragment of fragments.filter((f) => sameTarget(f.target, target))) {
      const descriptor = this.catalog.get(fragment.kind);
      if (descriptor === undefined) {
        warnings.push(`No presenter for fragment kind "${fragment.kind}"`);
        continue;
      }
      blocks.push(
        ...descriptor.presenter.summarize(fragment, {
          assetPath: scope.asset,
          detailPath: scope.detail,
        }),
      );
      for (const file of descriptor.presenter.details?.(fragment) ?? []) scope.detail(file);
    }
    return blocks
      .map((block, order) => ({ block, order }))
      .sort(
        (a, b) =>
          SECTIONS.indexOf(a.block.section) - SECTIONS.indexOf(b.block.section) ||
          a.order - b.order,
      )
      .map(({ block }) => block.markdown);
  }
}
