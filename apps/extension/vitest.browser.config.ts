import { playwright } from '@vitest/browser-playwright';
import { defineProject } from 'vitest/config';

/** Overlay code that works on real page elements runs in Chromium, as in the extension. */
export default defineProject({
  test: {
    name: 'extension-browser',
    include: ['src/**/*.browser.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      viewport: { width: 1280, height: 800 },
    },
  },
});
