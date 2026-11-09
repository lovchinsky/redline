import type { Instant, QuestionId } from './ids';

/** A question the agent asks the person who requested the change. */
export interface Question {
  readonly id: QuestionId;
  readonly text: string;
  /** Suggested answers; the person may still answer in their own words. */
  readonly options: readonly string[];
}

/**
 * How a question was settled: the requester answered it, or nobody did in time and the agent
 * goes on with its own judgement, stating its assumptions.
 */
export type Answer =
  | { readonly source: 'requester'; readonly text: string; readonly at: Instant }
  | { readonly source: 'timeout'; readonly at: Instant };

/** One question and, once settled, its answer. A task holds them in the order asked. */
export interface Exchange {
  readonly question: Question;
  readonly askedAt: Instant;
  readonly answer: Answer | null;
  /** A run has gone on from the exchange as it stood: its answer no longer changes. */
  readonly closed: boolean;
}

export const openExchange = (exchanges: readonly Exchange[]): Exchange | null => {
  const last = exchanges.at(-1);
  return last !== undefined && last.answer === null ? last : null;
};

export const lastExchange = (exchanges: readonly Exchange[]): Exchange | null =>
  exchanges.at(-1) ?? null;

/** The exchanges with the last one settled by `answer`. */
export const settleLast = (exchanges: readonly Exchange[], answer: Answer): readonly Exchange[] => {
  const last = exchanges.at(-1);
  return last === undefined ? exchanges : [...exchanges.slice(0, -1), { ...last, answer }];
};
