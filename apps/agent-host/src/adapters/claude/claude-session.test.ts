import type {
  Options,
  Query,
  SDKMessage,
  SDKUserMessage,
  query,
} from '@anthropic-ai/claude-agent-sdk';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { GO_ON } from '../../domain/asking';
import type { SessionActivity, SessionRequest, SessionStart } from '../../ports/agent';
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
    session_id: 'session-1',
    ...fields,
  }) as unknown as SDKMessage;

/** `query` playing back `messages`, and keeping what it was called with. */
const scripted = (messages: SDKMessage[]) => {
  const calls: { prompt: SDKUserMessage[]; options: Options }[] = [];
  let closed = false;
  const fake = ((params: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => {
    const prompt: SDKUserMessage[] = [];
    calls.push({ prompt, options: params.options });
    void (async () => {
      for await (const message of params.prompt) prompt.push(message);
    })();
    const generator = (async function* () {
      // What the session was given arrives before anything it answers.
      await new Promise((resolve) => setImmediate(resolve));
      yield* messages;
    })();
    return Object.assign(generator, { close: () => (closed = true) }) as unknown as Query;
  }) as unknown as typeof query;
  return { fake, calls, closed: () => closed };
};

const request = (
  activities: SessionActivity[] = [],
  fields: { start?: SessionStart; questionsLeft?: number } = {},
): SessionRequest => ({
  model: 'claude-opus-5-5',
  rules: 'Work carefully',
  start: fields.start ?? {
    kind: 'new',
    prompt: [
      { kind: 'text', text: 'Task: equal heights' },
      { kind: 'image', path: '/redline/bundle/a.png', mediaType: 'image/png' },
    ],
  },
  questionsLeft: fields.questionsLeft ?? 0,
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
    askTool: { command: '/usr/local/bin/node', args: ['/opt/agent-host/dist/ask-tool.mjs'] },
    query: fake,
    readImage: () => Promise.resolve(Buffer.from('png-bytes')),
  });

describe('ClaudeSession', () => {
  it('starts Claude Code in the workspace, with the run’s tools and limits only', async () => {
    const { fake, calls, closed } = scripted([result({ structured_output: report })]);
    const outcome = await session(fake).run(request(), new AbortController().signal);
    expect(outcome).toEqual({
      end: { kind: 'completed', report },
      sessionId: 'session-1',
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
    expect(options).not.toHaveProperty('resume');
    expect(options?.allowedTools).toContain('mcp__redline__ask_requester');
    expect(options?.mcpServers?.['redline']).toEqual({
      type: 'stdio',
      command: '/usr/local/bin/node',
      args: ['/opt/agent-host/dist/ask-tool.mjs'],
      env: { REDLINE_ASKING: JSON.stringify({ pending: null, questionsLeft: 0 }) },
      alwaysLoad: true,
    });
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

  describe('asking the requester', () => {
    const hookInput = (tool: string, id: string) =>
      ({
        hook_event_name: 'PreToolUse',
        tool_name: tool,
        tool_input: { question: 'Desktop only?' },
        tool_use_id: id,
        session_id: 'session-1',
        transcript_path: '',
        cwd: '/workspace',
      }) as const;
    const decisionOf = async (options: Options | undefined, id: string) => {
      const matcher = options?.hooks?.PreToolUse?.find(
        (entry) => entry.matcher === 'mcp__redline__ask_requester',
      );
      const answer = await matcher?.hooks[0]?.(hookInput('mcp__redline__ask_requester', id), id, {
        signal: new AbortController().signal,
      });
      return (answer as { hookSpecificOutput?: { permissionDecision?: string } } | undefined)
        ?.hookSpecificOutput?.permissionDecision;
    };

    it('defers a question while questions are left, and lets it run when none are', async () => {
      for (const [questionsLeft, expected] of [
        [1, 'defer'],
        [0, 'allow'],
      ] as const) {
        const { fake, calls } = scripted([result({ structured_output: report })]);
        await session(fake).run(request([], { questionsLeft }), new AbortController().signal);
        expect(await decisionOf(calls[0]?.options, 'toolu_9')).toBe(expected);
      }
    });

    it('ends with the question when the session paused on it', async () => {
      const input = { question: 'Desktop only?', options: ['Yes'] };
      const { fake } = scripted([
        result({
          stop_reason: 'tool_deferred',
          deferred_tool_use: { id: 'toolu_1', name: 'mcp__redline__ask_requester', input },
        }),
      ]);
      const outcome = await session(fake).run(
        request([], { questionsLeft: 1 }),
        new AbortController().signal,
      );
      expect(outcome.end).toEqual({ kind: 'asked', call: 'toolu_1', input });
      expect(outcome.sessionId).toBe('session-1');
    });

    it('goes on with a paused session: the call it waits on runs, and no message is sent', async () => {
      const { fake, calls } = scripted([result({ structured_output: report })]);
      const start: SessionStart = {
        kind: 'resume',
        sessionId: 'session-1',
        answer: { call: 'toolu_1', text: 'Desktop only' },
      };
      await session(fake).run(
        request([], { start, questionsLeft: 1 }),
        new AbortController().signal,
      );
      expect(calls[0]?.options.resume).toBe('session-1');
      expect(calls[0]?.options.mcpServers?.['redline']).toMatchObject({
        env: {
          REDLINE_ASKING: JSON.stringify({
            pending: { call: 'toolu_1', text: 'Desktop only' },
            questionsLeft: 1,
          }),
        },
      });
      expect(calls[0]?.prompt).toEqual([]);
      expect(await decisionOf(calls[0]?.options, 'toolu_1')).toBe('allow');
      expect(await decisionOf(calls[0]?.options, 'toolu_2')).toBe('defer');
    });

    it('tells a session that paused without a question to go on', async () => {
      const { fake, calls } = scripted([result({ structured_output: report })]);
      const start: SessionStart = { kind: 'resume', sessionId: 'session-1', answer: null };
      await session(fake).run(request([], { start }), new AbortController().signal);
      expect(calls[0]?.prompt.map((message) => message.message.content)).toEqual([GO_ON]);
    });
  });

  it('finds the files of a stored session, wherever its project is', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'agent-host-session-'));
    try {
      const stored = new ClaudeSession({
        env: {},
        workspace: '/workspace',
        sessionDir: dir,
        askTool: { command: 'node', args: [] },
      });
      expect(await stored.stored('session-1')).toBe(false);
      await mkdir(path.join(dir, 'projects', '-workspace'), { recursive: true });
      await writeFile(path.join(dir, 'projects', '-workspace', 'session-1.jsonl'), '{}\n');
      expect(await stored.stored('session-1')).toBe(true);
      expect(await stored.stored('session-2')).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
