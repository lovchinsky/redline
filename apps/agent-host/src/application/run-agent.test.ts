import { GATEWAY_REFUSALS, type AgentReport } from '@redline/agent-protocol';
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
  options: { change?: { head: string } | null; gateway?: FixedGateway } = {},
) => {
  const files = new MemoryRunFiles();
  const timers = new ManualTimers();
  const workspace = new FixedWorkspace(
    options.change === undefined ? { head: 'b'.repeat(40) } : options.change,
  );
  const gateway = options.gateway ?? new FixedGateway({ state: 'active' });
  const session = new ScriptedSession(script);
  const agent = new RunAgent({ files, session, workspace, gateway, clock: fixedClock, timers });
  return { agent, files, timers, workspace, gateway, session };
};

/** A session that waits until it is aborted. */
const hanging = (_request: SessionRequest, signal: AbortSignal) =>
  new Promise<SessionResult>((resolve) => {
    signal.addEventListener('abort', () => {
      resolve({ end: { kind: 'error', detail: 'aborted' }, usage });
    });
  });

describe('RunAgent', () => {
  it('runs the agent on the brief and leaves its change as the outcome', async () => {
    const { agent, files, session, workspace } = setup((request) => {
      request.onActivity({ kind: 'tool', tool: 'Edit', target: 'src/Card.css' });
      return Promise.resolve({ end: { kind: 'completed', report }, usage });
    });
    await agent.execute();
    expect(session.request).toMatchObject({ model: 'claude-opus-5-5', maxTurns: 40, budgetUsd: 5 });
    expect(session.request?.judge('Edit', { file_path: 'CLAUDE.md' }).allow).toBe(false);
    expect(workspace.exported).toBe(1);
    expect(files.outcome).toEqual({
      protocol: 1,
      runId: 'run-1',
      result: { kind: 'change', head: 'b'.repeat(40), report },
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
      await Promise.resolve();
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
    await Promise.resolve();
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
      () => Promise.resolve({ end: { kind: 'api-error', status: 403, detail: 'refused' }, usage }),
      { gateway },
    );
    await agent.execute();
    expect(gateway.asked).toBe(1);
    expect(files.outcome?.result).toMatchObject({ kind: 'failed', reason: 'credential-missing' });
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
});
