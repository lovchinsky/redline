import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'processors',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
