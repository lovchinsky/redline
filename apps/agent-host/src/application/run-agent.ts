import {
  AGENT_PROTOCOL_VERSION,
  EVENT_TEXT_LIMIT,
  type Brief,
  type OutcomeResult,
  type RunEvent,
  type RunUsage,
} from '@redline/agent-protocol';
import { judgeToolUse } from '../domain/guard';
import { decideOutcome } from '../domain/outcome';
import { composePrompt, workingRules } from '../domain/prompt';
import type { SessionResult } from '../domain/session';
import type { AgentSession, SessionActivity } from '../ports/agent';
import type { Gateway, RunFiles, Workspace } from '../ports/run';
import type { Clock, Timers } from '../ports/system';

const clip = (text: string) =>
  text.length <= EVENT_TEXT_LIMIT ? text : `${text.slice(0, EVENT_TEXT_LIMIT - 1)}…`;

const NO_USAGE: RunUsage = { turns: 0, durationMs: 0, costUsd: 0 };

/**
 * One run, start to end: reads the brief, runs the agent under the run's limits, takes its
 * change from the workspace and leaves the outcome for the receiver. Every way the run can end
 * ends with an outcome written, the run's own failures included.
 */
export class RunAgent {
  constructor(
    private readonly deps: {
      readonly files: RunFiles;
      readonly session: AgentSession;
      readonly workspace: Workspace;
      readonly gateway: Gateway;
      readonly clock: Clock;
      readonly timers: Timers;
    },
  ) {}

  async execute(): Promise<OutcomeResult> {
    const brief = await this.deps.files.brief();
    let concluded: { result: OutcomeResult; usage: RunUsage };
    try {
      concluded = await this.attempt(brief);
    } catch (error) {
      concluded = {
        result: { kind: 'failed', reason: 'infra', detail: String(error) },
        usage: NO_USAGE,
      };
    }
    await this.record({ kind: 'ended', at: this.deps.clock.iso(), result: concluded.result.kind });
    await this.deps.files.conclude({
      protocol: AGENT_PROTOCOL_VERSION,
      runId: brief.runId,
      result: concluded.result,
      usage: concluded.usage,
    });
    return concluded.result;
  }

  private async attempt(brief: Brief): Promise<{ result: OutcomeResult; usage: RunUsage }> {
    const { end, usage } = await this.supervised(brief);
    const change =
      end.kind === 'completed' && end.report?.outcome === 'change'
        ? await this.deps.workspace.exportChange(brief.baseSha)
        : null;
    const gateway = end.kind === 'api-error' ? await this.deps.gateway.grantStatus() : null;
    return { result: decideOutcome({ end, change, gateway }), usage };
  }

  /** Runs the session, stopping it when the run takes too long or the agent goes quiet. */
  private async supervised(brief: Brief): Promise<SessionResult> {
    const controller = new AbortController();
    const stopped: { why: 'timeout' | 'stalled' | null } = { why: null };
    const stop = (why: 'timeout' | 'stalled') => () => {
      stopped.why ??= why;
      controller.abort();
    };
    const cancelTimeout = this.deps.timers.after(brief.limits.timeoutMs, stop('timeout'));
    let cancelStall = this.deps.timers.after(brief.limits.stallTimeoutMs, stop('stalled'));
    const onActivity = (activity: SessionActivity) => {
      cancelStall();
      cancelStall = this.deps.timers.after(brief.limits.stallTimeoutMs, stop('stalled'));
      void this.record(this.eventOf(activity));
    };
    try {
      const result = await this.deps.session.run(
        {
          model: brief.model,
          rules: workingRules(brief),
          prompt: composePrompt(brief),
          maxTurns: brief.limits.maxTurns,
          budgetUsd: brief.limits.budgetUsd,
          judge: (tool, input) => judgeToolUse(tool, input, brief.policy.protectedPaths),
          onActivity,
        },
        controller.signal,
      );
      return stopped.why === null
        ? result
        : { ...result, end: { kind: 'stopped', why: stopped.why } };
    } finally {
      cancelTimeout();
      cancelStall();
    }
  }

  private eventOf(activity: SessionActivity): RunEvent {
    const at = this.deps.clock.iso();
    switch (activity.kind) {
      case 'started':
        return { kind: 'started', at, model: activity.model };
      case 'turn':
        return { kind: 'turn', at, text: clip(activity.text) };
      case 'tool':
        return { kind: 'tool', at, tool: activity.tool, target: clip(activity.target) };
      case 'denied':
        return { kind: 'denied', at, tool: activity.tool, reason: clip(activity.reason) };
    }
  }

  /** The journal is a trace: a line that cannot be written does not end the run. */
  private async record(event: RunEvent): Promise<void> {
    try {
      await this.deps.files.journal(event);
    } catch {
      // The outcome, written last, is what the receiver acts on.
    }
  }
}
