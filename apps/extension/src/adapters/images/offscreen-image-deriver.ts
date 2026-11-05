import { appError, err, ok, toAppError } from '@redline/core';
import { catmullRomPath, type Point } from '@redline/geometry';
import type { ImageDerivationRequest } from '@redline/rpc';
import type { ImageDeriver } from '../../ports/capture';
import { planDerivation, type DerivationPlan } from './derivation-plan';

const OUTLINE = '#ff2d55';
const OUTLINE_HALO = 'rgb(255 255 255 / 0.9)';
const MASK = '#6b7280';
const QUALITY = 0.9;

const tracePath = (points: readonly Point[], smooth: boolean): Path2D => {
  const path = new Path2D();
  const bezier = smooth ? catmullRomPath(points, true) : null;
  if (bezier !== null) {
    path.moveTo(bezier.start.x, bezier.start.y);
    for (const { control1, control2, end } of bezier.segments) {
      path.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
    }
  } else {
    points.forEach((point, index) => {
      if (index === 0) path.moveTo(point.x, point.y);
      else path.lineTo(point.x, point.y);
    });
  }
  path.closePath();
  return path;
};

const draw = (
  context: OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap,
  plan: DerivationPlan,
  request: ImageDerivationRequest,
): void => {
  const { source, output } = plan;
  context.drawImage(
    bitmap,
    source.x,
    source.y,
    source.width,
    source.height,
    0,
    0,
    output.width,
    output.height,
  );

  context.fillStyle = MASK;
  for (const mask of request.masks) {
    const topLeft = plan.toOutput(mask);
    context.fillRect(topLeft.x, topLeft.y, mask.width * plan.scale, mask.height * plan.scale);
  }

  if (request.outline.length >= 3) {
    const path = tracePath(request.outline.map(plan.toOutput), request.smoothOutline);
    const width = Math.max(2, 1.5 * plan.scale);
    context.lineJoin = 'round';
    context.strokeStyle = OUTLINE_HALO;
    context.lineWidth = width + 3;
    context.stroke(path);
    context.strokeStyle = OUTLINE;
    context.lineWidth = width;
    context.stroke(path);
  }
};

/** Renders derived images in the service worker with OffscreenCanvas. */
export const offscreenImageDeriver: ImageDeriver = {
  async derive(sourceBlob, request) {
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await createImageBitmap(sourceBlob);
      const plan = planDerivation(request, { width: bitmap.width, height: bitmap.height });
      if (plan === null)
        return err(appError('validation', 'The requested area is outside the image'));
      const canvas = new OffscreenCanvas(plan.output.width, plan.output.height);
      const context = canvas.getContext('2d');
      if (context === null) return err(appError('internal', '2D canvas is not available'));
      draw(context, bitmap, plan, request);
      const blob = await canvas.convertToBlob({ type: request.format, quality: QUALITY });
      return ok({ blob, width: plan.output.width, height: plan.output.height });
    } catch (cause) {
      return err(toAppError(cause, 'internal'));
    } finally {
      bitmap?.close();
    }
  },
};
