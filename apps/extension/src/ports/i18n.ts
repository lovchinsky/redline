import type catalog from '../../public/_locales/en/messages.json';

/** A message of the extension's catalogs (`_locales/<lang>/messages.json`). */
export type MessageKey = keyof typeof catalog;

/** The forms every counted message defines, in every catalog. */
export const PLURAL_FORMS = ['one', 'few', 'many', 'other'] as const;
export type PluralForm = (typeof PLURAL_FORMS)[number];

/** A message with a form per plural category: `stepCount` stands for `stepCount_one` and so on. */
export type CountedKey = MessageKey extends infer Key
  ? Key extends `${infer Family}_other`
    ? Family
    : never
  : never;

/**
 * User-facing text in the browser's language. Every surface (pages, overlay, service worker)
 * gets one from its composition root; nothing else knows where the text comes from.
 */
export interface Translator {
  /** The language of the catalog in use, e.g. `uk`; numbers and times are formatted for it. */
  readonly locale: string;
  /** The message with `$1`…`$9` replaced by the substitutions. */
  text(key: MessageKey, ...substitutions: readonly string[]): string;
  /** The plural form for `count`; `$1` is the formatted count, further substitutions follow. */
  count(key: CountedKey, count: number, ...substitutions: readonly string[]): string;
  number(value: number): string;
  /** Hours and minutes. */
  time(epochMs: number): string;
  /** Date and time. */
  dateTime(epochMs: number): string;
}
