import {
  AssemblyEngine,
  MarkdownContextRenderer,
  Packager,
  UNLIMITED_BUDGET,
  type RenderStep,
} from '@redline/assembly';
import { CaptureEngine, buildCollectionPlan, type StepSubject } from '@redline/capture';
import {
  CaptureId,
  FragmentCatalog,
  StepId,
  TaskId,
  addStep,
  createDraft,
  ok,
  type StepCapture,
  type Task,
} from '@redline/core';
import { dedupeProcessor } from '@redline/processors';
import { SUMMARY_TOKENS_PER_STEP, captureProfile } from '@redline/profiles';
import { describe, expect, it } from 'vitest';
import { collectors } from './collectors';
import { fragmentDescriptors } from './descriptors';
import { FakeImages, captureContext, get, shapeAround, stepOf } from './testing/harness';
import { mountPricing } from './testing/pricing';

const catalog = new FragmentCatalog(fragmentDescriptors);
const plan = buildCollectionPlan(collectors, captureProfile);
const engine = new CaptureEngine(catalog, [], { defaultTimeoutMs: 2000 }, { now: () => 0 });
const renderer = new MarkdownContextRenderer(catalog, { budget: UNLIMITED_BUDGET });

const renderStep = (step: StepSubject, capture: StepCapture): RenderStep => ({
  id: 'step-1',
  comment: step.comment,
  shapeIds: step.shapes.map((shape) => shape.id),
  fragments: capture.fragments,
  references: [],
});

describe('context.md, end to end (golden)', () => {
  it('pricing cards circled for a layout change', async () => {
    mountPricing();
    const cards = Array.from(document.querySelectorAll('[data-testid="plan-card"]'));
    const step = stepOf('Make the three plan cards equal height', [shapeAround('shape-1', cards)]);

    const capture = await engine.run(plan, step, captureContext());
    const rendered = renderer.render({ steps: [renderStep(step, capture)] });

    expect(capture.diagnostics).toEqual([]);
    await expect(rendered.markdown).toMatchFileSnapshot('./__golden__/pricing-layout.md');
    expect(rendered.files.find((file) => file.path.endsWith('dom.html'))?.content).toMatchObject({
      kind: 'text',
    });
  });

  it('a single card circled to change its text', async () => {
    mountPricing();
    const images = new FakeImages();
    const step = stepOf('Rename "Most popular" to "Best value"', [
      shapeAround('shape-1', [get('.badge')]),
    ]);

    const capture = await engine.run(plan, step, captureContext(images));
    const rendered = renderer.render({ steps: [renderStep(step, capture)] });

    expect(capture.diagnostics).toEqual([]);
    expect(images.requests.map((request) => request.format)).toEqual(['image/png', 'image/webp']);
    await expect(rendered.markdown).toMatchFileSnapshot('./__golden__/badge-text.md');
  });

  it('a two-step task on one page, assembled with dedupe and budgets', async () => {
    mountPricing();
    const images = new FakeImages();
    const cards = Array.from(document.querySelectorAll('[data-testid="plan-card"]'));
    const subjects = [
      stepOf('Make the three plan cards equal height', [shapeAround('a', cards)]),
      stepOf('Rename "Most popular" to "Best value"', [shapeAround('b', [get('.badge')])]),
    ];

    let task: Task = createDraft(TaskId.parse('task-1'), 0);
    const captures = new Map<string, StepCapture>();
    for (const [index, subject] of subjects.entries()) {
      const captureId = CaptureId.parse(`capture-${String(index + 1)}`);
      captures.set(captureId, await engine.run(plan, subject, captureContext(images)));
      const added = addStep(
        task,
        {
          id: StepId.parse(`step-${String(index + 1)}`),
          page: {
            url: 'https://staging.acme.io/pricing?ref=nav',
            routePattern: '/pricing',
            title: 'Pricing — Acme',
          },
          viewport: { width: 1280, height: 800, devicePixelRatio: 2, scrollX: 0, scrollY: 0 },
          comment: subject.comment,
          shapeIds: subject.shapes.map((shape) => shape.id),
          captureId,
          capturedAt: index,
        },
        index + 1,
      );
      if (!added.ok) throw new Error(added.error.message);
      task = added.value;
    }

    const assembly = new AssemblyEngine({
      processors: [dedupeProcessor],
      renderer: new MarkdownContextRenderer(catalog, {
        budget: { summaryTokensPerStep: SUMMARY_TOKENS_PER_STEP },
      }),
      packager: new Packager({ get: () => Promise.resolve(ok(new Blob(['img']))) }),
    });
    const bundle = await assembly.assemble({
      task,
      captures,
      createdAt: '2026-11-05T10:00:00.000Z',
      clientVersion: '0.1.0',
    });
    if (!bundle.ok) throw new Error(bundle.error.message);

    const context = await bundle.value.bundle.files.get('context.md')?.text();
    await expect(context).toMatchFileSnapshot('./__golden__/two-steps-task.md');
    expect(bundle.value.bundle.manifest.steps.map((step) => step.id)).toEqual(['step-1', 'step-2']);
  });
});
