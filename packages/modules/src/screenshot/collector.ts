import {
  defineCollector,
  type ImageDerivation,
  type ShapeSubject,
  type ViewportSnapshot,
} from '@redline/capture';
import { boundsOf, inflateRect, intersectRects, type Rect } from '@redline/geometry';
import * as z from 'zod/mini';
import type { ScreenshotData } from './types';

const optionsSchema = z.prefault(
  z.object({
    /** Context kept around the lasso, as a share of its larger side. */
    padding: z._default(z.number().check(z.nonnegative()), 0.15),
    minPadding: z._default(z.number().check(z.nonnegative()), 24),
    /** Longest image side; larger images cost more to read without adding detail. */
    maxSide: z._default(z.int().check(z.positive()), 1568),
  }),
  {},
);
type Options = z.output<typeof optionsSchema>;

const cropArea = (
  shape: ShapeSubject,
  snapshot: ViewportSnapshot,
  options: Options,
): Rect | null => {
  const bounds = boundsOf(shape.polygon);
  if (bounds === null) return null;
  const padding = Math.max(
    options.minPadding,
    Math.max(bounds.width, bounds.height) * options.padding,
  );
  const viewport = { x: 0, y: 0, ...snapshot.viewport };
  return intersectRects(inflateRect(bounds, padding), viewport);
};

/**
 * A crop around the lasso and an overview of the whole viewport, both with the outline
 * drawn in and sensitive fields masked. Derived from the snapshot taken when the shape
 * was drawn, so the overlay never appears in them.
 */
export const screenshotCollector = defineCollector({
  id: 'screenshot',
  produces: 'screenshot',
  level: 'shape',
  priority: 'high',
  optionsSchema,
  collect: async ({ shape, options, context }) => {
    const { snapshot } = shape;
    if (snapshot === null) return { status: 'not-applicable', reason: 'No viewport snapshot' };
    const area = cropArea(shape, snapshot, options);
    if (area === null) {
      return { status: 'not-applicable', reason: 'The shape is outside the viewport' };
    }
    const derive = async (role: 'crop' | 'overview', request: Partial<ImageDerivation>) => {
      const derived = await context.images.derive({
        source: snapshot.asset,
        area,
        outline: shape.polygon,
        smoothOutline: shape.source === 'lasso',
        masks: snapshot.sensitiveRects,
        devicePixelRatio: snapshot.devicePixelRatio,
        format: 'image/png',
        maxSide: options.maxSide,
        ...request,
      });
      if (!derived.ok)
        throw new Error(`Deriving the ${role} image failed: ${derived.error.message}`);
      return { role, ...derived.value };
    };

    const images = await Promise.all([
      derive('crop', {}),
      derive('overview', { area: { x: 0, y: 0, ...snapshot.viewport }, format: 'image/webp' }),
    ]);
    const data: ScreenshotData = {
      images: images.map(({ role, asset, width, height }) => ({
        role,
        assetId: asset.id,
        width,
        height,
      })),
    };
    return { status: 'collected', items: [{ data, assets: images.map((image) => image.asset) }] };
  },
});
