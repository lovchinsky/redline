import { remoteStatusSchema as contractStatus } from '@redline/contract';
import { remoteStatusSchema as domainStatus } from '@redline/core';
import { describe, expect, it } from 'vitest';

/** The contract package is standalone by design; this guards it against drifting from the domain. */
describe('contract parity', () => {
  it('knows the same remote status phases as the domain', () => {
    const statuses = [
      { phase: 'queued' },
      { phase: 'working' },
      { phase: 'needs-input', question: { id: 'q', text: 'Which?', options: ['A'] } },
      { phase: 'result-ready', resultUrl: 'https://git.example/pr/1' },
      { phase: 'failed', reason: 'No' },
      { phase: 'closed' },
    ];
    for (const status of statuses) {
      expect(contractStatus.safeParse(status).success, status.phase).toBe(true);
      expect(domainStatus.safeParse(status).success, status.phase).toBe(true);
    }
    expect(contractStatus.safeParse({ phase: 'cancelled' }).success).toBe(false);
    expect(domainStatus.safeParse({ phase: 'cancelled' }).success).toBe(false);
  });
});
