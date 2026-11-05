import type { Profiles } from '@redline/capture';
import type { Intent } from '@redline/core';

/** Collected for every step: where it happened, what was circled, how it looked, how to find it. */
const ESSENTIALS = ['page-meta', 'region', 'screenshot', 'anchors'] as const;

/**
 * Which context each intent needs. Declarative policy only: collectors do not know about
 * intents, and the planner validates this table against the registered collectors at start-up.
 */
export const profiles: Profiles = {
  text: { collectors: [...ESSENTIALS] },
  style: { collectors: [...ESSENTIALS, 'layout'] },
  layout: { collectors: [...ESSENTIALS, 'layout', 'dom-snapshot'] },
  bug: { collectors: [...ESSENTIALS, 'dom-snapshot'] },
  'new-element': { collectors: [...ESSENTIALS, 'layout', 'dom-snapshot'] },
};

/**
 * Token budget of one step's summary in `context.md`, by intent. Context over the budget is
 * not lost: it moves to `more-context.md`. Intents that need structure get more room.
 */
export const summaryTokens: Readonly<Record<Intent, number>> = {
  text: 900,
  style: 1400,
  layout: 1600,
  bug: 1600,
  'new-element': 1400,
};
