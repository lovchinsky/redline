import type { AppProtocol, ProtocolHandlers } from '@redline/rpc';
import type { StartCapture } from './start-capture';

export const createCaptureHandlers = (
  startCapture: StartCapture,
): Pick<ProtocolHandlers<AppProtocol>, 'capture.start'> => ({
  'capture.start': ({ tabId }) => startCapture.execute({ tabId }),
});
