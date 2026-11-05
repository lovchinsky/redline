import { isErrorReason, type AppError, type DeliveryError } from '@redline/core';

/**
 * How the extension retries the receiver, for deliveries and status checks alike: failures
 * that may pass by themselves are retried after 30 s, doubling up to 30 min, never sooner than
 * the receiver asked with `Retry-After`. Anything else needs the user.
 */
const FIRST_RETRY_MS = 30_000;
const MAX_RETRY_MS = 30 * 60_000;

const TRANSIENT: ReadonlySet<AppError['code']> = new Set([
  'receiver-unavailable',
  'timeout',
  'transport',
  'not-configured',
]);

/** Whether the same request may succeed later without anyone changing anything. */
export const isTransient = (error: AppError): boolean => TRANSIENT.has(error.code);

const retryAfterSecOf = (error: AppError | undefined): number => {
  const value = error?.details?.['retryAfterSec'];
  return typeof value === 'number' ? value : 0;
};

/** When to try again after the `failures`-th failure in a row (counting from 1). */
export const nextRetryAt = (failures: number, now: number, error?: AppError): number =>
  now +
  Math.max(
    Math.min(MAX_RETRY_MS, FIRST_RETRY_MS * 2 ** Math.max(0, failures - 1)),
    retryAfterSecOf(error) * 1000,
  );

/** What a task keeps of a failure: enough to show it, including what the user can do. */
export const toDeliveryError = (error: AppError): DeliveryError => {
  const reason = error.details?.reason;
  return isErrorReason(reason)
    ? { code: error.code, message: error.message, reason }
    : { code: error.code, message: error.message };
};
