import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'rpc',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
