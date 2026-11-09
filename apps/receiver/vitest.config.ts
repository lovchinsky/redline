import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'receiver',
    include: ['src/**/*.test.ts'],
    // Those need a real Postgres: see `vitest.integration.config.ts`.
    exclude: ['src/**/*.integration.test.ts'],
    environment: 'node',
  },
});
