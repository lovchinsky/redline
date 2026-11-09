import { QUESTION_LIMITS } from '@redline/agent-protocol';
import { describe, expect, it } from 'vitest';
import { ASKING_VARIABLE, askingOf, questionOf } from './ask-tool';

describe('the ask tool', () => {
  it('takes a question the requester can be shown from a call, and nothing else', () => {
    expect(questionOf({ question: ' Desktop only? ', options: ['Yes', 'No'] })).toEqual({
      text: 'Desktop only?',
      options: ['Yes', 'No'],
    });
    expect(questionOf({ question: 'Desktop only?' })).toEqual({
      text: 'Desktop only?',
      options: [],
    });
    expect(questionOf({ question: '   ' })).toBeNull();
    expect(questionOf({ question: 'x'.repeat(QUESTION_LIMITS.text + 1) })).toBeNull();
    expect(questionOf({ question: 'Which?', options: [7] })).toBeNull();
    expect(questionOf('Which?')).toBeNull();
  });

  it('reads the asking agent-host gave its server, and refuses to start without it', () => {
    const asking = { pending: { call: 'toolu_1', text: 'Yes' }, questionsLeft: 1 };
    expect(askingOf({ [ASKING_VARIABLE]: JSON.stringify(asking) })).toEqual(asking);
    expect(() => askingOf({})).toThrow(ASKING_VARIABLE);
  });
});
