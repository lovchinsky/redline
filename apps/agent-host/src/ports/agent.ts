import type { ToolDecision } from '../domain/guard';
import type { PromptPart } from '../domain/prompt';
import type { SessionResult } from '../domain/session';

/** Something the agent did, as the session reports it while it runs. */
export type SessionActivity =
  | { readonly kind: 'started'; readonly model: string }
  | { readonly kind: 'turn'; readonly text: string }
  | { readonly kind: 'tool'; readonly tool: string; readonly target: string }
  | { readonly kind: 'denied'; readonly tool: string; readonly reason: string };

export interface SessionRequest {
  readonly model: string;
  /** How the agent works, on top of the agent's own system prompt. */
  readonly rules: string;
  readonly prompt: readonly PromptPart[];
  readonly maxTurns: number;
  readonly budgetUsd: number | null;
  /** Asked before every tool call; a denied call is refused and the agent told why. */
  readonly judge: (tool: string, input: unknown) => ToolDecision;
  /** Called on everything the agent does: the run's journal and its sign of life. */
  readonly onActivity: (activity: SessionActivity) => void;
}

/** One session of the coding agent in the workspace, from the first message to its report. */
export interface AgentSession {
  /** Runs until the agent ends its turn or `signal` aborts; never throws for the agent's failures. */
  run(request: SessionRequest, signal: AbortSignal): Promise<SessionResult>;
}
