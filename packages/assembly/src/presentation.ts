import {
  SECTIONS,
  sameTarget,
  type FragmentBase,
  type FragmentCatalog,
  type FragmentReference,
  type FragmentTarget,
  type Intent,
  type Priority,
  type Section,
} from '@redline/core';
import { BundlePaths, type RenderedFile } from './paths';

export interface RenderStep {
  readonly id: string;
  readonly intent: Intent;
  readonly comment: string;
  readonly shapeIds: readonly string[];
  readonly fragments: readonly FragmentBase[];
  /** Fragments folded into an earlier identical one (see the dedupe processor). */
  readonly references: readonly FragmentReference[];
}

export interface RenderInput {
  readonly steps: readonly RenderStep[];
}

/** A Markdown block with the priority of the fragment it came from. */
export interface PresentedBlock {
  readonly section: Section;
  readonly markdown: string;
  readonly priority: Priority;
}

export interface PresentedArea {
  readonly index: number;
  readonly blocks: readonly PresentedBlock[];
}

export interface PresentedStep {
  readonly index: number;
  readonly intent: Intent;
  readonly comment: string;
  /** Step-level blocks (page facts), shown before the areas. */
  readonly blocks: readonly PresentedBlock[];
  readonly areas: readonly PresentedArea[];
}

/** Every fragment turned into ordered blocks, before the budget decides where each goes. */
export interface Presentation {
  readonly steps: readonly PresentedStep[];
  /** Assets and detail files the blocks link to, with their bundle paths. */
  readonly files: readonly RenderedFile[];
  /** Fragments that could not be presented (unknown kinds). */
  readonly warnings: readonly string[];
}

const locationKey = (stepId: string, target: FragmentTarget, kind: string): string =>
  JSON.stringify([stepId, target.level === 'step' ? null : target.shapeId, kind]);

const bySection = <B extends { readonly section: Section }>(blocks: readonly B[]): B[] =>
  blocks
    .map((block, order) => ({ block, order }))
    .sort(
      (a, b) =>
        SECTIONS.indexOf(a.block.section) - SECTIONS.indexOf(b.block.section) || a.order - b.order,
    )
    .map(({ block }) => block);

/**
 * Presentation stage: runs each fragment through the presenter of its kind and assigns bundle
 * paths to the files it links. References render as a one-line pointer in the section where
 * the original appeared, so a reader knows where to look.
 */
export const present = (catalog: FragmentCatalog, input: RenderInput): Presentation => {
  const paths = new BundlePaths();
  const warnings: string[] = [];
  /** Where each fragment was rendered: its label and the first section it produced. */
  const rendered = new Map<string, { readonly label: string; readonly section: Section }>();

  const presentTarget = (
    step: RenderStep,
    stepIndex: number,
    target: FragmentTarget,
    areaIndex: number | null,
  ): PresentedBlock[] => {
    const owner = { stepId: step.id, shapeId: target.level === 'shape' ? target.shapeId : null };
    const scope = paths.scope(stepIndex, areaIndex, owner);
    const label =
      areaIndex === null
        ? `Step ${String(stepIndex)}`
        : `Step ${String(stepIndex)} · Area ${String(areaIndex)}`;
    const blocks: PresentedBlock[] = [];

    for (const fragment of step.fragments.filter((f) => sameTarget(f.target, target))) {
      const descriptor = catalog.get(fragment.kind);
      if (descriptor === undefined) {
        warnings.push(`No presenter for fragment kind "${fragment.kind}"`);
        continue;
      }
      const produced = descriptor.presenter.summarize(fragment, {
        assetPath: scope.asset,
        detailPath: scope.detail,
      });
      for (const file of descriptor.presenter.details?.(fragment) ?? []) scope.detail(file);
      const [first] = bySection(produced);
      if (first !== undefined) {
        rendered.set(locationKey(step.id, target, fragment.kind), {
          label,
          section: first.section,
        });
      }
      blocks.push(...produced.map((block) => ({ ...block, priority: fragment.priority })));
    }

    for (const reference of step.references.filter((r) => sameTarget(r.target, target))) {
      const original = rendered.get(
        locationKey(reference.original.stepId, reference.original.target, reference.kind),
      );
      const title = catalog.get(reference.kind)?.title ?? reference.kind;
      if (original === undefined) {
        warnings.push(`Reference to a fragment that was not rendered: "${reference.kind}"`);
        continue;
      }
      blocks.push({
        section: original.section,
        markdown: `_${title}: same as ${original.label}._`,
        priority: 'critical',
      });
    }
    return bySection(blocks);
  };

  const steps = input.steps.map((step, position): PresentedStep => {
    const index = position + 1;
    return {
      index,
      intent: step.intent,
      comment: step.comment,
      blocks: presentTarget(step, index, { level: 'step' }, null),
      areas: step.shapeIds.map((shapeId, areaPosition) => ({
        index: areaPosition + 1,
        blocks: presentTarget(step, index, { level: 'shape', shapeId }, areaPosition + 1),
      })),
    };
  });

  return { steps, files: paths.all(), warnings };
};
