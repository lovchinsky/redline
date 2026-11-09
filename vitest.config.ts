import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/*',
      'tools/*',
      'apps/extension/vitest.config.ts',
      'apps/extension/vitest.browser.config.ts',
      'apps/receiver/vitest.config.ts',
      'apps/agent-host/vitest.config.ts',
    ],
  },
});
