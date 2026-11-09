import { GATEWAY_REFUSALS, type AgentReport, type Brief } from '@redline/agent-protocol';
import { describe, expect, it } from 'vitest';
import type { SessionResult } from '../domain/session';
import { sampleBrief } from './testing/brief';
import {
  FixedGateway,
  FixedWorkspace,
  ManualTimers,
  MemoryRunFiles,
  ScriptedSession,
  fixedClock,
} from './testing/fakes';
import type { SessionRequest } from '../ports/agent';
import { RunAgent } from './run-agent';

const usage = { turns: 4, durationMs: 5000, costUsd: 0.8 };
const report: AgentReport = {
  outcome: 'change',
  summary: 'Equal heights',
  changes: [{ file: 'src/Card.css', why: 'stretch' }],
  verification: 'Tests pass',
  assumptions: [],
  explanation: '',
};

const setup = (
  script: (request: SessionRequest, signal: AbortSignal) => Promise<SessionResult>,
  options: {
    change?: { head: string } | null;
    work?: { head: string } | null | Error;
    gateway?: FixedGateway;
    brief?: Brief;
    sessions?: readonly string[];
  } = {},
) => {
  const files = new MemoryRunFiles(options.brief);
  const timers = new ManualTimers();
  const workspace = new FixedWorkspace(
    options.change === undefined ? { head: 'b'.repeat(40) } : options.change,
    options.work ?? null,
  );
  const gateway = options.gateway ?? new FixedGateway({ state: 'active' });
  const session = new ScriptedSession(script, options.sessions);
  const agent = new RunAgent({ files, session, workspace, gateway, clock: fixedClock, timers });
  return { agent, files, timers, workspace, gateway, session };
};

/** Lets the run get as far as its session: every pending promise settles first. */
const started = () => new Promise<void>((resolve) => setImmediate(resolve));

/** A session that waits until it is aborted. */
const hanging = (_request: SessionRequest, signal: AbortSignal) =>
  new Promise<SessionResult>((resolve) => {
    signal.addEventListener('abort', () => {
      resolve({ end: { kind: 'error', detail: 'aborted' }, sessionId: 'session-1', usage });
    });
  });

describe('RunAgent', () => {
  it('runs the agent on the brief and leaves its change as the outcome', async () => {
    const { agent, files, session, workspace } = setup((request) => {
      request.onActivity({ kind: 'tool', tool: 'Edit', target: 'src/Card.css' });
      return Promise.resolve({ end: { kind: 'completed', report }, sessionId: 'session-1', usage });
    });
    await agent.execute();
    expect(session.request).toMatchObject({ model: 'claude-opus-5-5', maxTurns: 40, budgetUsd: 5 });
    expect(session.request?.judge('Edit', { file_path: 'CLAUDE.md' }).allow).toBe(false);
    expect(workspace.exported).toBe(1);
    expect(files.outcome).toEqual({
      protocol: 1,
      runId: 'run-1',
      result: { kind: 'change', head: 'b'.repeat(40), report },
      pause: null,
      usage,
    });
    expect(files.events.map((event) => event.kind)).toEqual(['tool', 'ended']);
  });

  it('does not export a change the agent did not report', async () => {
    const { agent, workspace, files } = setup(() =>
      Promise.resolve({
        end: {
          kind: 'completed',
          report: { ...report, outcome: 'no-change', explanation: 'Fine as is' },
        },
        sessionId: 'session-1',
        usage,
      }),
    );
    await agent.execute();
    expect(workspace.exported).toBe(0);
    expect(files.outcome?.result).toEqual({ kind: 'no-change', explanation: 'Fine as is' });
  });

  it('stops an agent that goes quiet, and one that takes too long', async () => {
    for (const [ms, detail] of [
      [sampleBrief().limits.stallTimeoutMs, 'The agent stopped responding'],
      [sampleBrief().limits.timeoutMs, 'The run took longer than allowed'],
    ] as const) {
      const { agent, files, timers } = setup(hanging);
      const running = agent.execute();
      await started();
      timers.fire(ms);
      await running;
      expect(files.outcome?.result).toEqual({ kind: 'failed', reason: 'agent-failed', detail });
      expect(timers.pending.size).toBe(0);
    }
  });

  it('keeps an active agent alive: each sign of life restarts the stall timer', async () => {
    let request: SessionRequest | null = null;
    const { agent, files, timers } = setup((given, signal) => {
      request = given;
      return hanging(given, signal);
    });
    const running = agent.execute();
    await started();
    const stall = sampleBrief().limits.stallTimeoutMs;
    (request as SessionRequest | null)?.onActivity({ kind: 'turn', text: 'Looking at the cards' });
    expect([...timers.pending.values()].filter((timer) => timer.ms === stall)).toHaveLength(1);
    timers.fire(sampleBrief().limits.timeoutMs);
    await running;
    expect(files.outcome?.result).toMatchObject({ detail: 'The run took longer than allowed' });
  });

  it('asks the gateway why a model request failed', async () => {
    const gateway = new FixedGateway({
      state: 'refused',
      refusal: GATEWAY_REFUSALS.credentialMissing,
      resetAt: null,
    });
    const { agent, files } = setup(
      () =>
        Promise.resolve({
          end: { kind: 'api-error', status: 403, detail: 'refused' },
          sessionId: 'session-1',
          usage,
        }),
      { gateway },
    );
    await agent.execute();
    expect(gateway.asked).toBe(1);
    expect(files.outcome?.result).toMatchObject({ kind: 'failed', reason: 'credential-missing' });
    // The session waits for the credential, and goes on where it stopped.
    expect(files.outcome?.pause).toEqual({
      sessionId: 'session-1',
      deferredCall: null,
      workHead: null,
    });
  });

  it('writes an outcome even when the run itself fails', async () => {
    const { agent, files } = setup(() => Promise.reject(new Error('spawn ENOENT')));
    await agent.execute();
    expect(files.outcome?.result).toEqual({
      kind: 'failed',
      reason: 'infra',
      detail: 'Error: spawn ENOENT',
    });
  });

  describe('questions', () => {
    const asked = (input: unknown) => () =>
      Promise.resolve<SessionResult>({
        end: { kind: 'asked', call: 'toolu_1', input },
        sessionId: 'session-1',
        usage,
      });

    it('tells the agent how many questions it may ask', async () => {
      const { agent, session } = setup(asked({ question: 'Desktop only?' }), {
        brief: sampleBrief({ questionsLeft: 2 }),
      });
      await agent.execute();
      expect(session.request?.questionsLeft).toBe(2);
      expect(session.request?.rules).toContain('2 more question(s) with ask_requester');
    });

    it('ends the run with the question, and keeps the work and session to go on with', async () => {
      const work = { head: 'c'.repeat(40) };
      const { agent, files, workspace } = setup(
        asked({ question: '  Desktop only?  ', options: ['Yes', 'No'] }),
        { work, brief: sampleBrief({ questionsLeft: 1 }) },
      );
      await agent.execute();
      expect(files.outcome?.result).toEqual({
        kind: 'question',
        question: { text: 'Desktop only?', options: ['Yes', 'No'] },
      });
      expect(files.outcome?.pause).toEqual({
        sessionId: 'session-1',
        deferredCall: 'toolu_1',
        workHead: work.head,
      });
      expect(workspace.exported).toBe(0);
    });

    it('fails a run whose question the requester could not be shown', async () => {
      const { agent, files } = setup(asked({ question: '' }), {
        brief: sampleBrief({ questionsLeft: 1 }),
      });
      await agent.execute();
      expect(files.outcome?.result).toMatchObject({ kind: 'failed', reason: 'agent-failed' });
      expect(files.outcome?.pause).toBeNull();
    });

    it('asks anyway when the work cannot be kept: a later run starts over', async () => {
      const { agent, files } = setup(asked({ question: 'Desktop only?' }), {
        work: new Error('disk full'),
        brief: sampleBrief({ questionsLeft: 1 }),
      });
      await agent.execute();
      expect(files.outcome?.result.kind).toBe('question');
      expect(files.outcome?.pause).toBeNull();
    });
  });

  describe('resuming', () => {
    const question = { id: 'q1', text: 'Desktop only?', options: ['Yes', 'No'] };
    const resumed = (answer: { text: string } | null) =>
      sampleBrief({
        exchanges: [{ question, answer }],
        questionsLeft: 1,
        resume: { sessionId: 'session-1', deferredCall: 'toolu_1', workHead: 'c'.repeat(40) },
      });
    const completes = () =>
      Promise.resolve<SessionResult>({
        end: { kind: 'completed', report },
        sessionId: 'session-1',
        usage,
      });

    it('restores the work and answers the call the session waits on', async () => {
      const { agent, session, workspace, files } = setup(completes, {
        brief: resumed({ text: 'Desktop only' }),
        sessions: ['session-1'],
      });
      await agent.execute();
      expect(workspace.restored).toEqual([{ baseSha: 'a'.repeat(40), head: 'c'.repeat(40) }]);
      expect(session.request?.start).toEqual({
        kind: 'resume',
        sessionId: 'session-1',
        answer: { call: 'toolu_1', text: 'Desktop only' },
      });
      expect(files.outcome?.result.kind).toBe('change');
    });

    it('tells the session nobody answered in time', async () => {
      const { agent, session } = setup(completes, {
        brief: resumed(null),
        sessions: ['session-1'],
      });
      await agent.execute();
      expect(session.request?.start).toMatchObject({
        answer: {
          call: 'toolu_1',
          text: expect.stringContaining('Nobody answered in time') as string,
        },
      });
    });

    it('goes on without an answer with a session that paused for another reason', async () => {
      const { agent, session } = setup(completes, {
        brief: sampleBrief({
          resume: { sessionId: 'session-1', deferredCall: null, workHead: null },
        }),
        sessions: ['session-1'],
      });
      await agent.execute();
      expect(session.request?.start).toEqual({
        kind: 'resume',
        sessionId: 'session-1',
        answer: null,
      });
    });

    it('starts over, told the exchanges so far, when the session’s files are not here', async () => {
      const { agent, session, workspace } = setup(completes, {
        brief: resumed({ text: 'Desktop only' }),
      });
      await agent.execute();
      expect(workspace.restored).toEqual([]);
      const start = session.request?.start;
      expect(start?.kind).toBe('new');
      const text =
        start?.kind === 'new'
          ? start.prompt.map((part) => (part.kind === 'text' ? part.text : '')).join('\n')
          : '';
      expect(text).toContain('The requester answered: Desktop only');
    });
  });
});
