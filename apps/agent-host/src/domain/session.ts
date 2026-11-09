import type { AgentReport, AskedQuestion, RunUsage } from '@redline/agent-protocol';

/** How the agent's session ended, before anything is concluded from it. */
export type SessionEnd =
  /** The agent finished its turn; `report` is null when its structured report was unusable. */
  | { readonly kind: 'completed'; readonly report: AgentReport | null }
  /**
   * The agent asked the requester: the session waits on the deferred call `call`. `question` is
   * null when what it asked cannot be shown to the requester.
   */
  | { readonly kind: 'asked'; readonly call: string; readonly question: AskedQuestion | null }
  | { readonly kind: 'max-turns' }
  /** The SDK's own estimate of the cost reached the run's budget. */
  | { readonly kind: 'budget' }
  /** A model request failed: the gateway refused it, or the model did. */
  | { readonly kind: 'api-error'; readonly status: number | null; readonly detail: string }
  /** The session failed in itself: the agent's process, a tool, the SDK. */
  | { readonly kind: 'error'; readonly detail: string }
  /** agent-host stopped the session, for a `StopReason` of its own. */
  | { readonly kind: 'stopped' };

/** Why agent-host stops a session: it ran out of time, or showed no sign of life. */
export type StopReason = 'timeout' | 'stalled';

export interface SessionResult {
  readonly end: SessionEnd;
  /** The session's id, to resume it by; null when it did not get as far as starting. */
  readonly sessionId: string | null;
  readonly usage: RunUsage;
}
