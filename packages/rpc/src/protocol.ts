import * as z from 'zod/mini';
import { defineEvents, defineProtocol } from './runtime/define';

/** Every request the service worker serves. Single source of truth for all contexts. */
export const protocol = defineProtocol({
  'system.ping': {
    request: z.object({ nonce: z.string().check(z.minLength(1)) }),
    response: z.object({ nonce: z.string(), version: z.string(), receivedAt: z.number() }),
  },
});

/** Every event the service worker broadcasts to UI contexts. */
export const events = defineEvents({
  'system.pinged': z.object({ nonce: z.string(), at: z.number() }),
});

export type AppProtocol = typeof protocol;
export type AppEvents = typeof events;
