import { playwright } from '@vitest/browser-playwright';
import { defineProject } from 'vitest/config';

/** DOM code needs real layout (getBoundingClientRect, elementsFromPoint): run in Chromium. */
export default defineProject({
  test: {
    name: 'dom',
    include: ['src/**/*.test.ts'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      viewport: { width: 1280, height: 800 },
    },
  },
});
