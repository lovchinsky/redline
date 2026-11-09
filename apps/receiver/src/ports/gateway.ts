import type { Budget, GatewayRefusal, GrantTerms } from '../domain/grant';
import type { Instant, RunId, TaskId } from '../domain/ids';
import type { ModelPrice, TokenUsage } from '../domain/usage';
import type { ModelCredential } from './access';

/** The grants the worker issues, as the gateway reads them, and its refusals of their runs. */
export interface GrantBook {
  /** The terms of the grant presented, or null when no such grant is in force. */
  terms(token: string): Promise<GrantTerms | null>;
  /** Why the gateway last refused the run; null when it did not, or let a request through since. */
  refusalOf(runId: RunId): Promise<GatewayRefusal | null>;
  /** Records the gateway's last refusal of the run, or (null) that a request went through. */
  setRefusal(runId: RunId, refusal: GatewayRefusal | null): Promise<void>;
}

export interface UsageEntry {
  readonly runId: RunId;
  readonly taskId: TaskId;
  readonly model: string;
  readonly usage: TokenUsage;
  readonly costUsd: number;
  readonly at: Instant;
}

/** What tasks spent on the model, response by response. */
export interface UsageLedger {
  record(entry: UsageEntry): Promise<void>;
  /** All a task has spent, over every run. */
  spent(taskId: TaskId): Promise<Budget>;
}

/** Prices of the models runs may use: what turns tokens into dollars of a budget. */
export interface PriceList {
  priceOf(model: string): ModelPrice | null;
}

export type AgentTerms = Extract<GrantTerms, { phase: 'agent' }>;

/** A model request let through: what it is forwarded with, and whose usage it is. */
export interface Admission {
  readonly terms: AgentTerms;
  readonly credential: ModelCredential;
  readonly model: string;
  readonly stream: boolean;
}

export type Admitted =
  | { readonly ok: true; readonly admission: Admission }
  | { readonly ok: false; readonly refusal: GatewayRefusal };

/** What the model's provider answered, as far as the gateway judges it. */
export interface ProviderAnswer {
  readonly status: number;
  /** When the subscription's limit ran out: the time it resets, if the provider said so. */
  readonly quotaResetAt: Instant | null;
}

export type GrantStatusView =
  { readonly state: 'active' } | { readonly state: 'refused'; readonly refusal: GatewayRefusal };

/** Which requests count against the budget: answers, not token counts. */
export type ModelEndpoint = 'messages' | 'count-tokens';

/** The gateway's model side, as its HTTP adapter drives it. */
export interface ModelAccess {
  /** Judges a request of the sandbox holding `token`, before anything is forwarded. */
  admit(token: string | null, body: unknown, endpoint: ModelEndpoint): Promise<Admitted>;
  /** Judges the provider's answer before it reaches the sandbox; null lets it through. */
  inspect(admission: Admission, answer: ProviderAnswer): Promise<GatewayRefusal | null>;
  /** Records what an answer used. */
  meter(admission: Admission, usage: TokenUsage): Promise<void>;
  /** Why the gateway last refused the run whose grant `token` is. */
  status(token: string | null): Promise<GrantStatusView>;
}

export type EgressDecision =
  { readonly ok: true; readonly runId: RunId } | { readonly ok: false; readonly detail: string };

/** The gateway's egress side, as its proxy drives it. */
export interface EgressAccess {
  authorize(token: string | null, host: string, port: number): Promise<EgressDecision>;
}
