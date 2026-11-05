import * as z from 'zod/mini';

export const APP_ERROR_CODES = [
  'validation',
  'not-found',
  'permission-denied',
  'restricted-page',
  'receiver-unavailable',
  'bridge-unavailable',
  'quota',
  'storage',
  'timeout',
  'transport',
  'internal',
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

export type AppErrorDetails = Readonly<Record<string, unknown>>;

/** Serializable application error. Crosses context boundaries as plain data. */
export interface AppError {
  readonly code: AppErrorCode;
  readonly message: string;
  readonly details?: AppErrorDetails | undefined;
}

export const appErrorSchema = z.object({
  code: z.enum(APP_ERROR_CODES),
  message: z.string(),
  details: z.optional(z.record(z.string(), z.unknown())),
});

export const appError = (
  code: AppErrorCode,
  message: string,
  details?: AppErrorDetails,
): AppError => (details === undefined ? { code, message } : { code, message, details });

/** Normalizes an unknown thrown value into an AppError. */
export const toAppError = (cause: unknown, code: AppErrorCode = 'internal'): AppError => {
  if (cause instanceof Error) {
    return appError(code, cause.message, { name: cause.name });
  }
  return appError(code, typeof cause === 'string' ? cause : 'Unknown error');
};
