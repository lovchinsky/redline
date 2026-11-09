import type { PendingAnswer } from '../domain/asking';
import type { ToolDecision } from '../domain/guard';
import type { PromptPart } from '../domain/prompt';
import type { SessionResult } from '../domain/session';

/** Something the agent did, as the session reports it while it runs. */
export type SessionActivity =
  | { readonly kind: 'started'; readonly model: string; readonly resumed: boolean }
  | { readonly kind: 'turn'; readonly text: string }
  | { readonly kind: 'tool'; readonly tool: string; readonly target: string }
  | { readonly kind: 'denied'; readonly tool: string; readonly reason: string };

/** How a session begins: a new one with its first message, or a paused one going on. */
export type SessionStart =
  | { readonly kind: 'new'; readonly prompt: readonly PromptPart[] }
  /** Answers the deferred call the session waits on; with none, the session is told to go on. */
  | { readonly kind: 'resume'; readonly sessionId: string; readonly answer: PendingAnswer | null };

/** Why agent-host stops a session: it ran out of time, or showed no sign of life. */
export type StopReason = 'timeout' | 'stalled';

export const isStopReason = (reason: unknown): reason is StopReason =>
  reason === 'timeout' || reason === 'stalled';

export interface SessionRequest {
  readonly model: string;
  /** How the agent works, on top of the agent's own system prompt. */
  readonly rules: string;
  readonly start: SessionStart;
  /** How many more questions the agent may ask the requester. */
  readonly questionsLeft: number;
  readonly maxTurns: number;
  readonly budgetUsd: number | null;
  /** Asked before every tool call; a denied call is refused and the agent told why. */
  readonly judge: (tool: string, input: unknown) => ToolDecision;
  /** Called on what the agent does that is worth a line of the run's journal. */
  readonly onActivity: (activity: SessionActivity) => void;
  /** Called on everything the session sends, progress included: its sign of life. */
  readonly onLife: () => void;
}

/** One session of the coding agent in the workspace, from the first message to its report. */
export interface AgentSession {
  /**
   * Runs until the agent ends its turn or `stop` aborts, with a `StopReason` as its reason: a
   * session stopped before its result ends `stopped`. Never throws for the agent's failures.
   */
  run(request: SessionRequest, stop: AbortSignal): Promise<SessionResult>;
  /** Whether the files of session `sessionId` are here, so that it can be resumed. */
  stored(sessionId: string): Promise<boolean>;
}
