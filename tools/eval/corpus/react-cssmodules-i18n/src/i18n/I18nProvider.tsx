import { createContext, useContext, type ReactNode } from 'react';
import en from '../locales/en.json';

type Messages = Record<string, string>;
const catalogs: Record<string, Messages> = { en };

const I18nContext = createContext<Messages>(en);

export function I18nProvider({ locale, children }: { locale: string; children: ReactNode }) {
  return <I18nContext.Provider value={catalogs[locale] ?? en}>{children}</I18nContext.Provider>;
}

/** Looks up a message by key and fills `{name}` placeholders. */
export function useT() {
  const messages = useContext(I18nContext);
  return (key: string, values: Record<string, string | number> = {}) =>
    (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
}
