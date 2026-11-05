import type { Intent } from '@redline/core';

/** Text shared by every UI surface, ready to move to chrome.i18n. */

export const INTENT_LABELS: Readonly<Record<Intent, string>> = {
  text: 'Текст',
  style: 'Стиль',
  layout: 'Розміщення',
  bug: 'Баг',
  'new-element': 'Новий елемент',
};

const pluralRules = new Intl.PluralRules('uk');

/** Picks the Ukrainian plural form for `count`, e.g. `plural(3, AREA_FORMS)` → «області». */
export const plural = (count: number, forms: Readonly<Record<Intl.LDMLPluralRule, string>>) =>
  forms[pluralRules.select(count)];

export const AREA_FORMS: Readonly<Record<Intl.LDMLPluralRule, string>> = {
  zero: 'областей',
  one: 'область',
  two: 'області',
  few: 'області',
  many: 'областей',
  other: 'області',
};

export const STEP_FORMS: Readonly<Record<Intl.LDMLPluralRule, string>> = {
  zero: 'кроків',
  one: 'крок',
  two: 'кроки',
  few: 'кроки',
  many: 'кроків',
  other: 'кроку',
};
