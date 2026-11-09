import { GATEWAY_REFUSALS, GRANT_STATUS_PATH } from '@redline/agent-protocol';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { connect, createServer as createTcpServer, type AddressInfo, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { EgressGate, ModelGateway } from '../../application/gateway';
import { FixedClock, silentLogger } from '../../application/testing/fakes';
import type { Budget, GrantTerms } from '../../domain/grant';
import { RunId, TaskId } from '../../domain/ids';
import { ModelCredential } from '../../ports/access';
import type { GrantBook, UsageEntry, UsageLedger } from '../../ports/gateway';
import { createEgressProxy } from './egress-proxy';
import { createModelProxy } from './model-proxy';

/**
 * The gateway from a sandbox's side: every way out that a run could try, and what it gets.
 * Both proxies run on real sockets, in front of a stand-in for the model's provider.
 */

const runId = RunId('run-1');
const taskId = TaskId('task-1');
const AGENT = 'agent-grant';
const SETUP = 'setup-grant';
const SUBSCRIBER = 'subscriber-grant';

const terms = new Map<string, GrantTerms>([
  [
    AGENT,
    {
      phase: 'agent',
      runId,
      taskId,
      model: 'claude-opus-5-5',
      credentials: 'operator',
      budget: { usd: 0.05, tokens: 1_000_000 },
    },
  ],
  [
    SUBSCRIBER,
    {
      phase: 'agent',
      runId: RunId('run-2'),
      taskId: TaskId('task-2'),
      model: 'claude-opus-5-5',
      credentials: 'requester',
      budget: { usd: 1, tokens: 1_000_000 },
    },
  ],
  [SETUP, { phase: 'setup', runId, taskId, hosts: ['registry.npmjs.org'] }],
]);

const grants: GrantBook = { terms: (token) => Promise.resolve(terms.get(token) ?? null) };

class Ledger implements UsageLedger {
  readonly entries: UsageEntry[] = [];
  record(entry: UsageEntry) {
    this.entries.push(entry);
    return Promise.resolve();
  }
  spent(id: TaskId): Promise<Budget> {
    const own = this.entries.filter((entry) => entry.taskId === id);
    return Promise.resolve({
      usd: own.reduce((sum, entry) => sum + entry.costUsd, 0),
      tokens: own.reduce((sum, entry) => sum + entry.usage.input + entry.usage.output, 0),
    });
  }
}

/** The provider: answers with `reply` and keeps every request it saw. */
const provider = (
  reply: (request: IncomingMessage) => {
    status: number;
    headers?: Record<string, string>;
    body: string;
  },
) => {
  const seen: { path: string; headers: IncomingMessage['headers']; body: string }[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => {
      seen.push({
        path: request.url ?? '',
        headers: request.headers,
        body: Buffer.concat(chunks).toString(),
      });
      const answer = reply(request);
      response.writeHead(answer.status, answer.headers ?? { 'content-type': 'application/json' });
      response.end(answer.body);
    });
  });
  return { server, seen };
};

const sse = (events: object[]) =>
  events
    .map(
      (event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`,
    )
    .join('');

const streamed = sse([
  {
    type: 'message_start',
    message: {
      usage: {
        input_tokens: 5000,
        cache_read_input_tokens: 20_000,
        cache_creation_input_tokens: 0,
        output_tokens: 1,
      },
    },
  },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello' } },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1200 } },
  { type: 'message_stop' },
]);

const listen = (server: Server | ReturnType<typeof createTcpServer>) =>
  new Promise<number>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });

const servers: { close: () => void }[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

const harness = async (
  reply: Parameters<typeof provider>[0],
  held: ModelCredential | null = null,
) => {
  const upstream = provider(reply);
  const upstreamPort = await listen(upstream.server);
  const ledger = new Ledger();
  const access = new ModelGateway({
    grants,
    ledger,
    prices: { priceOf: () => ({ input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 }) },
    requesters: { credentialOf: () => held },
    operator: new ModelCredential('api-key', 'sk-ant-operator-key'),
    maxTokens: 64_000,
    clock: new FixedClock(),
    logger: silentLogger,
  });
  const proxy = createModelProxy({
    access,
    upstream: `http://127.0.0.1:${String(upstreamPort)}`,
    logger: silentLogger,
  });
  const port = await listen(proxy);
  servers.push(upstream.server, proxy);
  const base = `http://127.0.0.1:${String(port)}`;
  const ask = (
    path: string,
    init: {
      grant?: string | null;
      body?: unknown;
      headers?: Record<string, string>;
      method?: string;
    } = {},
  ) =>
    fetch(`${base}${path}`, {
      method: init.method ?? 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        ...(init.grant === null ? {} : { 'x-api-key': init.grant ?? AGENT }),
        ...init.headers,
      },
      ...(init.method === 'GET' ? {} : { body: JSON.stringify(init.body ?? request()) }),
    });
  return { ask, seen: upstream.seen, ledger };
};

const request = (extra: Record<string, unknown> = {}) => ({
  model: 'claude-opus-5-5',
  max_tokens: 32_000,
  stream: true,
  messages: [{ role: 'user', content: 'Make the cards equal height' }],
  tools: [{ name: 'Read', description: 'Read a file', input_schema: { type: 'object' } }],
  ...extra,
});

const ok = () => ({
  status: 200,
  headers: { 'content-type': 'text/event-stream' },
  body: streamed,
});
const errorType = async (response: Response) =>
  ((await response.json()) as { error: { type: string } }).error.type;

describe('the model proxy, from a sandbox', () => {
  it('forwards a run’s request with the real credential, streams the answer and meters it', async () => {
    const { ask, seen, ledger } = await harness(ok);
    const response = await ask('/v1/messages?beta=true', {
      headers: { 'anthropic-beta': 'claude-code-20250219,oauth-2025-04-20' },
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(streamed);
    expect(seen[0]?.path).toBe('/v1/messages?beta=true');
    expect(seen[0]?.headers['x-api-key']).toBe('sk-ant-operator-key');
    expect(seen[0]?.headers['anthropic-beta']).toBe('claude-code-20250219,oauth-2025-04-20');
    expect(JSON.stringify(seen[0]?.headers)).not.toContain(AGENT);
    expect(ledger.entries[0]?.usage).toEqual({
      input: 5000,
      output: 1200,
      cacheWrite: 0,
      cacheRead: 20_000,
    });
    expect(ledger.entries[0]?.costUsd).toBeCloseTo((5000 * 4 + 1200 * 20 + 20_000 * 0.2) / 1e6);
  });

  it('sends a subscription token as a bearer token, never as an API key', async () => {
    const { ask, seen } = await harness(
      ok,
      new ModelCredential('subscription', 'sk-ant-oat01-requester'),
    );
    expect((await ask('/v1/messages', { grant: SUBSCRIBER })).status).toBe(200);
    expect(seen[0]?.headers.authorization).toBe('Bearer sk-ant-oat01-requester');
    expect(seen[0]?.headers['x-api-key']).toBeUndefined();
  });

  it.each([
    ['no grant', { grant: null }],
    ['an unknown grant', { grant: 'guessed' }],
    ['the setup phase’s grant', { grant: SETUP }],
  ])('refuses a request with %s', async (_name, init) => {
    const { ask, seen } = await harness(ok);
    const response = await ask('/v1/messages', init);
    expect(response.status).toBe(403);
    expect(await errorType(response)).toBe(GATEWAY_REFUSALS.grantRevoked);
    expect(seen).toHaveLength(0);
  });

  it.each([
    ['web search', { tools: [{ type: 'web_search_20260209', name: 'web_search' }] }],
    ['web fetch', { tools: [{ type: 'web_fetch_20260209', name: 'web_fetch' }] }],
    ['code execution', { tools: [{ type: 'code_execution_20260521', name: 'code_execution' }] }],
    [
      'an MCP server',
      { mcp_servers: [{ type: 'url', url: 'https://evil.example/mcp', name: 'x' }] },
    ],
    ['a container', { container: 'container_123' }],
    ['another model', { model: 'claude-fable-5-1' }],
    ['a huge answer', { max_tokens: 1_000_000 }],
    [
      'an image the provider fetches',
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'url', url: 'https://evil.example/?k=secret' } },
            ],
          },
        ],
      },
    ],
  ])('refuses a request that uses %s, before the provider sees it', async (_name, extra) => {
    const { ask, seen } = await harness(ok);
    const response = await ask('/v1/messages', { body: request(extra) });
    expect(response.status).toBe(403);
    expect(await errorType(response)).toBe(GATEWAY_REFUSALS.requestRefused);
    expect(seen).toHaveLength(0);
  });

  it.each([
    ['GET', '/v1/models'],
    ['POST', '/v1/files'],
    ['POST', '/v1/messages/batches'],
    ['POST', '/v1/complete'],
    ['POST', '/v1/sessions'],
    ['GET', '/'],
  ])('offers nothing else: %s %s', async (method, path) => {
    const { ask, seen } = await harness(ok);
    expect((await ask(path, { method })).status).toBe(404);
    expect(seen).toHaveLength(0);
  });

  it('stops a task at its budget, and tells the run why', async () => {
    const { ask, seen } = await harness(ok);
    expect((await ask('/v1/messages')).status).toBe(200);
    expect((await ask('/v1/messages')).status).toBe(200);
    // Spent 2 × $0.048: over the $0.05 budget.
    const refused = await ask('/v1/messages');
    expect(refused.status).toBe(403);
    expect(await errorType(refused)).toBe(GATEWAY_REFUSALS.budgetExhausted);
    expect(seen).toHaveLength(2);
    const status = await ask(GRANT_STATUS_PATH, { method: 'GET' });
    expect(await status.json()).toEqual({
      state: 'refused',
      refusal: GATEWAY_REFUSALS.budgetExhausted,
      resetAt: null,
    });
  });

  it('turns a refused credential and a spent subscription limit into refusals the run can name', async () => {
    const refusedKey = await harness(() => ({
      status: 401,
      body: '{"type":"error","error":{"type":"authentication_error"}}',
    }));
    const response = await refusedKey.ask('/v1/messages');
    expect(response.status).toBe(403);
    expect(await errorType(response)).toBe(GATEWAY_REFUSALS.credentialRefused);

    const reset = Math.floor(Date.UTC(2026, 10, 9, 15) / 1000);
    const limited = await harness(
      () => ({
        status: 429,
        headers: {
          'content-type': 'application/json',
          'anthropic-ratelimit-unified-reset': String(reset),
        },
        body: '{"type":"error","error":{"type":"rate_limit_error"}}',
      }),
      new ModelCredential('subscription', 'sk-ant-oat01-requester'),
    );
    expect(await errorType(await limited.ask('/v1/messages', { grant: SUBSCRIBER }))).toBe(
      GATEWAY_REFUSALS.quotaExhausted,
    );
    const status = await limited.ask(GRANT_STATUS_PATH, { grant: SUBSCRIBER, method: 'GET' });
    expect(await status.json()).toEqual({
      state: 'refused',
      refusal: GATEWAY_REFUSALS.quotaExhausted,
      resetAt: '2026-11-09T15:00:00.000Z',
    });
  });

  it('passes an ordinary rate limit through, for the agent to retry', async () => {
    const { ask } = await harness(() => ({
      status: 429,
      headers: { 'retry-after': '1' },
      body: '{}',
    }));
    const response = await ask('/v1/messages');
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('1');
  });

  it('waits for a requester’s credential that the gateway lost', async () => {
    const { ask } = await harness(ok, null);
    expect(await errorType(await ask('/v1/messages', { grant: SUBSCRIBER }))).toBe(
      GATEWAY_REFUSALS.credentialMissing,
    );
  });
});

describe('the egress proxy, from a setup sandbox', () => {
  /** A registry stand-in that echoes what it gets, and the proxy in front of it. */
  const egress = async (resolve: (host: string) => Promise<readonly string[]>) => {
    const registry = createTcpServer((socket) => socket.pipe(socket));
    const registryPort = await listen(registry);
    const proxy = createEgressProxy({
      access: new EgressGate({ grants, logger: silentLogger }),
      logger: silentLogger,
      resolve,
      open: () => connect({ host: '127.0.0.1', port: registryPort }),
    });
    const port = await listen(proxy);
    servers.push(registry, proxy);
    return port;
  };

  /** Sends a CONNECT and returns the status line, and the socket for a tunnel. */
  const tunnel = (port: number, authority: string, grant: string | null) =>
    new Promise<{ status: string; socket: Socket }>((resolve) => {
      const socket = connect({ host: '127.0.0.1', port }, () => {
        const auth =
          grant === null
            ? ''
            : `Proxy-Authorization: Basic ${Buffer.from(`redline:${grant}`).toString('base64')}\r\n`;
        socket.write(`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n${auth}\r\n`);
      });
      socket.once('data', (chunk: Buffer) => {
        resolve({ status: chunk.toString().split('\r\n')[0] ?? '', socket });
      });
    });

  const publicAddress = () => Promise.resolve(['104.16.1.35']);

  it('tunnels to a listed registry with a setup grant', async () => {
    const port = await egress(publicAddress);
    const { status, socket } = await tunnel(port, 'registry.npmjs.org:443', SETUP);
    expect(status).toBe('HTTP/1.1 200 Connection Established');
    const echoed = new Promise<string>((resolve) =>
      socket.once('data', (chunk: Buffer) => {
        resolve(chunk.toString());
      }),
    );
    socket.write('client hello');
    expect(await echoed).toBe('client hello');
    socket.destroy();
  });

  it.each([
    ['without a grant', 'registry.npmjs.org:443', null],
    ['with the agent’s grant', 'registry.npmjs.org:443', AGENT],
    ['to an unlisted host', 'evil.example:443', SETUP],
    ['to another port', 'registry.npmjs.org:22', SETUP],
  ])('refuses a tunnel %s', async (_name, authority, grant) => {
    const port = await egress(publicAddress);
    const { status, socket } = await tunnel(port, authority, grant);
    expect(status).toBe('HTTP/1.1 403 Forbidden');
    socket.destroy();
  });

  it('refuses a listed name that resolves inside the deployment', async () => {
    for (const addresses of [
      ['10.0.0.7'],
      ['104.16.1.35', '172.18.0.3'],
      ['::1'],
      ['169.254.169.254'],
    ]) {
      const port = await egress(() => Promise.resolve(addresses));
      const { status, socket } = await tunnel(port, 'registry.npmjs.org:443', SETUP);
      expect(status).toBe('HTTP/1.1 403 Forbidden');
      socket.destroy();
    }
  });

  it('carries no plain HTTP: only tunnels', async () => {
    const port = await egress(publicAddress);
    const response = await fetch(`http://127.0.0.1:${String(port)}/http://registry.npmjs.org/`);
    expect(response.status).toBe(405);
  });
});
