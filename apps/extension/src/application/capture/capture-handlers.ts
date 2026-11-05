import type { AppProtocol, ProtocolHandlers } from '@redline/rpc';
import type { CommitStep } from '../drafts/commit-step';
import type { DeriveImage, TakeSnapshot } from './capture-assets';
import type { InjectPageRuntime } from './page-runtime';
import type { StartCapture } from './start-capture';

export interface CaptureUseCases {
  readonly startCapture: StartCapture;
  readonly takeSnapshot: TakeSnapshot;
  readonly deriveImage: DeriveImage;
  readonly commitStep: CommitStep;
  readonly injectPageRuntime: InjectPageRuntime;
}

export const createCaptureHandlers = ({
  startCapture,
  takeSnapshot,
  deriveImage,
  commitStep,
  injectPageRuntime,
}: CaptureUseCases): Pick<
  ProtocolHandlers<AppProtocol>,
  | 'capture.start'
  | 'capture.snapshot'
  | 'capture.deriveImage'
  | 'capture.commitStep'
  | 'capture.injectPageRuntime'
> => ({
  'capture.start': ({ tabId }) => startCapture.execute({ tabId }),
  'capture.snapshot': (_, caller) => takeSnapshot.execute(caller),
  'capture.deriveImage': (request) => deriveImage.execute(request),
  'capture.commitStep': ({ step, capture }) => commitStep.execute(step, capture),
  'capture.injectPageRuntime': (_, caller) => injectPageRuntime.execute(caller),
});
