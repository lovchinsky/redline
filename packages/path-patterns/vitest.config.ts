import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'path-patterns',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
