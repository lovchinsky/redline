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

/** What one model response takes out of a budget: dollars and counted tokens. */
export const spendingOf = (usage: TokenUsage, price: ModelPrice | null): Budget => ({
  usd: price === null ? 0 : costOf(usage, price),
  tokens: countedTokens(usage),
});

/** Bytes of a request per token of its input, as a reservation reckons them: on the high side. */
const BYTES_PER_TOKEN = 3;

/**
 * The most a request is reckoned to cost before it is sent: its input from its size, and all
 * the output it may ask for. Requests in flight hold this much of the task's budget, so that
 * requests sent together cannot together spend more than the task has.
 */
export const reservationOf = (
  request: { readonly bytes: number; readonly maxTokens: number },
  price: ModelPrice | null,
): Budget =>
  spendingOf(
    {
      input: Math.ceil(request.bytes / BYTES_PER_TOKEN),
      output: request.maxTokens,
      cacheWrite: 0,
      cacheRead: 0,
    },
    price,
  );

/**
 * Whether a request reserving `reservation` may go, with `spent` already taken from `budget`
 * (the reservations of requests in flight included): never past the budget. An API key's budget
 * is dollars; a subscription's, tokens.
 */
export const admits = (
  spent: Budget,
  reservation: Budget,
  budget: Budget,
  kind: CredentialKind,
): boolean =>
  kind === 'api-key'
    ? spent.usd + reservation.usd <= budget.usd
    : spent.tokens + reservation.tokens <= budget.tokens;
