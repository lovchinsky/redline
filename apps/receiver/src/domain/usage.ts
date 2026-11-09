import type { Budget, CredentialKind } from './grant';

/** Tokens of one model response. */
export interface TokenUsage {
  readonly input: number;
  readonly output: number;
  readonly cacheWrite: number;
  readonly cacheRead: number;
}

/** A model's price, in dollars per million tokens of each kind. */
export interface ModelPrice {
  readonly input: number;
  readonly output: number;
  readonly cacheWrite: number;
  readonly cacheRead: number;
}

export const NO_USAGE: TokenUsage = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };

export const costOf = (usage: TokenUsage, price: ModelPrice): number =>
  (usage.input * price.input +
    usage.output * price.output +
    usage.cacheWrite * price.cacheWrite +
    usage.cacheRead * price.cacheRead) /
  1_000_000;

/**
 * Tokens a subscription's budget counts: those the model processed anew. Reading the cache is
 * what an agent does on every turn and costs a fraction; counting it would end runs on reading
 * their own context.
 */
export const countedTokens = (usage: TokenUsage): number =>
  usage.input + usage.output + usage.cacheWrite;

/** Whether a task that spent `spent` may make another model request. */
export const withinBudget = (spent: Budget, budget: Budget, kind: CredentialKind): boolean =>
  kind === 'api-key' ? spent.usd < budget.usd : spent.tokens < budget.tokens;
