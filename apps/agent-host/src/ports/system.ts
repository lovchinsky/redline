export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
  /** The same instant as an ISO 8601 string. */
  iso(): string;
}

export interface Timers {
  /** Calls `callback` after `ms`, unless the returned function is called first. */
  after(ms: number, callback: () => void): () => void;
}
