import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'render',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
