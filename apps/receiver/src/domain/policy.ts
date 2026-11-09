/** How patient a task is: the limits of one project, from the receiver's configuration. */
export interface TaskPolicy {
  /** Questions the agent may ask the requester in one task. */
  readonly maxQuestions: number;
  /** Runs a task may lose to infrastructure failures before it fails. */
  readonly maxRunAttempts: number;
  /** Attempts to publish a change before the task fails. */
  readonly maxPublishAttempts: number;
  /** How long a question waits for its answer. */
  readonly replyTimeoutMs: number;
  /** What an unanswered question leads to: the agent goes on with assumptions, or the task fails. */
  readonly onReplyTimeout: 'proceed' | 'fail';
  /** First delay before a retry; each next retry waits twice as long, up to `retryMaxMs`. */
  readonly retryBaseMs: number;
  readonly retryMaxMs: number;
}

/** Delay before retry number `attempt` (1 for the first retry). */
export const retryDelay = (policy: TaskPolicy, attempt: number): number =>
  Math.min(policy.retryMaxMs, policy.retryBaseMs * 2 ** Math.max(0, attempt - 1));
