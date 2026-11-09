import { describe, expect, it } from 'vitest';
import {
  AGENT_PROTOCOL_VERSION,
  GATEWAY_REFUSALS,
  QUESTION_LIMITS,
  briefSchema,
  grantStatusSchema,
  outcomeSchema,
  runEventSchema,
  type Brief,
} from './index';

const brief = (): Brief => ({
  protocol: AGENT_PROTOCOL_VERSION,
  runId: 'run-1',
  taskId: 'task-1',
  baseSha: 'a'.repeat(40),
  model: 'claude-opus-5-5',
  limits: { maxTurns: 40, timeoutMs: 1_800_000, stallTimeoutMs: 300_000, budgetUsd: 5 },
  task: {
    title: 'Make the cards equal height',
    steps: [
      {
        id: 's1',
        url: 'https://acme.io/pricing',
        comment: 'Make the cards equal height',
        viewport: { width: 1280, height: 800 },
        files: ['steps/s1/a.png'],
      },
    ],
  },
  material: {
    entry: 'context.md',
    files: [
      { path: 'context.md', mediaType: 'text/markdown' },
      { path: 'steps/s1/a.png', mediaType: 'image/png' },
    ],
  },
  exchanges: [
    { question: { id: 'q1', text: 'Desktop only?', options: ['Yes', 'No'] }, answer: null },
  ],
  questionsLeft: 2,
  resume: null,
  checks: ['pnpm test'],
  policy: { protectedPaths: ['.github', 'CLAUDE.md'], maxFiles: 50, maxChangedLines: 2000 },
});

describe('agent-protocol', () => {
  it('takes a brief and refuses one at an unknown protocol or without steps', () => {
    expect(briefSchema.parse(brief())).toEqual(brief());
    expect(briefSchema.safeParse({ ...brief(), protocol: 2 }).success).toBe(false);
    expect(briefSchema.safeParse({ ...brief(), task: { title: 'x', steps: [] } }).success).toBe(
      false,
    );
    expect(briefSchema.safeParse({ ...brief(), baseSha: 'main' }).success).toBe(false);
  });

  it('names each way a run ends', () => {
    const usage = { turns: 3, durationMs: 1000, costUsd: 0.4 };
    const report = {
      outcome: 'change' as const,
      summary: 'Equal heights',
      changes: [{ file: 'src/Card.css', why: 'Grid stretch' }],
      verification: 'Ran the tests',
      assumptions: [],
      explanation: '',
    };
    for (const result of [
      { kind: 'change', head: 'b'.repeat(40), report },
      { kind: 'no-change', explanation: 'Already equal' },
      { kind: 'quota-exhausted', resetAt: '2026-11-09T12:00:00.000Z' },
      { kind: 'failed', reason: 'budget-exhausted', detail: 'Spent' },
      { kind: 'question', question: { text: 'Desktop only?', options: ['Yes', 'No'] } },
    ]) {
      expect(
        outcomeSchema.safeParse({ protocol: 1, runId: 'r', result, pause: null, usage }).success,
      ).toBe(true);
    }
    expect(
      outcomeSchema.safeParse({
        protocol: 1,
        runId: 'r',
        result: { kind: 'failed', reason: 'whatever', detail: '' },
        pause: null,
        usage,
      }).success,
    ).toBe(false);
  });

  it('keeps a question to what the extension shows', () => {
    const usage = { turns: 1, durationMs: 10, costUsd: 0 };
    const asking = (question: { text: string; options: string[] }) =>
      outcomeSchema.safeParse({
        protocol: 1,
        runId: 'r',
        result: { kind: 'question', question },
        pause: null,
        usage,
      }).success;
    expect(asking({ text: 'Which?', options: [] })).toBe(true);
    expect(asking({ text: '', options: [] })).toBe(false);
    expect(asking({ text: 'x'.repeat(QUESTION_LIMITS.text + 1), options: [] })).toBe(false);
    expect(asking({ text: 'Which?', options: [''] })).toBe(false);
    expect(
      asking({
        text: 'Which?',
        options: Array.from({ length: QUESTION_LIMITS.options + 1 }, String),
      }),
    ).toBe(false);
  });

  it('carries a paused session from the outcome that paused it to the brief that resumes it', () => {
    const pause = { sessionId: 'session-1', deferredCall: 'toolu_1', workHead: 'c'.repeat(40) };
    const outcome = outcomeSchema.parse({
      protocol: 1,
      runId: 'r',
      result: { kind: 'question', question: { text: 'Which?', options: [] } },
      pause,
      usage: { turns: 1, durationMs: 10, costUsd: 0 },
    });
    const resume = {
      sessionId: outcome.pause?.sessionId,
      workHead: outcome.pause?.workHead,
      deferred: { call: outcome.pause?.deferredCall, answer: { text: 'Desktop only' } },
    };
    expect(briefSchema.parse({ ...brief(), resume }).resume).toEqual(resume);
    expect(
      briefSchema.safeParse({ ...brief(), resume: { ...resume, workHead: 'main' } }).success,
    ).toBe(false);
    // Nobody answered in time, or the session waits on no call.
    for (const deferred of [{ call: 'toolu_1', answer: null }, null]) {
      expect(briefSchema.safeParse({ ...brief(), resume: { ...resume, deferred } }).success).toBe(
        true,
      );
    }
  });

  it('reads the gateway’s account of a refused grant and the run’s events', () => {
    expect(
      grantStatusSchema.parse({
        state: 'refused',
        refusal: GATEWAY_REFUSALS.quotaExhausted,
        resetAt: '2026-11-09T12:00:00.000Z',
      }),
    ).toMatchObject({ state: 'refused' });
    expect(grantStatusSchema.safeParse({ state: 'refused', refusal: 'other' }).success).toBe(false);
    expect(
      runEventSchema.parse({
        kind: 'tool',
        at: '2026-11-09T12:00:00.000Z',
        tool: 'Edit',
        target: 'a.ts',
      }),
    ).toMatchObject({ tool: 'Edit' });
  });
});
