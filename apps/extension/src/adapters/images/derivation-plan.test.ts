import { describe, expect, it } from 'vitest';
import type { ImageDerivationRequest } from '@redline/rpc';
import { planDerivation } from './derivation-plan';

const request = (overrides: Partial<ImageDerivationRequest> = {}): ImageDerivationRequest => ({
  source: { id: 'a' as never, mediaType: 'image/png', bytes: 1 },
  area: { x: 100, y: 50, width: 400, height: 200 },
  outline: [],
  smoothOutline: true,
  masks: [],
  devicePixelRatio: 2,
  format: 'image/png',
  maxSide: 2000,
  ...overrides,
});

describe('planDerivation', () => {
  it('maps CSS pixels to image pixels with the device pixel ratio', () => {
    const plan = planDerivation(request(), { width: 2560, height: 1600 });
    expect(plan?.source).toEqual({ x: 200, y: 100, width: 800, height: 400 });
    expect(plan?.output).toEqual({ width: 800, height: 400 });
    expect(plan?.toOutput({ x: 100, y: 50 })).toEqual({ x: 0, y: 0 });
    expect(plan?.toOutput({ x: 300, y: 150 })).toEqual({ x: 400, y: 200 });
  });

  it('downscales to the longest side limit', () => {
    const plan = planDerivation(request({ maxSide: 400 }), { width: 2560, height: 1600 });
    expect(plan?.output).toEqual({ width: 400, height: 200 });
    expect(plan?.toOutput({ x: 500, y: 250 })).toEqual({ x: 400, y: 200 });
  });

  it('clamps to the image and rejects empty areas', () => {
    expect(
      planDerivation(request({ area: { x: 1200, y: 700, width: 400, height: 400 } }), {
        width: 2560,
        height: 1600,
      })?.source,
    ).toEqual({ x: 2400, y: 1400, width: 160, height: 200 });
    expect(
      planDerivation(request({ area: { x: 2000, y: 0, width: 10, height: 10 } }), {
        width: 2560,
        height: 1600,
      }),
    ).toBeNull();
  });
});
