import type { Intent } from '@redline/core';
import type { RegionSummary } from '@redline/dom';
import type { DraftProblem, ShapeResolution } from './capture-machine';

/** All user-facing overlay text in one place, ready to move to chrome.i18n. */

export const INTENT_LABELS: Record<Intent, string> = {
  text: 'Текст',
  style: 'Стиль',
  layout: 'Розміщення',
  bug: 'Баг',
  'new-element': 'Новий елемент',
};

export const PROBLEM_MESSAGES: Record<DraftProblem, string> = {
  'comment-required': 'Опишіть, що потрібно змінити',
  'intent-required': 'Оберіть тип правки',
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

const pluralRules = new Intl.PluralRules('uk');
const AREA_FORMS: Record<Intl.LDMLPluralRule, string> = {
  zero: 'областей',
  one: 'область',
  two: 'області',
  few: 'області',
  many: 'областей',
  other: 'області',
};

export const UI_TEXT = {
  armedHint: 'Обведіть область · клік — один елемент · Esc — вийти',
  commentLabel: 'Що змінити?',
  commentPlaceholder: 'Наприклад: зробити картки однакової висоти',
  intentLabel: 'Тип правки',
  removeLastShape: 'Прибрати останню область',
  cancel: 'Скасувати',
  submit: 'Зберегти крок',
  submitting: 'Зберігаю…',
  shapesTitle: (count: number) => `${String(count)} ${AREA_FORMS[pluralRules.select(count)]}`,
} as const;
