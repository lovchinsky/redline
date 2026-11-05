import { appError, type AppError } from '@redline/core';

/** Maps IndexedDB failures to application errors. */
export const storageError = (cause: unknown, operation: string): AppError => {
  const name = cause instanceof DOMException || cause instanceof Error ? cause.name : 'Unknown';
  const message = cause instanceof Error ? cause.message : String(cause);
  return appError(name === 'QuotaExceededError' ? 'quota' : 'storage', `${operation} failed`, {
    name,
    message,
  });
};
