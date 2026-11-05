import type { CaptureProfile } from '@redline/capture';

/**
 * What every step collects: where it happened, what was circled, how it looked, how to find it
 * in the code, how it is laid out, and its markup. The user's comment says what to change; the
 * context does not depend on it, so nothing is missing when a request turns out broader.
 *
 * Declarative policy only: collectors know nothing about it, and the plan built from it is
 * validated against the registered collectors at start-up.
 */
export const captureProfile: CaptureProfile = {
  collectors: ['page-meta', 'region', 'screenshot', 'anchors', 'layout', 'dom-snapshot'],
};

/**
 * Token budget of one step's summary in `context.md`. Context over it is not lost: it moves
 * to `more-context.md`, ordered by priority.
 */
export const SUMMARY_TOKENS_PER_STEP = 1600;
