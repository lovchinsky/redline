import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'assembly',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
