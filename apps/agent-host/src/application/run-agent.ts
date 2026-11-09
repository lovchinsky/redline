import {
  AGENT_PROTOCOL_VERSION,
  EVENT_TEXT_LIMIT,
  type Brief,
  type OutcomeResult,
  type Pause,
  type RunEvent,
  type RunUsage,
} from '@redline/agent-protocol';
import { answerText } from '../domain/asking';
import { judgeToolUse } from '../domain/guard';
import { decideOutcome } from '../domain/outcome';
import { composePrompt, workingRules } from '../domain/prompt';
import type { SessionEnd, SessionResult, StopReason } from '../domain/session';
import type { AgentSession, SessionActivity, SessionStart } from '../ports/agent';
import type { Gateway, RunFiles, Workspace } from '../ports/run';
import type { Clock, Timers } from '../ports/system';

const clip = (text: string) =>
  text.length <= EVENT_TEXT_LIMIT ? text : `${text.slice(0, EVENT_TEXT_LIMIT - 1)}…`;

const NO_USAGE: RunUsage = { turns: 0, durationMs: 0, costUsd: 0 };

interface Concluded {
  readonly result: OutcomeResult;
  readonly pause: Pause | null;
  readonly usage: RunUsage;
}

/**
 * One run, start to end: reads the brief, runs the agent under the run's limits, takes its
 * change from the workspace and leaves the outcome for the receiver. A run that pauses (on a
 * question, the subscription's limit, a missing credential) leaves its work and session for a
 * later run to go on with. Every way the run can end ends with an outcome written, the run's
 * own failures included.
 */
export class RunAgent {
  /** The journal's lines written so far: each waits for the one before. */
  private journaled: Promise<void> = Promise.resolve();

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
    let concluded: Concluded;
    try {
      concluded = await this.attempt(brief);
    } catch (error) {
      concluded = {
        result: { kind: 'failed', reason: 'infra', detail: String(error) },
        pause: null,
        usage: NO_USAGE,
      };
    }
    this.record({ kind: 'ended', at: this.deps.clock.iso(), result: concluded.result.kind });
    // The journal is complete before the outcome says the run is over.
    await this.journaled;
    await this.deps.files.conclude({
      protocol: AGENT_PROTOCOL_VERSION,
      runId: brief.runId,
      result: concluded.result,
      pause: concluded.pause,
      usage: concluded.usage,
    });
    return concluded.result;
  }

  private async attempt(brief: Brief): Promise<Concluded> {
    const { session, stopped } = await this.supervised(brief, await this.startOf(brief));
    const { end, usage, sessionId } = session;
    const change =
      end.kind === 'completed' && end.report?.outcome === 'change'
        ? await this.deps.workspace.exportChange(brief.baseSha)
        : null;
    const gateway = end.kind === 'api-error' ? await this.deps.gateway.grantStatus() : null;
    const { result, pauses } = decideOutcome({ end, change, gateway, stopped });
    const pause = pauses && sessionId !== null ? await this.pauseOf(brief, end, sessionId) : null;
    return { result, pause, usage };
  }

  /**
   * Goes on with the paused session when the brief resumes one and its files are here; otherwise
   * starts a new session, told the exchanges so far.
   */
  private async startOf(brief: Brief): Promise<SessionStart> {
    const anew: SessionStart = { kind: 'new', prompt: composePrompt(brief) };
    const { resume } = brief;
    if (resume === null) return anew;
    if (!(await this.deps.session.stored(resume.sessionId))) {
      this.warn('The paused session’s files are not here: the run starts over');
      return anew;
    }
    if (resume.workHead !== null) {
      await this.deps.workspace.restoreWork(brief.baseSha, resume.workHead);
    }
    const { deferred } = resume;
    return {
      kind: 'resume',
      sessionId: resume.sessionId,
      answer: deferred === null ? null : { call: deferred.call, text: answerText(deferred.answer) },
    };
  }

  /**
   * Keeps the work so far for the run that goes on with this session. Without it the session
   * cannot go on, and a later run starts over instead.
   */
  private async pauseOf(brief: Brief, end: SessionEnd, sessionId: string): Promise<Pause | null> {
    try {
      const work = await this.deps.workspace.exportWork(brief.baseSha);
      return {
        sessionId,
        deferredCall: end.kind === 'asked' ? end.call : null,
        workHead: work?.head ?? null,
      };
    } catch (error) {
      this.warn(`The work so far could not be kept, so a later run starts over: ${String(error)}`);
      return null;
    }
  }

  /**
   * Runs the session, stopping it when the run takes too long or the agent goes quiet; `stopped`
   * says why, if it was stopped.
   */
  private async supervised(
    brief: Brief,
    start: SessionStart,
  ): Promise<{ readonly session: SessionResult; readonly stopped: StopReason | null }> {
    const controller = new AbortController();
    // The first reason is the one the session was stopped for.
    let stopped: StopReason | null = null;
    const stop = (why: StopReason) => () => {
      if (stopped !== null) return;
      stopped = why;
      controller.abort();
    };
    const cancelTimeout = this.deps.timers.after(brief.limits.timeoutMs, stop('timeout'));
    let cancelStall = this.deps.timers.after(brief.limits.stallTimeoutMs, stop('stalled'));
    const onLife = () => {
      cancelStall();
      cancelStall = this.deps.timers.after(brief.limits.stallTimeoutMs, stop('stalled'));
    };
    const onActivity = (activity: SessionActivity) => {
      this.record(this.eventOf(activity));
    };
    try {
      const session = await this.deps.session.run(
        {
          model: brief.model,
          rules: workingRules(brief),
          start,
          questionsLeft: brief.questionsLeft,
          maxTurns: brief.limits.maxTurns,
          budgetUsd: brief.limits.budgetUsd,
          judge: (use) => judgeToolUse(use, brief.policy.protectedPaths),
          onActivity,
          onLife,
        },
        controller.signal,
      );
      return { session, stopped };
    } finally {
      cancelTimeout();
      cancelStall();
    }
  }

  private eventOf(activity: SessionActivity): RunEvent {
    const at = this.deps.clock.iso();
    switch (activity.kind) {
      case 'started':
        return { kind: 'started', at, model: activity.model, resumed: activity.resumed };
      case 'turn':
        return { kind: 'turn', at, text: clip(activity.text) };
      case 'tool':
        return { kind: 'tool', at, tool: activity.tool, target: clip(activity.target) };
      case 'denied':
        return { kind: 'denied', at, tool: activity.tool, reason: clip(activity.reason) };
    }
  }

  private warn(text: string): void {
    this.record({ kind: 'warning', at: this.deps.clock.iso(), text: clip(text) });
  }

  /**
   * Appends to the journal, line after line in the order they happen. The journal is a trace: a
   * line that cannot be written does not end the run.
   */
  private record(event: RunEvent): void {
    this.journaled = this.journaled
      .then(() => this.deps.files.journal(event))
      .catch(() => undefined);
  }
}
