import { describe, expect, it } from 'vitest';
import { receiverRoutes, taskStateResponseSchema } from './receiver-api.v1';

describe('receiver api v1', () => {
  it('parses every remote status phase', () => {
    const statuses = [
      { phase: 'queued' },
      { phase: 'working' },
      { phase: 'needs-input', question: { id: 'q1', text: 'All breakpoints?', options: ['Yes'] } },
      { phase: 'result-ready', resultUrl: 'https://github.com/acme/web/pull/1' },
      { phase: 'failed', reason: 'Could not locate the component' },
      { phase: 'closed' },
    ];
    for (const status of statuses) {
      const parsed = taskStateResponseSchema.safeParse({
        remoteId: 'r1',
        status,
        pollAfterSec: 30,
      });
      expect(parsed.success, JSON.stringify(status)).toBe(true);
    }
  });

  it('rejects unknown phases and non-positive poll intervals', () => {
    expect(
      taskStateResponseSchema.safeParse({
        remoteId: 'r1',
        status: { phase: 'x' },
        pollAfterSec: 30,
      }).success,
    ).toBe(false);
    expect(
      taskStateResponseSchema.safeParse({
        remoteId: 'r1',
        status: { phase: 'queued' },
        pollAfterSec: 0,
      }).success,
    ).toBe(false);
  });

  it('encodes remote ids in routes', () => {
    expect(receiverRoutes.getTask('a/b')).toBe('/v1/tasks/a%2Fb');
    expect(receiverRoutes.replyToTask('r1')).toBe('/v1/tasks/r1/replies');
  });
});
