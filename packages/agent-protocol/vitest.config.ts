import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'agent-protocol',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
