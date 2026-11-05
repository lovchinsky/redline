import en from '../../../../public/_locales/en/messages.json';
import uk from '../../../../public/_locales/uk/messages.json';
import type { Translator } from '../../../ports/i18n';
import { MessageTranslator, type MessageSource } from '../message-translator';

export type Catalog = Readonly<Record<string, { readonly message: string }>>;

export const CATALOGS: Readonly<Record<'en' | 'uk', Catalog>> = { en, uk };

/** Substitutes like `chrome.i18n.getMessage`: `$1`…`$9` by position, `$$` is a dollar sign. */
export const substitute = (message: string, substitutions: readonly string[]): string =>
  message.replace(/\$(\$|[1-9])/g, (_, token: string) =>
    token === '$' ? '$' : (substitutions[Number(token) - 1] ?? ''),
  );

/** A catalog read the way the browser reads it; a missing message is an empty string. */
export const catalogMessages = (catalog: Catalog): MessageSource => ({
  message: (key, substitutions) => substitute(catalog[key]?.message ?? '', substitutions),
});

export const translatorFor = (locale: keyof typeof CATALOGS): Translator =>
  new MessageTranslator(catalogMessages(CATALOGS[locale]));
