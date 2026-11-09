import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'contract-conformance',
    include: ['src/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
