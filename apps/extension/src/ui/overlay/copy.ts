import type { RegionSummary } from '@redline/dom';
import type { MessageKey, Translator } from '../../ports/i18n';
import type { DraftProblem, ShapeResolution } from './capture-machine';

export const PROBLEM_MESSAGES: Readonly<Record<DraftProblem, MessageKey>> = {
  'comment-required': 'problemCommentRequired',
  'resolution-pending': 'problemResolutionPending',
  'empty-shape': 'problemEmptyShape',
  'commit-failed': 'problemCommitFailed',
};

const describeSummary = (t: Translator, summary: RegionSummary): string => {
  switch (summary.kind) {
    case 'elements':
      return summary.groups
        .map((group) =>
          group.count > 1 ? `${group.label} ×${t.number(group.count)}` : group.label,
        )
        .join(', ');
    case 'within-element':
      return t.text('regionInside', summary.container);
    case 'empty-space':
      return t.text('regionEmptySpace', summary.container);
  }
};

/** What a shape turned out to cover, in a few words. */
export const describeResolution = (t: Translator, resolution: ShapeResolution): string => {
  switch (resolution.status) {
    case 'pending':
      return t.text('resolutionPending');
    case 'empty':
      return t.text('resolutionEmpty');
    case 'resolved':
      return describeSummary(t, resolution.summary);
  }
};
