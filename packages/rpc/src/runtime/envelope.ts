import { appErrorSchema } from '@redline/core';
import * as z from 'zod/mini';

export const REQUEST_TYPE = 'redline.rpc.request';
export const RESPONSE_TYPE = 'redline.rpc.response';
export const EVENT_TYPE = 'redline.rpc.event';

export const requestEnvelopeSchema = z.object({
  type: z.literal(REQUEST_TYPE),
  id: z.string().check(z.minLength(1)),
  method: z.string().check(z.minLength(1)),
  payload: z.unknown(),
});

export const responseEnvelopeSchema = z.object({
  type: z.literal(RESPONSE_TYPE),
  id: z.string().check(z.minLength(1)),
  result: z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: z.unknown() }),
    z.object({ ok: z.literal(false), error: appErrorSchema }),
  ]),
});

export const eventEnvelopeSchema = z.object({
  type: z.literal(EVENT_TYPE),
  name: z.string().check(z.minLength(1)),
  payload: z.unknown(),
});

export type RequestEnvelope = z.infer<typeof requestEnvelopeSchema>;
export type ResponseEnvelope = z.infer<typeof responseEnvelopeSchema>;
export type EventEnvelope = z.infer<typeof eventEnvelopeSchema>;

/** Cheap discriminator so a shared message bus can ignore foreign messages without parsing them. */
export const hasEnvelopeType = (message: unknown, type: string): boolean =>
  typeof message === 'object' && message !== null && 'type' in message && message.type === type;
