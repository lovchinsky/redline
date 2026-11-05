import { defineProject } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineProject({
  plugins: [WxtVitest({ root: import.meta.dirname })],
  test: {
    name: 'extension',
    include: ['src/**/*.test.ts'],
    // Those need a real page: see `vitest.browser.config.ts`.
    exclude: ['src/**/*.browser.test.ts'],
    environment: 'node',
    // Installs IndexedDB globals (IDBRequest, IDBKeyRange, …); tests swap in a fresh IDBFactory.
    setupFiles: ['fake-indexeddb/auto'],
  },
});
