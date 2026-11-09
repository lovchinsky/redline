import type {
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
  query,
} from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from 'vitest';
import type { SessionActivity, SessionRequest } from '../../ports/agent';
import { ClaudeSession } from './claude-session';

const report = {
  outcome: 'change',
  summary: 'Equal heights',
  changes: [{ file: 'src/Card.css', why: 'stretch' }],
  verification: 'Tests pass',
  assumptions: [],
  explanation: '',
};

const result = (fields: Record<string, unknown>) =>
  ({
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 3,
    duration_ms: 1200,
    total_cost_usd: 0.42,
    result: '',
    errors: [],
    ...fields,
  }) as unknown as SDKMessage;

/** `query` playing back `messages`, and keeping what it was called with. */
const scripted = (messages: SDKMessage[]) => {
  const calls: { prompt: SDKUserMessage[]; options: Options }[] = [];
  let closed = false;
  const fake = ((params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
    const prompt: SDKUserMessage[] = [];
    calls.push({ prompt, options: params.options });
    const generator = (async function* () {
      for await (const message of params.prompt) prompt.push(message);
      yield* messages;
    })();
    return Object.assign(generator, { close: () => (closed = true) }) as unknown as Query;
  }) as unknown as typeof query;
  return { fake, calls, closed: () => closed };
};

const request = (activities: SessionActivity[] = []): SessionRequest => ({
  model: 'claude-opus-5-5',
  rules: 'Work carefully',
  prompt: [
    { kind: 'text', text: 'Task: equal heights' },
    { kind: 'image', path: '/redline/bundle/a.png', mediaType: 'image/png' },
  ],
  maxTurns: 40,
  budgetUsd: null,
  judge: (tool) => (tool === 'Write' ? { allow: false, reason: 'protected' } : { allow: true }),
  onActivity: (activity) => activities.push(activity),
});

const session = (fake: typeof query) =>
  new ClaudeSession({
    env: { ANTHROPIC_BASE_URL: 'http://gateway/llm', ANTHROPIC_API_KEY: 'grant' },
    workspace: '/workspace',
    sessionDir: '/redline/session',
    query: fake,
    readImage: () => Promise.resolve(Buffer.from('png-bytes')),
  });

describe('ClaudeSession', () => {
  it('starts Claude Code in the workspace, with the run’s tools and limits only', async () => {
    const { fake, calls, closed } = scripted([result({ structured_output: report })]);
    const outcome = await session(fake).run(request(), new AbortController().signal);
    expect(outcome).toEqual({
      end: { kind: 'completed', report },
      usage: { turns: 3, durationMs: 1200, costUsd: 0.42 },
    });
    expect(closed()).toBe(true);
    const options = calls[0]?.options;
    expect(options).toMatchObject({
      cwd: '/workspace',
      model: 'claude-opus-5-5',
      systemPrompt: { type: 'preset', preset: 'claude_code', append: 'Work carefully' },
      settingSources: ['project'],
      tools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash', 'TodoWrite'],
      permissionMode: 'dontAsk',
      maxTurns: 40,
      outputFormat: { type: 'json_schema' },
    });
    expect(options).not.toHaveProperty('maxBudgetUsd');
    expect(options?.env).toMatchObject({
      ANTHROPIC_API_KEY: 'grant',
      CLAUDE_CONFIG_DIR: '/redline/session',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    });
    expect(calls[0]?.prompt[0]?.message.content).toEqual([
      { type: 'text', text: 'Task: equal heights' },
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: Buffer.from('png-bytes').toString('base64'),
        },
      },
    ]);
  });

  it('denies a tool call the judge refuses, and says so', async () => {
    const { fake, calls } = scripted([result({ structured_output: report })]);
    const activities: SessionActivity[] = [];
    await session(fake).run(request(activities), new AbortController().signal);
    const hook = calls[0]?.options.hooks?.PreToolUse?.[0]?.hooks[0];
    const input = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: 'CLAUDE.md' },
      tool_use_id: 't1',
      session_id: 's',
      transcript_path: '',
      cwd: '/workspace',
    } as const;
    const answer = await hook?.(input, 't1', { signal: new AbortController().signal });
    expect(answer).toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: 'protected',
      },
    });
    expect(activities).toContainEqual({ kind: 'denied', tool: 'Write', reason: 'protected' });
  });

  it('reports what the agent does, and how its session ended', async () => {
    const assistant = {
      type: 'assistant',
      parent_tool_use_id: null,
      message: {
        content: [
          { type: 'text', text: 'Looking for the card' },
          { type: 'tool_use', name: 'Grep', input: { pattern: 'plan-card' } },
        ],
      },
    } as unknown as SDKMessage;
    const activities: SessionActivity[] = [];
    const ends = [
      [
        result({ is_error: true, api_error_status: 403, result: 'API Error: 403' }),
        { kind: 'api-error', status: 403, detail: 'API Error: 403' },
      ],
      [result({ subtype: 'error_max_turns' }), { kind: 'max-turns' }],
      [result({ subtype: 'error_max_budget_usd' }), { kind: 'budget' }],
      [result({ structured_output: { outcome: 'maybe' } }), { kind: 'completed', report: null }],
      [
        result({ subtype: 'error_during_execution', errors: ['boom'] }),
        { kind: 'error', detail: 'boom' },
      ],
    ] as const;
    for (const [end, expected] of ends) {
      const { fake } = scripted([assistant, end]);
      expect(
        (await session(fake).run(request(activities), new AbortController().signal)).end,
      ).toEqual(expected);
    }
    expect(activities.slice(0, 2)).toEqual([
      { kind: 'turn', text: 'Looking for the card' },
      { kind: 'tool', tool: 'Grep', target: 'plan-card' },
    ]);
  });
});
