import { QUESTION_LIMITS } from '@redline/agent-protocol';
import { describe, expect, it } from 'vitest';
import { sampleBrief } from '../application/testing/brief';
import { answerText, askReply, askTurn, questionOf } from './asking';
import { workingRules } from './prompt';

const pending = { call: 'toolu_1', text: 'Desktop only' };

describe('asking the requester', () => {
  it('pauses on a question, answers the one the session waited on, and stops at the limit', () => {
    expect(askTurn('toolu_2', { pending: null, questionsLeft: 1 })).toEqual({ kind: 'pause' });
    expect(askTurn('toolu_1', { pending, questionsLeft: 1 })).toEqual({
      kind: 'reply',
      text: 'Desktop only',
      isError: false,
    });
    expect(askTurn('toolu_2', { pending, questionsLeft: 1 })).toEqual({ kind: 'pause' });
    expect(askTurn('toolu_2', { pending, questionsLeft: 0 })).toMatchObject({
      kind: 'reply',
      text: expect.stringContaining('cannot ask more questions') as string,
      isError: false,
    });
  });

  it('tells an agent whose question ran instead of pausing to ask it alone', () => {
    expect(askReply('toolu_2', { pending: null, questionsLeft: 1 })).toMatchObject({
      text: expect.stringContaining('alone') as string,
      isError: true,
    });
    // A call of unknown id is never the one the session waited on.
    expect(askReply(null, { pending, questionsLeft: 1 }).isError).toBe(true);
    expect(askReply('toolu_1', { pending, questionsLeft: 1 }).text).toBe('Desktop only');
  });

  it('gives the answer, or says nobody gave one', () => {
    const question = { id: 'q1', text: 'Desktop only?', options: [] };
    expect(answerText({ question, answer: { text: 'Yes' } })).toBe('Yes');
    expect(answerText({ question, answer: null })).toContain('Nobody answered in time');
  });

  it('takes a question the requester can be shown, and nothing else', () => {
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

  it('tells the agent whether it may ask, and how many times', () => {
    expect(workingRules(sampleBrief({ questionsLeft: 0 }))).toContain(
      'you cannot ask the requester in this task',
    );
    const rules = workingRules(sampleBrief({ questionsLeft: 2 }));
    expect(rules).toContain('you may ask the requester 2 more question(s) with ask_requester');
    expect(rules).toContain('ask alone, in a turn of its own');
  });
});
