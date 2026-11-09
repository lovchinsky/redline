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

/** A model request let through, as its task's spending is kept. */
export interface MeteredRequest {
  readonly runId: RunId;
  readonly taskId: TaskId;
  readonly model: string;
}

/**
 * What tasks spend on the model, request by request. A request holds a reservation while it is
 * in flight, and its usage once answered: a reservation never settled stays counted, so what the
 * ledger shows is never less than what was spent.
 */
export interface UsageLedger {
  /**
   * Takes `amount` out of the task's budget for one request, if `admits` allows it given all the
   * task has spent and holds for requests in flight: judged and recorded at once, against every
   * other request of the task. Returns the reservation's id, or null when it is refused.
   */
  reserve(
    request: MeteredRequest,
    amount: Budget,
    admits: (spent: Budget) => boolean,
  ): Promise<string | null>;
  /** What the request used, in place of its reservation. Settling it again changes nothing. */
  settle(reservation: string, usage: TokenUsage, spending: Budget, at: Instant): Promise<void>;
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
  /** What the request holds of its task's budget; null for requests that cost nothing. */
  readonly reservation: string | null;
}

/** A model request as the sandbox sent it: its parsed body, and its size. */
export interface ModelRequest {
  readonly body: unknown;
  readonly bytes: number;
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
  admit(token: string | null, request: ModelRequest, endpoint: ModelEndpoint): Promise<Admitted>;
  /** Judges the provider's answer before it reaches the sandbox; null lets it through. */
  inspect(admission: Admission, answer: ProviderAnswer): Promise<GatewayRefusal | null>;
  /** Records what an answer used; null when the request used nothing. */
  meter(admission: Admission, usage: TokenUsage | null): Promise<void>;
  /** Why the gateway last refused the run whose grant `token` is. */
  status(token: string | null): Promise<GrantStatusView>;
}

export type EgressDecision =
  { readonly ok: true; readonly runId: RunId } | { readonly ok: false; readonly detail: string };

/** The gateway's egress side, as its proxy drives it. */
export interface EgressAccess {
  authorize(token: string | null, host: string, port: number): Promise<EgressDecision>;
}
