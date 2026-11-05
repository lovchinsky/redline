import type {
  CaptureContext,
  ImageDerivation,
  ImagePort,
  ShapeSubject,
  StepSubject,
} from '@redline/capture';
import type { AssetId, Logger } from '@redline/core';
import { DocumentDomQuery, EnclosureResolver } from '@redline/dom';
import { boundsOf, roundedLassoPolygon, type Polygon } from '@redline/geometry';

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => silentLogger,
};

export const mount = (html: string, css: string): void => {
  document.head.querySelector('style[data-fixture]')?.remove();
  const style = document.createElement('style');
  style.dataset['fixture'] = '';
  style.textContent = `* { box-sizing: border-box; } body { margin: 0; font: 16px/1.4 sans-serif; } ${css}`;
  document.head.append(style);
  document.body.innerHTML = html;
  window.scrollTo(0, 0);
};

export const get = (selector: string): Element => {
  const element = document.querySelector(selector);
  if (element === null) throw new Error(`Fixture has no element matching ${selector}`);
  return element;
};

/** Rounded lasso 16px around the elements, as people circle things. */
export const lassoAround = (elements: readonly Element[]): Polygon => {
  const bounds = boundsOf(
    elements.flatMap((element) => {
      const r = element.getBoundingClientRect();
      return [
        { x: r.left, y: r.top },
        { x: r.right, y: r.bottom },
      ];
    }),
  );
  if (bounds === null) throw new Error('Nothing to circle');
  return roundedLassoPolygon(bounds, 12);
};

/** Records derivation requests and returns deterministic assets. */
export class FakeImages implements ImagePort {
  readonly requests: ImageDerivation[] = [];

  derive(request: ImageDerivation) {
    this.requests.push(request);
    const n = this.requests.length;
    const width = Math.round(request.area.width * request.devicePixelRatio);
    const height = Math.round(request.area.height * request.devicePixelRatio);
    return Promise.resolve({
      ok: true as const,
      value: {
        asset: { id: `image-${String(n)}` as AssetId, mediaType: request.format, bytes: 1000 },
        width,
        height,
      },
    });
  }
}

export const captureContext = (images: ImagePort = new FakeImages()): CaptureContext => ({
  document,
  dom: new DocumentDomQuery(document),
  page: {
    url: 'https://staging.acme.io/pricing?ref=nav',
    title: 'Pricing — Acme',
    viewport: { width: 1280, height: 800 },
    devicePixelRatio: 2,
    scroll: { x: 0, y: 0 },
    language: 'en',
    colorScheme: 'light',
  },
  images,
  log: silentLogger,
});

export const shapeAround = (id: string, elements: readonly Element[]): ShapeSubject => {
  const polygon = lassoAround(elements);
  const region = new EnclosureResolver(new DocumentDomQuery(document)).resolve(polygon);
  if (region === null) throw new Error('Fixture lasso resolved to nothing');
  return {
    id,
    source: 'lasso',
    polygon,
    region,
    snapshot: {
      asset: { id: 'snapshot-1' as AssetId, mediaType: 'image/png', bytes: 1 },
      scroll: { x: 0, y: 0 },
      viewport: { width: 1280, height: 800 },
      devicePixelRatio: 2,
      sensitiveRects: [],
    },
  };
};

export const stepOf = (comment: string, shapes: readonly ShapeSubject[]): StepSubject => ({
  comment,
  shapes,
});
