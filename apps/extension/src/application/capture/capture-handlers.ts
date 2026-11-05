import type { AppProtocol, ProtocolHandlers } from '@redline/rpc';
import type { CommitStep, DeriveImage, TakeSnapshot } from './capture-assets';
import type { StartCapture } from './start-capture';

export interface CaptureUseCases {
  readonly startCapture: StartCapture;
  readonly takeSnapshot: TakeSnapshot;
  readonly deriveImage: DeriveImage;
  readonly commitStep: CommitStep;
}

export const createCaptureHandlers = ({
  startCapture,
  takeSnapshot,
  deriveImage,
  commitStep,
}: CaptureUseCases): Pick<
  ProtocolHandlers<AppProtocol>,
  'capture.start' | 'capture.snapshot' | 'capture.deriveImage' | 'capture.commitStep'
> => ({
  'capture.start': ({ tabId }) => startCapture.execute({ tabId }),
  'capture.snapshot': (_, caller) => takeSnapshot.execute(caller),
  'capture.deriveImage': (request) => deriveImage.execute(request),
  'capture.commitStep': ({ step, capture }) => commitStep.execute(step, capture),
});
