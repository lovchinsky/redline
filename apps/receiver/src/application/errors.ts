import type { RequestError } from '../ports/requests';

export type { RequestError };

export const notFound = (message = 'Unknown task'): RequestError => ({
  code: 'not-found',
  message,
});
export const conflictError = (message: string): RequestError => ({ code: 'conflict', message });
export const invalid = (message: string): RequestError => ({ code: 'invalid', message });

/** Why a task of a project that was removed from the configuration is cancelled. */
export const PROJECT_GONE = 'The project is no longer configured on this receiver';
