import type { Instant, RunId, TaskId } from './ids';

/** Whose model credential a task runs with: the requester's own, or the operator's. */
export type CredentialSource = 'requester' | 'operator';

/** What a model credential is: an API key, or a subscription's token. */
export type CredentialKind = 'api-key' | 'subscription';

/** Spending of one task, or the most it may spend: dollars with an API key, tokens with a subscription. */
export interface Budget {
  readonly usd: number;
  readonly tokens: number;
}

/**
 * What a run's grant lets its sandbox do, fixed when the grant is issued. A grant is for one
 * phase: the setup phase reaches package registries and nothing else; the agent phase reaches
 * the model and nothing else.
 */
export type GrantTerms =
  | {
      readonly phase: 'setup';
      readonly runId: RunId;
      readonly taskId: TaskId;
      /** Hosts the setup may connect to (`egressAllows`). */
      readonly hosts: readonly string[];
    }
  | {
      readonly phase: 'agent';
      readonly runId: RunId;
      readonly taskId: TaskId;
      readonly model: string;
      readonly credentials: CredentialSource;
      /** The task's whole budget, across all its runs. */
      readonly budget: Budget;
    };

/** Why the gateway refused a run's request. */
export type GatewayRefusal =
  | { readonly kind: 'grant-revoked' }
  | { readonly kind: 'budget-exhausted' }
  | { readonly kind: 'credential-missing' }
  | { readonly kind: 'credential-refused' }
  | { readonly kind: 'quota-exhausted'; readonly resetAt: Instant }
  | { readonly kind: 'request-refused'; readonly detail: string };
