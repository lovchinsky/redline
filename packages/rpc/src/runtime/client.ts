import {
  appError,
  err,
  parseWith,
  type AppError,
  type IdGenerator,
  type Result,
} from '@redline/core';
import type { MethodName, ProtocolDefinition, RequestOf, ResponseOf } from './define';
import { REQUEST_TYPE, responseEnvelopeSchema } from './envelope';
import type { ClientTransport } from './transport';

export class RpcClient<P extends ProtocolDefinition<P>> {
  constructor(
    private readonly protocol: P,
    private readonly transport: ClientTransport,
    private readonly ids: IdGenerator,
  ) {}

  async call<M extends MethodName<P>>(
    method: M,
    request: RequestOf<P, M>,
  ): Promise<Result<ResponseOf<P, M>, AppError>> {
    const requestSchema: P[M]['request'] = this.protocol[method].request;
    const responseSchema: P[M]['response'] = this.protocol[method].response;
    const payload = parseWith(requestSchema, request);
    if (!payload.ok) return payload;

    const id = this.ids.next();
    const sent = await this.transport.send({
      type: REQUEST_TYPE,
      id,
      method,
      payload: payload.value,
    });
    if (!sent.ok) return sent;

    const envelope = parseWith(responseEnvelopeSchema, sent.value);
    if (!envelope.ok) return err(appError('transport', 'Malformed RPC response', { method }));
    if (envelope.value.id !== id) {
      return err(appError('transport', 'RPC response does not match the request', { method }));
    }

    const { result } = envelope.value;
    if (!result.ok) return err(result.error);
    return parseWith(responseSchema, result.value);
  }
}
