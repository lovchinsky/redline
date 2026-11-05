import type { RegionSummary } from '@redline/dom';
import { AREA_FORMS, plural } from '../shared/copy';
import type { DraftProblem, ShapeResolution } from './capture-machine';

/** All user-facing overlay text in one place, ready to move to chrome.i18n. */

export const PROBLEM_MESSAGES: Record<DraftProblem, string> = {
  'comment-required': 'Опишіть, що потрібно змінити',
  'resolution-pending': 'Зачекайте, область ще аналізується',
  'empty-shape': 'В одній з областей нічого не знайдено — приберіть її або обведіть ще раз',
  'commit-failed': 'Не вдалося зберегти крок. Спробуйте ще раз',
};

const describeSummary = (summary: RegionSummary): string => {
  switch (summary.kind) {
    case 'elements':
      return summary.groups
        .map((group) => (group.count > 1 ? `${group.label} ×${String(group.count)}` : group.label))
        .join(', ');
    case 'within-element':
      return `Усередині ${summary.container}`;
    case 'empty-space':
      return `Порожнє місце в ${summary.container}`;
  }
};

export const describeResolution = (resolution: ShapeResolution): string => {
  switch (resolution.status) {
    case 'pending':
      return 'Визначаю, що обведено…';
    case 'empty':
      return 'Нічого не знайдено';
    case 'resolved':
      return describeSummary(resolution.summary);
  }
};

export const UI_TEXT = {
  armedHint: 'Обведіть область · клік — один елемент · Esc — вийти',
  commentLabel: 'Що змінити?',
  commentPlaceholder: 'Наприклад: зробити картки однакової висоти',
  removeLastShape: 'Прибрати останню область',
  cancel: 'Скасувати',
  submit: 'Зберегти крок',
  submitting: 'Зберігаю…',
  shapesTitle: (count: number) => `${String(count)} ${plural(count, AREA_FORMS)}`,
} as const;
