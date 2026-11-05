import {
  appError,
  err,
  ok,
  parseWith,
  toAppError,
  type AppError,
  type Logger,
  type Result,
} from '@redline/core';
import type {
  MethodDefinition,
  MethodName,
  ProtocolDefinition,
  RequestOf,
  ResponseOf,
} from './define';
import {
  REQUEST_TYPE,
  RESPONSE_TYPE,
  hasEnvelopeType,
  requestEnvelopeSchema,
  type ResponseEnvelope,
} from './envelope';
import type { CallerInfo, ServerTransport, Unsubscribe } from './transport';

export type MethodHandler<P extends ProtocolDefinition<P>, M extends MethodName<P>> = (
  request: RequestOf<P, M>,
  caller: CallerInfo,
) => Promise<Result<ResponseOf<P, M>, AppError>>;

/** Exhaustive: a protocol method without a handler is a compile-time error. */
export type ProtocolHandlers<P extends ProtocolDefinition<P>> = {
  readonly [M in MethodName<P>]: MethodHandler<P, M>;
};

type UntypedHandler = (request: unknown, caller: CallerInfo) => Promise<Result<unknown, AppError>>;

interface Route {
  readonly definition: MethodDefinition;
  readonly handler: UntypedHandler;
}

export class RpcServer<P extends ProtocolDefinition<P>> {
  private readonly routes: ReadonlyMap<string, Route>;

  constructor(
    protocol: P,
    handlers: ProtocolHandlers<P>,
    private readonly logger: Logger,
  ) {
    const definitions: Readonly<Record<string, MethodDefinition>> = protocol;
    this.routes = new Map(
      Object.entries(definitions).map(([method, definition]) => [
        method,
        {
          definition,
          // Sound: the request is parsed with this method's own schema before the handler runs.
          handler: handlers[method as MethodName<P>] as UntypedHandler,
        },
      ]),
    );
  }

  listen(transport: ServerTransport): Unsubscribe {
    return transport.listen((message, caller) =>
      hasEnvelopeType(message, REQUEST_TYPE) ? this.dispatch(message, caller) : undefined,
    );
  }

  private async dispatch(message: unknown, caller: CallerInfo): Promise<ResponseEnvelope> {
    const envelope = parseWith(requestEnvelopeSchema, message);
    if (!envelope.ok) return respond('unknown', envelope);

    const { id, method, payload } = envelope.value;
    const route = this.routes.get(method);
    if (route === undefined) {
      return respond(id, err(appError('validation', `Unknown RPC method: ${method}`)));
    }

    const request = parseWith(route.definition.request, payload);
    if (!request.ok) return respond(id, request);

    const result = await this.invoke(route, method, request.value, caller);
    if (!result.ok) return respond(id, result);

    const response = parseWith(route.definition.response, result.value);
    if (!response.ok) {
      this.logger.error('RPC handler produced an invalid response', { method, ...response.error });
      return respond(id, err(appError('internal', 'Handler produced an invalid response')));
    }
    return respond(id, ok(response.value));
  }

  private async invoke(
    route: Route,
    method: string,
    request: unknown,
    caller: CallerInfo,
  ): Promise<Result<unknown, AppError>> {
    try {
      return await route.handler(request, caller);
    } catch (cause) {
      this.logger.error('RPC handler threw', { method, cause: toAppError(cause) });
      return err(toAppError(cause));
    }
  }
}

const respond = (id: string, result: Result<unknown, AppError>): ResponseEnvelope => ({
  type: RESPONSE_TYPE,
  id,
  result: result.ok ? { ok: true, value: result.value } : { ok: false, error: result.error },
});
