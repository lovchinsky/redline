/**
 * Runs in the page under evaluation: resolves a lasso around a rectangle the way the overlay
 * does, then runs the shipped capture, narrowed to the anchors.
 */
import type { CaptureContext } from '@redline/capture';
import { FragmentSet, type Logger } from '@redline/core';
import { DocumentDomQuery, EnclosureResolver, summarizeRegion } from '@redline/dom';
import { roundedLassoPolygon, type Rect } from '@redline/geometry';
import { shippedCapture } from '@redline/pipeline';
import type { HarnessApi, HarnessResult } from './api';

const silent: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silent,
};

// The shipped capture, redaction included, measuring only the anchors.
const { plan, engine } = shippedCapture(
  { now: () => performance.now() },
  (collector) => collector === 'anchors',
);
const dom = new DocumentDomQuery(document);
const resolver = new EnclosureResolver(dom);

const context = (): CaptureContext => ({
  document,
  dom,
  page: {
    url: location.href,
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight },
    devicePixelRatio,
    scroll: { x: scrollX, y: scrollY },
    language: document.documentElement.lang || null,
    colorScheme: 'light',
  },
  images: { derive: () => Promise.reject(new Error('No images in evaluation')) },
  pageRuntime: {
    componentTrace: () => Promise.resolve({ ok: true, value: null }),
    runtimeReport: () =>
      Promise.resolve({
        ok: true,
        value: { observedSince: 'capture-start', errors: [], failedRequests: [] },
      }),
  },
  log: silent,
});

const anchorsAround = async (rect: Rect): Promise<HarnessResult> => {
  // The way people circle things: a rounded lasso a little outside the element.
  const polygon = roundedLassoPolygon(
    { x: rect.x - 12, y: rect.y - 12, width: rect.width + 24, height: rect.height + 24 },
    12,
  );
  const region = resolver.resolve(polygon);
  if (region === null) return { region: null, anchors: [] };
  const { capture } = await engine.run(
    plan,
    {
      comment: 'evaluation',
      shapes: [
        {
          id: 'shape',
          source: 'lasso',
          polygon,
          region,
          snapshot: null,
        },
      ],
    },
    context(),
  );
  const [fragment] = FragmentSet.fromCapture(capture).ofKind('anchors');
  return {
    region: summarizeRegion(region),
    anchors: (fragment?.data.anchors ?? []).map(({ kind, value, score }) => ({
      kind,
      value,
      score,
    })),
  };
};

const api: HarnessApi = { anchorsAround };
Object.assign(window, { redlineEval: api });
