import { startMockReceiver } from '@redline/mock-receiver';
import { describeConformance } from './suite';

describeConformance(
  'the mock receiver',
  async () => {
    const mock = await startMockReceiver({ token: 'conformance-token' });
    return {
      url: mock.url,
      token: 'conformance-token',
      projectId: 'acme-web',
      stop: () => mock.close(),
    };
  },
  { progressTimeoutMs: 5_000 },
);
