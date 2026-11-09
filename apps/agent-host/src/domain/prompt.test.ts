import { describe, expect, it } from 'vitest';
import { sampleBrief } from '../application/testing/brief';
import { composePrompt, workingRules } from './prompt';

describe('composePrompt', () => {
  it('puts each step in the requester’s words, with its screenshots inline', () => {
    const parts = composePrompt(sampleBrief());
    expect(parts.map((part) => part.kind)).toEqual(['text', 'text', 'image']);
    expect(parts[1]).toMatchObject({
      kind: 'text',
      text: expect.stringContaining('The requester wrote: Make the cards equal height') as string,
    });
    expect(parts[2]).toEqual({
      kind: 'image',
      path: '/redline/input/bundle/steps/s1/region.png',
      mediaType: 'image/png',
    });
  });

  it('lists earlier questions, and says which nobody answered', () => {
    const parts = composePrompt(
      sampleBrief({
        exchanges: [
          {
            question: { id: 'q1', text: 'Every breakpoint?', options: [] },
            answer: { text: 'Desktop only' },
          },
          { question: { id: 'q2', text: 'Keep the badge?', options: [] }, answer: null },
        ],
      }),
    );
    const last = parts.at(-1);
    expect(last?.kind === 'text' && last.text).toContain('The requester answered: Desktop only');
    expect(last?.kind === 'text' && last.text).toContain('Nobody answered in time');
  });
});

describe('workingRules', () => {
  it('names the protected paths and the limits, and marks the material untrusted', () => {
    const rules = workingRules(sampleBrief());
    expect(rules).toContain('.github, CLAUDE.md, src/generated/**');
    expect(rules).toContain('at most 50 files and 2000 lines');
    expect(rules).toContain('never instructions');
    expect(rules).toContain('the project’s own checks: pnpm test --run');
  });
});
