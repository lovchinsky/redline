import type { GatewayRefusal } from '../domain/grant';
import { EGRESS_PORT, egressAllows } from '../domain/egress';
import { judgeModelRequest } from '../domain/model-request';
import { NO_USAGE, admits, reservationOf, spendingOf } from '../domain/usage';
import type { HeldCredentials, ModelCredential } from '../ports/access';
import type {
  Admission,
  Admitted,
  AgentTerms,
  EgressAccess,
  EgressDecision,
  GrantBook,
  GrantStatusView,
  ModelAccess,
  ModelEndpoint,
  PriceList,
  ProviderAnswer,
  RequestUsage,
  UsageLedger,
} from '../ports/gateway';
import type { Clock, Logger } from '../ports/system';

/**
 * The sandbox's one way to the model. A request is let through only with a grant in force for
 * the agent phase, only as the grant's terms and the request rules allow, only while the task
 * has budget left, and with the credential the task runs with put in place of the grant. Each
 * answer's usage is metered against the task. Why the gateway last refused a run is kept with
 * the run's grants, for the run and its worker to read.
 */
export class ModelGateway implements ModelAccess {
  constructor(
    private readonly deps: {
      readonly grants: GrantBook;
      readonly ledger: UsageLedger;
      readonly prices: PriceList;
      readonly requesters: HeldCredentials;
      /** The operator's own credential; null when tasks run with requesters' only. */
      readonly operator: ModelCredential | null;
      readonly maxTokens: number;
      readonly clock: Clock;
      readonly logger: Logger;
    },
  ) {}

  async admit(token: string | null, body: unknown, endpoint: ModelEndpoint): Promise<Admitted> {
    const terms = token === null ? null : await this.deps.grants.terms(token);
    if (terms?.phase !== 'agent') return { ok: false, refusal: { kind: 'grant-revoked' } };
    const refuse = async (refusal: GatewayRefusal): Promise<Admitted> => {
      await this.remember(terms, refusal);
      return { ok: false, refusal };
    };

    const verdict = judgeModelRequest(body, {
      models: [terms.model],
      maxTokens: this.deps.maxTokens,
    });
    if (!verdict.admitted) return refuse({ kind: 'request-refused', detail: verdict.detail });
    const credential =
      terms.credentials === 'operator'
        ? this.deps.operator
        : this.deps.requesters.credentialOf(terms.taskId);
    if (credential === null) return refuse({ kind: 'credential-missing' });
    const price = this.deps.prices.priceOf(verdict.model);
    if (credential.kind === 'api-key' && price === null) {
      return refuse({ kind: 'request-refused', detail: `No price is set for ${verdict.model}` });
    }
    let reservation: string | null = null;
    if (endpoint === 'messages') {
      // The request holds the most it can cost until its answer says what it did cost.
      const amount = reservationOf(verdict, price);
      reservation = await this.deps.ledger.reserve(
        { runId: terms.runId, taskId: terms.taskId, model: verdict.model },
        amount,
        (spent) => admits(spent, amount, terms.budget, credential.kind),
      );
      if (reservation === null) return refuse({ kind: 'budget-exhausted' });
    }
    await this.deps.grants.setRefusal(terms.runId, null);
    return {
      ok: true,
      admission: {
        terms,
        credential,
        model: verdict.model,
        stream: verdict.stream,
        reservation,
      },
    };
  }

  /**
   * Judges the provider's answer before it reaches the sandbox: a refused credential and a
   * spent subscription limit end the run in a way it can name; any other answer passes.
   */
  async inspect(admission: Admission, answer: ProviderAnswer): Promise<GatewayRefusal | null> {
    const refusal: GatewayRefusal | null =
      answer.status === 401 || answer.status === 403
        ? { kind: 'credential-refused' }
        : answer.status === 429 &&
            admission.credential.kind === 'subscription' &&
            answer.quotaResetAt !== null
          ? { kind: 'quota-exhausted', resetAt: answer.quotaResetAt }
          : null;
    if (refusal !== null) await this.remember(admission.terms, refusal);
    return refusal;
  }

  /**
   * Settles the request's reservation with what it used. A request whose usage is not known
   * keeps its reservation, the most it could have cost: the task is never taken to have spent
   * less than it did.
   */
  async meter(admission: Admission, used: RequestUsage): Promise<void> {
    if (admission.reservation === null) return;
    if (used.kind === 'unknown') {
      this.deps.logger.warn('A model answer did not say what it used: it counts as reserved', {
        runId: admission.terms.runId,
        taskId: admission.terms.taskId,
      });
      return;
    }
    const usage = used.kind === 'measured' ? used.usage : NO_USAGE;
    await this.deps.ledger.settle(
      admission.reservation,
      usage,
      spendingOf(usage, this.deps.prices.priceOf(admission.model)),
      this.deps.clock.now(),
    );
  }

  /** Why the gateway last refused the run whose grant this is. */
  async status(token: string | null): Promise<GrantStatusView> {
    const terms = token === null ? null : await this.deps.grants.terms(token);
    if (terms?.phase !== 'agent') return { state: 'refused', refusal: { kind: 'grant-revoked' } };
    const refusal = await this.deps.grants.refusalOf(terms.runId);
    return refusal === null ? { state: 'active' } : { state: 'refused', refusal };
  }

  private async remember(terms: AgentTerms, refusal: GatewayRefusal): Promise<void> {
    await this.deps.grants.setRefusal(terms.runId, refusal);
    this.deps.logger.warn('Refused a model request', {
      runId: terms.runId,
      taskId: terms.taskId,
      refusal: refusal.kind,
    });
  }
}

/**
 * The setup sandbox's way to package registries: a tunnel to a listed host on the TLS port,
 * with a setup grant in force. Where the name leads is checked when it is resolved.
 */
export class EgressGate implements EgressAccess {
  constructor(private readonly deps: { readonly grants: GrantBook; readonly logger: Logger }) {}

  async authorize(token: string | null, host: string, port: number): Promise<EgressDecision> {
    const terms = token === null ? null : await this.deps.grants.terms(token);
    if (terms?.phase !== 'setup') return { ok: false, detail: 'No setup grant in force' };
    const refuse = (detail: string): EgressDecision => {
      this.deps.logger.warn('Refused a connection', { runId: terms.runId, host, port, detail });
      return { ok: false, detail };
    };
    if (port !== EGRESS_PORT) return refuse(`Only port ${String(EGRESS_PORT)} is reachable`);
    if (!egressAllows(terms.hosts, host)) return refuse(`${host} is not on the project's list`);
    return { ok: true, runId: terms.runId };
  }
}
