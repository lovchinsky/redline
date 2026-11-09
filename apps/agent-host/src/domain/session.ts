import type { AgentReport, RunUsage } from '@redline/agent-protocol';

/** How the agent's session ended, before anything is concluded from it. */
export type SessionEnd =
  /** The agent finished its turn; `report` is null when its structured report was unusable. */
  | { readonly kind: 'completed'; readonly report: AgentReport | null }
  | { readonly kind: 'max-turns' }
  /** The SDK's own estimate of the cost reached the run's budget. */
  | { readonly kind: 'budget' }
  /** A model request failed: the gateway refused it, or the model did. */
  | { readonly kind: 'api-error'; readonly status: number | null; readonly detail: string }
  /** The session failed in itself: the agent's process, a tool, the SDK. */
  | { readonly kind: 'error'; readonly detail: string }
  /** agent-host stopped the session: it ran out of time or showed no sign of life. */
  | { readonly kind: 'stopped'; readonly why: 'timeout' | 'stalled' };

export interface SessionResult {
  readonly end: SessionEnd;
  readonly usage: RunUsage;
}
