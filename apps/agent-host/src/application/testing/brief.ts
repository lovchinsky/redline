import { AGENT_PROTOCOL_VERSION, type Brief } from '@redline/agent-protocol';

export const sampleBrief = (overrides: Partial<Brief> = {}): Brief => ({
  protocol: AGENT_PROTOCOL_VERSION,
  runId: 'run-1',
  taskId: 'task-1',
  baseSha: 'a'.repeat(40),
  model: 'claude-opus-5-5',
  limits: { maxTurns: 40, timeoutMs: 60_000, stallTimeoutMs: 10_000, budgetUsd: 5 },
  task: {
    title: 'Make the cards equal height',
    steps: [
      {
        id: 's1',
        url: 'https://acme.io/pricing',
        comment: 'Make the cards equal height',
        viewport: { width: 1280, height: 800 },
        files: ['steps/s1/region.png', 'steps/s1/details.md'],
      },
    ],
  },
  material: {
    entry: 'context.md',
    files: [
      { path: 'context.md', mediaType: 'text/markdown' },
      { path: 'steps/s1/region.png', mediaType: 'image/png' },
      { path: 'steps/s1/details.md', mediaType: 'text/markdown' },
    ],
  },
  exchanges: [],
  questionsLeft: 0,
  checks: ['pnpm test --run'],
  policy: {
    protectedPaths: ['.github', 'CLAUDE.md', 'src/generated/**'],
    maxFiles: 50,
    maxChangedLines: 2000,
  },
  ...overrides,
});
