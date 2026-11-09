import { defineProject } from 'vitest/config';

/**
 * Tests against a real Postgres: `REDLINE_TEST_DATABASE_URL` names a server where the tests may
 * create and drop databases (each test file gets its own).
 */
export default defineProject({
  test: {
    name: 'receiver-integration',
    include: ['src/**/*.integration.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
