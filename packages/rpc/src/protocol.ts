import * as z from 'zod/mini';
import { defineEvents, defineProtocol } from './runtime/define';

export const captureStartResponseSchema = z.object({
  status: z.enum(['started', 'already-active']),
});
export type CaptureStartResponse = z.infer<typeof captureStartResponseSchema>;

/** Every request the service worker serves. Single source of truth for all contexts. */
export const protocol = defineProtocol({
  'system.ping': {
    request: z.object({ nonce: z.string().check(z.minLength(1)) }),
    response: z.object({ nonce: z.string(), version: z.string(), receivedAt: z.number() }),
  },
  /** Starts capture in a tab the extension may access (activeTab grant or host permission). */
  'capture.start': {
    request: z.object({ tabId: z.int().check(z.nonnegative()) }),
    response: captureStartResponseSchema,
  },
});

/** Every request a tab's content script serves. Sent by the service worker. */
export const tabProtocol = defineProtocol({
  'capture.start': {
    request: z.object({}),
    response: captureStartResponseSchema,
  },
});

/** Every event the service worker broadcasts to UI contexts. */
export const events = defineEvents({
  'system.pinged': z.object({ nonce: z.string(), at: z.number() }),
});

export type AppProtocol = typeof protocol;
export type AppEvents = typeof events;
export type TabProtocol = typeof tabProtocol;
