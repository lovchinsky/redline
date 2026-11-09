import * as z from 'zod/mini';

/**
 * Why the gateway refuses a run's model request. It answers with status 403 and an
 * Anthropic-style error body whose `error.type` is one of these, so the agent sees a request
 * error it does not retry.
 */
export const GATEWAY_REFUSALS = {
  /** The task has spent its budget. */
  budgetExhausted: 'redline_budget_exhausted',
  /** The run's grant was revoked or never issued: the run is over. */
  grantRevoked: 'redline_grant_revoked',
  /** The requester's credential is not in the gateway's memory (it restarted). */
  credentialMissing: 'redline_credential_missing',
  /** The model refused the credential the task runs with. */
  credentialRefused: 'redline_credential_refused',
  /** The subscription's session or weekly limit ran out. */
  quotaExhausted: 'redline_quota_exhausted',
  /** The request asks for something a run may not use: a server tool, MCP, another model. */
  requestRefused: 'redline_request_refused',
} as const;

/**
 * `GET` with the run's grant, answered by the gateway with `grantStatusSchema`: why the gateway
 * last refused the run, so agent-host can tell an exhausted budget from a failed agent without
 * reading error text.
 */
export const GRANT_STATUS_PATH = '/redline/v1/grant';

export const grantStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('active') }),
  z.object({
    state: z.literal('refused'),
    refusal: z.enum([
      GATEWAY_REFUSALS.budgetExhausted,
      GATEWAY_REFUSALS.grantRevoked,
      GATEWAY_REFUSALS.credentialMissing,
      GATEWAY_REFUSALS.credentialRefused,
      GATEWAY_REFUSALS.quotaExhausted,
      GATEWAY_REFUSALS.requestRefused,
    ]),
    /** When the refusal is `quotaExhausted`: when the limit resets. */
    resetAt: z.nullable(z.iso.datetime()),
  }),
]);

export type GrantStatus = z.infer<typeof grantStatusSchema>;
