import { browser } from 'wxt/browser';
import type { MessageSource } from './message-translator';

/** `chrome.i18n`: the catalog of the browser's language, or the default (English) one. */
export const chromeMessages: MessageSource = {
  message: (key, substitutions) => browser.i18n.getMessage(key, [...substitutions]),
};
