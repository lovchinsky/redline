import { describe, expect, it } from 'vitest';
import { sampleBrief } from '../application/testing/brief';
import { answerText, askReply, askTurn } from './asking';
import { workingRules } from './prompt';

const pending = { call: 'toolu_1', text: 'Desktop only' };
const asked = { text: 'Desktop only?', options: [] };

describe('asking the requester', () => {
  it('pauses on a question, answers the one the session waited on, and stops at the limit', () => {
    expect(askTurn('toolu_2', asked, { pending: null, questionsLeft: 1 })).toEqual({
      kind: 'pause',
    });
    expect(askTurn('toolu_1', asked, { pending, questionsLeft: 1 })).toEqual({
      kind: 'reply',
      text: 'Desktop only',
      isError: false,
    });
    expect(askTurn('toolu_2', asked, { pending, questionsLeft: 1 })).toEqual({ kind: 'pause' });
    expect(askTurn('toolu_2', asked, { pending, questionsLeft: 0 })).toMatchObject({
      kind: 'reply',
      text: expect.stringContaining('cannot ask more questions') as string,
      isError: false,
    });
  });

  it('refuses a question the requester could not be shown, before it pauses anything', () => {
    expect(askTurn('toolu_2', null, { pending: null, questionsLeft: 1 })).toMatchObject({
      kind: 'refuse',
      reason: expect.stringContaining('plain words') as string,
    });
    // The call the session waits on is answered whatever it asked.
    expect(askTurn('toolu_1', null, { pending, questionsLeft: 1 })).toMatchObject({
      kind: 'reply',
    });
  });

  it('tells an agent whose question ran instead of pausing to ask it alone', () => {
    expect(askReply('toolu_2', asked, { pending: null, questionsLeft: 1 })).toMatchObject({
      text: expect.stringContaining('alone') as string,
      isError: true,
    });
    // A call of unknown id is never the one the session waited on.
    expect(askReply(null, asked, { pending, questionsLeft: 1 }).isError).toBe(true);
    expect(askReply('toolu_1', asked, { pending, questionsLeft: 1 }).text).toBe('Desktop only');
  });

  it('gives the answer, or says nobody gave one', () => {
    expect(answerText({ text: 'Yes' })).toBe('Yes');
    expect(answerText(null)).toContain('Nobody answered in time');
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
