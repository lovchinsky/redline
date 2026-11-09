import { GATEWAY_REFUSALS, GRANT_STATUS_PATH } from '@redline/agent-protocol';
import { describe, expect, it } from 'vitest';
import { GatewayClient } from './gateway-client';

describe('GatewayClient', () => {
  it('asks with the run’s grant and reads the answer', async () => {
    const seen: { url: string; headers: Headers }[] = [];
    const client = new GatewayClient({
      baseUrl: 'http://gateway/llm/',
      grant: { name: 'x-api-key', value: 'grant-1' },
      fetch: (input, init) => {
        const url =
          input instanceof Request ? input.url : input instanceof URL ? input.href : input;
        seen.push({ url, headers: new Headers(init?.headers) });
        return Promise.resolve(
          Response.json({
            state: 'refused',
            refusal: GATEWAY_REFUSALS.budgetExhausted,
            resetAt: null,
          }),
        );
      },
    });
    expect(await client.grantStatus()).toMatchObject({ refusal: GATEWAY_REFUSALS.budgetExhausted });
    expect(seen[0]?.url).toBe(`http://gateway/llm${GRANT_STATUS_PATH}`);
    expect(seen[0]?.headers.get('x-api-key')).toBe('grant-1');
  });

  it('knows nothing when the gateway is unreachable or answers nonsense', async () => {
    const failing = new GatewayClient({
      baseUrl: 'http://gateway',
      grant: { name: 'authorization', value: 'Bearer g' },
      fetch: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    expect(await failing.grantStatus()).toBeNull();
    const odd = new GatewayClient({
      baseUrl: 'http://gateway',
      grant: { name: 'authorization', value: 'Bearer g' },
      fetch: () => Promise.resolve(Response.json({ state: 'who knows' })),
    });
    expect(await odd.grantStatus()).toBeNull();
  });
});
