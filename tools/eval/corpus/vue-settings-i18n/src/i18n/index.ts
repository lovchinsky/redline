import type { App } from 'vue';
import en from './en.json';

type Messages = Record<string, string>;

/** `$t('key', { name })` in templates, backed by the JSON catalog. */
export const i18n = {
  install(app: App) {
    const messages: Messages = en;
    app.config.globalProperties.$t = (key: string, values: Record<string, unknown> = {}) =>
      (messages[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name] ?? ''));
  },
};

declare module 'vue' {
  interface ComponentCustomProperties {
    $t: (key: string, values?: Record<string, unknown>) => string;
  }
}
