import {
  PLURAL_FORMS,
  type CountedKey,
  type MessageKey,
  type PluralForm,
  type Translator,
} from '../../ports/i18n';

/** Where messages come from: `chrome.i18n` in the extension, a catalog in tests. */
export interface MessageSource {
  message(key: MessageKey, substitutions: readonly string[]): string;
}

const isPluralForm = (form: string): form is PluralForm =>
  (PLURAL_FORMS as readonly string[]).includes(form);

/**
 * Translator over a message source. The catalog names its own language (`locale`), so
 * plural forms and number formats follow the text actually shown, not the browser's language
 * (a browser in German falls back to the English catalog).
 */
export class MessageTranslator implements Translator {
  readonly locale: string;
  private readonly plurals: Intl.PluralRules;
  private readonly numbers: Intl.NumberFormat;
  private readonly times: Intl.DateTimeFormat;
  private readonly dateTimes: Intl.DateTimeFormat;
  private readonly moments: Intl.DateTimeFormat;

  constructor(private readonly source: MessageSource) {
    this.locale = source.message('locale', []);
    this.plurals = new Intl.PluralRules(this.locale);
    this.numbers = new Intl.NumberFormat(this.locale);
    this.times = new Intl.DateTimeFormat(this.locale, { hour: '2-digit', minute: '2-digit' });
    this.dateTimes = new Intl.DateTimeFormat(this.locale, {
      dateStyle: 'short',
      timeStyle: 'medium',
    });
    this.moments = new Intl.DateTimeFormat(this.locale, { dateStyle: 'short', timeStyle: 'short' });
  }

  text(key: MessageKey, ...substitutions: readonly string[]): string {
    return this.source.message(key, substitutions);
  }

  count(key: CountedKey, count: number, ...substitutions: readonly string[]): string {
    const category = this.plurals.select(count);
    const form: PluralForm = isPluralForm(category) ? category : 'other';
    const formKey: `${CountedKey}_${PluralForm}` = `${key}_${form}`;
    return this.source.message(formKey, [this.number(count), ...substitutions]);
  }

  number(value: number): string {
    return this.numbers.format(value);
  }

  time(epochMs: number): string {
    return this.times.format(epochMs);
  }

  dateTime(epochMs: number): string {
    return this.dateTimes.format(epochMs);
  }

  moment(epochMs: number, now: number): string {
    const sameDay = new Date(epochMs).toDateString() === new Date(now).toDateString();
    return sameDay ? this.time(epochMs) : this.moments.format(epochMs);
  }
}
