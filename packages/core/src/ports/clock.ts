/** Epoch milliseconds. */
export type Instant = number;

export interface Clock {
  now(): Instant;
}
