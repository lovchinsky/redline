import { CaptureEngine, CollectionPlanner } from '@redline/capture';
import { FragmentCatalog } from '@redline/core';
import { profiles } from '@redline/profiles';
import { MarkdownContextRenderer } from '@redline/render';
import { describe, expect, it } from 'vitest';
import { collectors } from './collectors';
import { fragmentDescriptors } from './descriptors';
import { FakeImages, captureContext, get, shapeAround, stepOf } from './testing/harness';
import { mountPricing } from './testing/pricing';

const catalog = new FragmentCatalog(fragmentDescriptors);
const planner = new CollectionPlanner(collectors, profiles);
const engine = new CaptureEngine(catalog, [], { defaultTimeoutMs: 2000 }, { now: () => 0 });
const renderer = new MarkdownContextRenderer(catalog);

describe('context.md, end to end (golden)', () => {
  it('pricing cards circled for a layout change', async () => {
    mountPricing();
    const cards = Array.from(document.querySelectorAll('[data-testid="plan-card"]'));
    const step = stepOf('layout', 'Make the three plan cards equal height', [
      shapeAround('shape-1', cards),
    ]);

    const capture = await engine.run(planner.plan('layout'), step, captureContext());
    const rendered = renderer.render({
      steps: [
        {
          id: 'step-1',
          intent: step.intent,
          comment: step.comment,
          shapeIds: ['shape-1'],
          fragments: capture.fragments,
        },
      ],
    });

    expect(capture.diagnostics).toEqual([]);
    await expect(rendered.markdown).toMatchFileSnapshot('./__golden__/pricing-layout.md');
    expect(rendered.files.find((file) => file.path.endsWith('dom.html'))?.content).toMatchObject({
      kind: 'text',
    });
  });

  it('a single card circled to change its text', async () => {
    mountPricing();
    const images = new FakeImages();
    const step = stepOf('text', 'Rename "Most popular" to "Best value"', [
      shapeAround('shape-1', [get('.badge')]),
    ]);

    const capture = await engine.run(planner.plan('text'), step, captureContext(images));
    const rendered = renderer.render({
      steps: [
        {
          id: 'step-1',
          intent: step.intent,
          comment: step.comment,
          shapeIds: ['shape-1'],
          fragments: capture.fragments,
        },
      ],
    });

    expect(capture.diagnostics).toEqual([]);
    expect(images.requests.map((request) => request.format)).toEqual(['image/png', 'image/webp']);
    await expect(rendered.markdown).toMatchFileSnapshot('./__golden__/badge-text.md');
  });
});
