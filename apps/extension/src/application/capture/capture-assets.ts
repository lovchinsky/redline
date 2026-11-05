import {
  appError,
  err,
  ok,
  type AppError,
  type AssetRef,
  type AssetStore,
  type FragmentCatalog,
  type IdGenerator,
  type Clock,
  type Logger,
  type Result,
} from '@redline/core';
import type {
  AppEvents,
  CallerInfo,
  EventPublisher,
  ImageDerivationRequest,
  StepRecord,
} from '@redline/rpc';
import type {
  CaptureRepository,
  CapturedImage,
  ImageDeriver,
  ViewportCapturer,
} from '../../ports/capture';

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

/** Screenshots the calling tab's viewport. Only a content script in a tab may ask. */
export class TakeSnapshot {
  constructor(
    private readonly capturer: ViewportCapturer,
    private readonly assets: AssetStore,
  ) {}

  async execute(caller: CallerInfo): Promise<Result<StoredImage, AppError>> {
    if (caller.tabId === undefined) {
      return err(appError('validation', 'Snapshots can only be requested from a tab'));
    }
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

export interface CommitStepDeps {
  readonly catalog: FragmentCatalog;
  readonly repository: CaptureRepository;
  readonly events: EventPublisher<AppEvents>;
  readonly ids: IdGenerator;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * Stores a captured step. Every fragment is re-validated here against the schema of its kind:
 * the content script runs in a web page, so its output is checked before it is trusted.
 */
export class CommitStep {
  constructor(private readonly deps: CommitStepDeps) {}

  async execute(
    step: StepRecord,
    rawCapture: unknown,
  ): Promise<Result<{ captureId: string }, AppError>> {
    const capture = this.deps.catalog.parseCapture(rawCapture);
    if (!capture.ok) return capture;
    for (const diagnostic of capture.value.diagnostics) {
      this.deps.logger.warn('Collector diagnostic', { ...diagnostic });
    }

    const captureId = this.deps.ids.next();
    const saved = await this.deps.repository.put({
      id: captureId,
      createdAt: this.deps.clock.now(),
      step,
      capture: capture.value,
    });
    if (!saved.ok) return saved;

    const published = this.deps.events.publish('step.captured', { captureId });
    if (!published.ok)
      this.deps.logger.error('Could not publish step.captured', { ...published.error });
    return ok({ captureId });
  }
}
