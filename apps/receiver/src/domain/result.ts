/** The outcome of an operation that can be refused: the value, or why not. */
export type Result<T, E> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** Why an operation outside the domain did not happen; a `transient` fault may pass if retried. */
export interface Fault {
  readonly transient: boolean;
  readonly detail: string;
}
