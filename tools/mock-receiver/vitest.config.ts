import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'mock-receiver',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
