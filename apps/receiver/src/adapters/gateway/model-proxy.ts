import { GATEWAY_REFUSALS, GRANT_STATUS_PATH, type GrantStatus } from '@redline/agent-protocol';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { GatewayRefusal } from '../../domain/grant';
import type { Instant } from '../../domain/ids';
import type { ModelAccess, ModelEndpoint, RequestUsage } from '../../ports/gateway';
import type { Logger } from '../../ports/system';
import { UsageMeter } from './usage-meter';

/** The largest request a run may send: a long conversation with screenshots. */
const BODY_LIMIT = 64 * 1024 * 1024;

const ENDPOINTS: Readonly<Record<string, ModelEndpoint>> = {
  '/v1/messages': 'messages',
  '/v1/messages/count_tokens': 'count-tokens',
};

/**
 * Request headers passed to the provider, as Claude Code and its SDK send them: the API's own,
 * and the SDK's description of itself. Any other header is dropped, a credential above all.
 */
const FORWARDED_REQUEST = new Set([
  'content-type',
  'accept',
  'anthropic-version',
  'anthropic-beta',
  'user-agent',
  'x-app',
  'x-claude-code-session-id',
]);
const FORWARDED_PREFIX = 'x-stainless-';

const forwarded = (name: string) =>
  FORWARDED_REQUEST.has(name) || name.startsWith(FORWARDED_PREFIX);

/** Response headers that describe the provider's connection, not the answer. */
const DROPPED_RESPONSE = new Set([
  'connection',
  'keep-alive',
  'content-length',
  'content-encoding',
  'transfer-encoding',
  'set-cookie',
]);

type RefusalCode = (typeof GATEWAY_REFUSALS)[keyof typeof GATEWAY_REFUSALS];

const REFUSAL: Readonly<Record<GatewayRefusal['kind'], RefusalCode>> = {
  'grant-revoked': GATEWAY_REFUSALS.grantRevoked,
  'budget-exhausted': GATEWAY_REFUSALS.budgetExhausted,
  'credential-missing': GATEWAY_REFUSALS.credentialMissing,
  'credential-refused': GATEWAY_REFUSALS.credentialRefused,
  'quota-exhausted': GATEWAY_REFUSALS.quotaExhausted,
  'request-refused': GATEWAY_REFUSALS.requestRefused,
};

const MESSAGE: Readonly<Record<GatewayRefusal['kind'], string>> = {
  'grant-revoked': 'This run has no grant in force',
  'budget-exhausted': 'The task has spent its budget',
  'credential-missing': 'The requester’s credential is not available',
  'credential-refused': 'The model refused the task’s credential',
  'quota-exhausted': 'The subscription’s usage limit is reached',
  'request-refused': 'This request is not allowed in a run',
};

const messageOf = (refusal: GatewayRefusal) =>
  refusal.kind === 'request-refused'
    ? `${MESSAGE[refusal.kind]}: ${refusal.detail}`
    : MESSAGE[refusal.kind];

/** The run's grant, from the header Claude Code puts its credential in. */
export const grantOf = (request: IncomingMessage): string | null => {
  const apiKey = request.headers['x-api-key'];
  if (typeof apiKey === 'string' && apiKey !== '') return apiKey;
  const bearer = /^Bearer\s+(\S+)$/i.exec(request.headers.authorization ?? '');
  return bearer?.[1] ?? null;
};

/**
 * When a subscription's limit resets, as the provider names it on a refused request: Unix
 * seconds in `anthropic-ratelimit-unified-reset`.
 */
const quotaResetOf = (headers: Headers): Instant | null => {
  const reset = Number(headers.get('anthropic-ratelimit-unified-reset'));
  return Number.isFinite(reset) && reset > 0 ? reset * 1000 : null;
};

const sendJson = (response: ServerResponse, status: number, body: unknown) => {
  const text = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(text),
  });
  response.end(text);
};

/** A refusal as the provider's own errors look, so the agent stops instead of retrying. */
const sendRefusal = (response: ServerResponse, refusal: GatewayRefusal) => {
  sendJson(response, 403, {
    type: 'error',
    error: { type: REFUSAL[refusal.kind], message: messageOf(refusal) },
  });
};

const statusOf = (view: Awaited<ReturnType<ModelAccess['status']>>): GrantStatus =>
  view.state === 'active'
    ? { state: 'active' }
    : {
        state: 'refused',
        refusal: REFUSAL[view.refusal.kind],
        resetAt:
          view.refusal.kind === 'quota-exhausted'
            ? new Date(view.refusal.resetAt).toISOString()
            : null,
      };

const readBody = async (request: IncomingMessage): Promise<Buffer | null> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.byteLength;
    if (size > BODY_LIMIT) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const parseJson = (body: Buffer): unknown => {
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    return undefined;
  }
};

export interface ModelProxyOptions {
  readonly access: ModelAccess;
  /** The provider's API, e.g. `https://api.anthropic.com`. */
  readonly upstream: string;
  readonly logger: Logger;
  readonly fetch?: typeof fetch;
}

/**
 * The gateway's HTTP side towards the sandboxes: the Messages API and nothing else, with the
 * grant swapped for the task's credential, answers streamed back as they come and their usage
 * metered on the way.
 */
export const createModelProxy = (options: ModelProxyOptions): Server => {
  const upstream = options.upstream.replace(/\/$/, '');
  const call = options.fetch ?? fetch;

  const forward = async (
    request: IncomingMessage,
    response: ServerResponse,
    endpoint: ModelEndpoint,
    url: URL,
  ) => {
    const raw = await readBody(request);
    if (raw === null) {
      sendRefusal(response, { kind: 'request-refused', detail: 'The request is too large' });
      return;
    }
    const body = parseJson(raw);
    const admitted = await options.access.admit(grantOf(request), body, endpoint);
    if (!admitted.ok) {
      sendRefusal(response, admitted.refusal);
      return;
    }
    const { admission } = admitted;
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (!forwarded(name) || value === undefined) continue;
      headers.set(name, Array.isArray(value) ? value.join(', ') : value);
    }
    if (admission.credential.kind === 'api-key')
      headers.set('x-api-key', admission.credential.reveal());
    else headers.set('authorization', `Bearer ${admission.credential.reveal()}`);

    // The answer is read to its end whatever the sandbox does: the provider bills for all it
    // generates, and only the end of an answer says how much that was.
    const metered = endpoint === 'messages';
    let used: RequestUsage = { kind: 'none' };
    try {
      let answer: Response;
      try {
        // The request as judged, not as sent: what the provider reads is what was allowed.
        answer = await call(`${upstream}${url.pathname}${url.search}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(body),
        });
      } catch (error) {
        options.logger.warn('The model provider is unreachable', { error: String(error) });
        sendJson(response, 502, {
          type: 'error',
          error: { type: 'api_error', message: 'The model provider is unreachable' },
        });
        return;
      }
      const refusal = await options.access.inspect(admission, {
        status: answer.status,
        quotaResetAt: quotaResetOf(answer.headers),
      });
      if (refusal !== null) {
        await answer.body?.cancel();
        sendRefusal(response, refusal);
        return;
      }
      const outgoing: Record<string, string> = {};
      answer.headers.forEach((value, name) => {
        if (!DROPPED_RESPONSE.has(name)) outgoing[name] = value;
      });
      response.writeHead(answer.status, outgoing);
      const meter = new UsageMeter(
        (answer.headers.get('content-type') ?? '').includes('event-stream') ? 'stream' : 'json',
      );
      try {
        const reader = answer.body?.getReader();
        for (;;) {
          const read = await reader?.read();
          if (read === undefined || read.done) break;
          const chunk: unknown = read.value;
          if (!(chunk instanceof Uint8Array))
            throw new Error('The provider sent a body that is not bytes');
          if (metered && answer.ok) meter.push(chunk);
          if (!response.destroyed && !response.write(chunk)) {
            await new Promise((resolve) => {
              response.once('drain', resolve);
              response.once('close', resolve);
            });
          }
        }
        response.end();
      } catch (error) {
        // The provider broke off: what was used is still metered.
        options.logger.info('A model answer was cut off', { error: String(error) });
        response.destroy();
      } finally {
        if (metered && answer.ok) {
          const usage = meter.finish();
          used = usage === null ? { kind: 'unknown' } : { kind: 'measured', usage };
        }
      }
    } finally {
      // What the request used, or that it used nothing or is not known: its reservation goes by it.
      await options.access.meter(admission, used).catch((error: unknown) => {
        // Its reservation stays counted: the task is never thought to have spent less.
        options.logger.error('A model answer could not be metered', { error: String(error) });
      });
    }
  };

  return createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://gateway');
    const endpoint = ENDPOINTS[url.pathname];
    const handled =
      request.method === 'POST' && endpoint !== undefined
        ? forward(request, response, endpoint, url)
        : request.method === 'GET' && url.pathname === GRANT_STATUS_PATH
          ? options.access.status(grantOf(request)).then((view) => {
              sendJson(response, 200, statusOf(view));
            })
          : Promise.resolve().then(() => {
              sendJson(response, 404, {
                type: 'error',
                error: { type: 'not_found_error', message: 'Not available in a run' },
              });
            });
    handled.catch((error: unknown) => {
      options.logger.error('The gateway failed a request', { error: String(error) });
      if (!response.headersSent) {
        sendJson(response, 500, {
          type: 'error',
          error: { type: 'api_error', message: 'The gateway failed' },
        });
      } else response.destroy();
    });
  });
};
