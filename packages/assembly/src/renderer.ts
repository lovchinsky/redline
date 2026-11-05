import type { FragmentCatalog } from '@redline/core';
import { allocate, approximateTokens, type BudgetPolicy, type TokenEstimator } from './budget';
import { compose } from './composer';
import { MORE_CONTEXT_PATH } from './framing';
import type { RenderedFile } from './paths';
import { present, type RenderInput } from './presentation';

export interface RenderedContext {
  /** `context.md`. */
  readonly markdown: string;
  /** Every other file of the bundle: assets, detail files and `more-context.md`. */
  readonly files: readonly RenderedFile[];
  /** Fragments that could not be rendered (unknown kinds, dangling references). */
  readonly warnings: readonly string[];
}

export interface RendererOptions {
  readonly budget: BudgetPolicy;
  readonly estimator?: TokenEstimator;
}

/**
 * Renders steps into Markdown in three stages: present (fragments → ordered blocks),
 * allocate (budget decides which blocks stay in the summary), compose (write documents).
 */
export class MarkdownContextRenderer {
  constructor(
    private readonly catalog: FragmentCatalog,
    private readonly options: RendererOptions,
  ) {}

  render(input: RenderInput): RenderedContext {
    const presentation = present(this.catalog, input);
    const allocation = allocate(
      presentation,
      this.options.budget,
      this.options.estimator ?? approximateTokens,
    );
    const { summary, more } = compose(presentation, allocation);
    const files: RenderedFile[] = [...presentation.files];
    if (more !== null) {
      files.push({
        path: MORE_CONTEXT_PATH,
        mediaType: 'text/markdown',
        content: { kind: 'text', text: more },
        owner: null,
      });
    }
    return { markdown: summary, files, warnings: presentation.warnings };
  }
}
