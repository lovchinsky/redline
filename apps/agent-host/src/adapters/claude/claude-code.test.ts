import { build } from 'esbuild';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ASK_TOOL } from './ask-tool';
import type { SessionRequest, SessionStart } from '../../ports/agent';
import { ClaudeSession } from './claude-session';
import { scriptedMessagesApi, type ModelRequest } from './testing/messages-api';

/**
 * Claude Code itself, as agent-host runs it, against a scripted model: the question pauses the
 * session, and a session moved to another directory (another sandbox) goes on with the answer.
 */

const textOf = (content: unknown): string =>
  typeof content === 'string'
    ? content
    : Array.isArray(content)
      ? content
          .map((part: { text?: unknown }) => (typeof part.text === 'string' ? part.text : ''))
          .join('')
      : '';

const resultOf = (request: ModelRequest, id: string) =>
  request.blocks.find((block) => block.type === 'tool_result' && block.tool_use_id === id);

/** A model that asks one question, then reports the answer it got. */
const script = (request: ModelRequest) => {
  if (!request.tools.includes(ASK_TOOL.qualified)) {
    return { blocks: [{ type: 'text' as const, text: 'ok' }], stop: 'end_turn' as const };
  }
  const answer = resultOf(request, 'toolu_ask');
  if (answer === undefined) {
    return {
      blocks: [
        { type: 'text' as const, text: 'One question first.' },
        {
          type: 'tool_use' as const,
          id: 'toolu_ask',
          name: ASK_TOOL.qualified,
          input: { question: 'Desktop only?', options: ['Yes', 'No'] },
        },
      ],
      stop: 'tool_use' as const,
    };
  }
  if (resultOf(request, 'toolu_report') === undefined) {
    return {
      blocks: [
        {
          type: 'tool_use' as const,
          id: 'toolu_report',
          name: 'StructuredOutput',
          input: {
            outcome: 'no-change',
            summary: `The requester said: ${textOf(answer.content)}`,
            changes: [],
            verification: '',
            assumptions: [],
            explanation: 'Nothing to change',
          },
        },
      ],
      stop: 'tool_use' as const,
    };
  }
  return { blocks: [{ type: 'text' as const, text: 'Done.' }], stop: 'end_turn' as const };
};

let dir: string;
let api: Awaited<ReturnType<typeof scriptedMessagesApi>>;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'agent-host-claude-'));
  await mkdir(path.join(dir, 'workspace'));
  await mkdir(path.join(dir, 'home'));
  api = await scriptedMessagesApi(script);
  // The tool's server as the image has it: one bundle Claude Code starts with node.
  await build({
    entryPoints: [path.join(import.meta.dirname, '../../entrypoints/ask-tool.ts')],
    outfile: path.join(dir, 'ask-tool.mjs'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    logLevel: 'warning',
  });
});

afterAll(async () => {
  await api.close();
  await rm(dir, { recursive: true, force: true });
});

const sessionIn = (sessionDir: string) =>
  new ClaudeSession({
    env: {
      PATH: process.env['PATH'],
      HOME: path.join(dir, 'home'),
      ANTHROPIC_BASE_URL: api.url,
      ANTHROPIC_API_KEY: 'sk-ant-test-grant',
      NO_PROXY: '127.0.0.1',
    },
    workspace: path.join(dir, 'workspace'),
    sessionDir,
    askTool: { command: process.execPath, args: [path.join(dir, 'ask-tool.mjs')] },
  });

const request = (start: SessionStart, questionsLeft = 1): SessionRequest => ({
  model: 'claude-opus-5-5',
  rules: 'Ask before you change anything.',
  start,
  questionsLeft,
  maxTurns: 10,
  budgetUsd: null,
  judge: () => ({ allow: true }),
  onActivity: () => undefined,
  onLife: () => undefined,
});

describe('Claude Code with ask_requester', () => {
  it('pauses on the question, and goes on with the answer in another sandbox', async () => {
    const first = path.join(dir, 'session-first');
    const asked = await sessionIn(first).run(
      request({ kind: 'new', prompt: [{ kind: 'text', text: 'Make the cards equal height' }] }),
      new AbortController().signal,
    );
    expect(asked.end).toEqual({
      kind: 'asked',
      call: 'toolu_ask',
      question: { text: 'Desktop only?', options: ['Yes', 'No'] },
    });
    const sessionId = asked.sessionId ?? '';
    expect(sessionId).not.toBe('');

    // The next run's sandbox has the session's files, and nothing else of the first one.
    // Only the transcripts travel: the receiver keeps nothing else of the session directory.
    const second = path.join(dir, 'session-second');
    await cp(path.join(first, 'projects'), path.join(second, 'projects'), {
      recursive: true,
      filter: (source) => path.extname(source) === '' || source.endsWith('.jsonl'),
    });
    await rm(first, { recursive: true, force: true });
    const resumed = sessionIn(second);
    expect(await resumed.stored(sessionId)).toBe(true);

    const answered = await resumed.run(
      request({
        kind: 'resume',
        sessionId,
        answer: { call: 'toolu_ask', text: 'Desktop only' },
      }),
      new AbortController().signal,
    );
    expect(answered.end).toMatchObject({
      kind: 'completed',
      report: { summary: 'The requester said: Desktop only' },
    });
    expect(answered.sessionId).toBe(sessionId);
  }, 120_000);

  it('answers at once, without pausing, when no questions are left', async () => {
    const outcome = await sessionIn(path.join(dir, 'session-none-left')).run(
      request({ kind: 'new', prompt: [{ kind: 'text', text: 'Make the cards equal height' }] }, 0),
      new AbortController().signal,
    );
    expect(outcome.end).toMatchObject({
      kind: 'completed',
      report: { summary: expect.stringContaining('cannot ask more questions') as string },
    });
  }, 120_000);
});
