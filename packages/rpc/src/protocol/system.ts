/** The service worker itself. */
import * as z from 'zod/mini';
import { defineProtocol } from '../runtime/define';

export const systemMethods = defineProtocol({
  'system.ping': {
    request: z.object({ nonce: z.string().check(z.minLength(1)) }),
    response: z.object({ nonce: z.string(), version: z.string(), receivedAt: z.number() }),
    callers: ['extension'],
  },
});
