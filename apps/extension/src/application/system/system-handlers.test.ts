import { describe, expect, it } from 'vitest';
import { createSystemHandlers } from './system-handlers';

describe('system.ping', () => {
  it('echoes the nonce with the version and the time it arrived', async () => {
    const handlers = createSystemHandlers({ clock: { now: () => 123 }, version: '0.1.0' });
    const result = await handlers['system.ping']({ nonce: 'n1' }, { kind: 'extension' });
    expect(result).toEqual({ ok: true, value: { nonce: 'n1', version: '0.1.0', receivedAt: 123 } });
  });
});
