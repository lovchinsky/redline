import type * as z from 'zod/mini';

export interface MethodDefinition {
  readonly request: z.ZodMiniType;
  readonly response: z.ZodMiniType;
}

/**
 * Self-referential constraints (`P extends ProtocolDefinition<P>`) keep method lookups typed by
 * the literal keys of P instead of an index signature.
 */
export type ProtocolDefinition<P = Record<string, MethodDefinition>> = {
  readonly [K in keyof P]: MethodDefinition;
};
export type EventsDefinition<E = Record<string, z.ZodMiniType>> = {
  readonly [K in keyof E]: z.ZodMiniType;
};

export type MethodName<P extends ProtocolDefinition<P>> = Extract<keyof P, string>;
export type RequestOf<P extends ProtocolDefinition<P>, M extends MethodName<P>> = z.output<
  P[M]['request']
>;
export type ResponseOf<P extends ProtocolDefinition<P>, M extends MethodName<P>> = z.output<
  P[M]['response']
>;

export type EventName<E extends EventsDefinition<E>> = Extract<keyof E, string>;
export type PayloadOf<E extends EventsDefinition<E>, N extends EventName<E>> = z.output<E[N]>;

export const defineProtocol = <const P extends ProtocolDefinition<P>>(protocol: P): P => protocol;
export const defineEvents = <const E extends EventsDefinition<E>>(events: E): E => events;
