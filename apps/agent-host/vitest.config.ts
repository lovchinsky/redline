import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    name: 'agent-host',
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
