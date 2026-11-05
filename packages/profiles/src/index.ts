import type { Profiles } from '@redline/capture';

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
