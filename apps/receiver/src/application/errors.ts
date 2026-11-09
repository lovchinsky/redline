/** Why a request to the receiver is refused, in terms the HTTP adapter maps to the contract. */
export type RequestError =
  /** No such task for this requester: unknown, someone else's, or no longer kept. */
  | { readonly code: 'not-found'; readonly message: string }
  /** The task's state does not allow it, e.g. answering a question that is not open. */
  | { readonly code: 'conflict'; readonly message: string }
  /** The request itself is wrong: an unknown project, a credential of a refused kind. */
  | { readonly code: 'invalid'; readonly message: string };

export const notFound = (message = 'Unknown task'): RequestError => ({
  code: 'not-found',
  message,
});
export const conflictError = (message: string): RequestError => ({ code: 'conflict', message });
export const invalid = (message: string): RequestError => ({ code: 'invalid', message });

/** Why a task of a project that was removed from the configuration is cancelled. */
export const PROJECT_GONE = 'The project is no longer configured on this receiver';
