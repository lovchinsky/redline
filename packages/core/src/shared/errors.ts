import * as z from 'zod/mini';

export const APP_ERROR_CODES = [
  'validation',
  'not-found',
  'conflict',
  'permission-denied',
  'restricted-page',
  'receiver-unavailable',
  'not-configured',
  'bridge-unavailable',
  'quota',
  'storage',
  'timeout',
  'transport',
  'internal',
] as const;

export type AppErrorCode = (typeof APP_ERROR_CODES)[number];

/**
 * Errors the user can act on name their reason, and the UI has a message for every one of them:
 * the list is closed, so a new reason cannot ship without its wording.
 */
export const ERROR_REASONS = [
  // Capture cannot run on the page (see `CaptureUnavailableReason`).
  'browser-page',
  'web-store',
  'unsupported-scheme',
  'no-access',
  'not-a-url',
  'insecure-receiver',
  'receiver-url-extras',
  'not-a-site-pattern',
  'invalid-host',
  'wildcard-needs-domain',
  'project-required',
  'projects-differ',
  'bound-elsewhere',
  'draft-changed',
  'comment-required',
  'comment-too-long',
  'title-too-long',
  'answer-empty',
  'not-waiting',
  'token-refused',
] as const;

export type ErrorReason = (typeof ERROR_REASONS)[number];

export const isErrorReason = (value: unknown): value is ErrorReason =>
  (ERROR_REASONS as readonly unknown[]).includes(value);

/** Facts about an error, for logs and for the message of its `reason`. */
export type AppErrorDetails = Readonly<Record<string, unknown>> & {
  readonly reason?: ErrorReason;
};

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
