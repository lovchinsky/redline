import { ok, type AppError, type AssetRef, type AssetStore, type Result } from '@redline/core';
import type { ContentScriptCaller, ImageDerivationRequest } from '@redline/rpc';
import type { CapturedImage, ImageDeriver, ViewportCapturer } from '../../ports/capture';

export interface StoredImage {
  readonly asset: AssetRef;
  readonly width: number;
  readonly height: number;
}

const store = async (
  assets: AssetStore,
  image: Result<CapturedImage, AppError>,
): Promise<Result<StoredImage, AppError>> => {
  if (!image.ok) return image;
  const asset = await assets.put(image.value.blob);
  return asset.ok
    ? ok({ asset: asset.value, width: image.value.width, height: image.value.height })
    : asset;
};

/** Screenshots the calling tab's viewport. */
export class TakeSnapshot {
  constructor(
    private readonly capturer: ViewportCapturer,
    private readonly assets: AssetStore,
  ) {}

  async execute(caller: ContentScriptCaller): Promise<Result<StoredImage, AppError>> {
    return store(this.assets, await this.capturer.capture(caller.tabId));
  }
}

/** Derives a crop or overview from a stored snapshot. */
export class DeriveImage {
  constructor(
    private readonly deriver: ImageDeriver,
    private readonly assets: AssetStore,
  ) {}

  async execute(request: ImageDerivationRequest): Promise<Result<StoredImage, AppError>> {
    const source = await this.assets.get(request.source.id);
    if (!source.ok) return source;
    return store(this.assets, await this.deriver.derive(source.value, request));
  }
}
