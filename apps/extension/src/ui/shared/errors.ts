import type { AppErrorCode, AppErrorDetails } from '@redline/core';
import type { MessageKey, Translator } from '../../ports/i18n';

const BY_CODE: Readonly<Record<AppErrorCode, MessageKey>> = {
  validation: 'errorValidation',
  'not-found': 'errorNotFound',
  conflict: 'errorConflict',
  'permission-denied': 'errorPermissionDenied',
  'restricted-page': 'errorRestrictedPage',
  'receiver-unavailable': 'errorReceiverUnavailable',
  'not-configured': 'errorNotConfigured',
  'bridge-unavailable': 'errorBridgeUnavailable',
  quota: 'errorQuota',
  storage: 'errorStorage',
  timeout: 'errorTimeout',
  transport: 'errorTransport',
  internal: 'errorInternal',
};

const isKnownCode = (code: string): code is AppErrorCode => Object.hasOwn(BY_CODE, code);

type Details = Readonly<Record<string, unknown>>;

const detail = (details: Details, name: string): string => {
  const value = details[name];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
};

/**
 * Errors the user can act on carry a `reason` in their details; each has its own message,
 * filled from the details it names.
 */
const BY_REASON: Readonly<
  Record<string, { readonly key: MessageKey; readonly from?: readonly string[] }>
> = {
  'not-a-url': { key: 'errorNotAUrl' },
  'insecure-receiver': { key: 'errorInsecureReceiver' },
  'receiver-url-extras': { key: 'errorReceiverUrlExtras' },
  'not-a-site-pattern': { key: 'errorNotASitePattern' },
  'invalid-host': { key: 'errorInvalidHost' },
  'wildcard-needs-domain': { key: 'errorWildcardNeedsDomain' },
  'project-required': { key: 'errorProjectRequired' },
  'projects-differ': { key: 'projectConflict' },
  'bound-elsewhere': { key: 'errorBoundElsewhere', from: ['projectName'] },
  'comment-required': { key: 'errorCommentRequired' },
  'comment-too-long': { key: 'errorCommentTooLong', from: ['max'] },
  'title-too-long': { key: 'errorTitleTooLong', from: ['max'] },
  'answer-empty': { key: 'errorAnswerEmpty' },
  'not-waiting': { key: 'errorNotWaiting' },
  'token-refused': { key: 'errorTokenRefused' },
};

/** An application error, or one recorded on a task (whose code is kept as plain text). */
export interface DescribableError {
  readonly code: string;
  readonly message: string;
  readonly details?: AppErrorDetails | undefined;
}

/**
 * The user-facing text of an error. Errors without a known reason are described by their
 * code, with the technical message kept alongside for reports.
 */
export const describeError = (t: Translator, error: DescribableError): string => {
  const details: Details = error.details ?? {};
  const reason = BY_REASON[detail(details, 'reason')];
  if (reason !== undefined) {
    return t.text(reason.key, ...(reason.from ?? []).map((name) => detail(details, name)));
  }
  return t.text(
    'errorWithDetail',
    t.text(isKnownCode(error.code) ? BY_CODE[error.code] : 'errorInternal'),
    error.message,
  );
};
