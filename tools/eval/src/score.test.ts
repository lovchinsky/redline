import { describe, expect, it } from 'vitest';
import { scoreCase } from './score';

const sources = new Map([
  ['src/Card.tsx', '<h2>Monthly plan</h2><button data-testid="buy">Buy</button>'],
  ['src/App.tsx', '<Card /><p>Buy</p>'],
  ['src/locales/en.json', '{"title": "Your cart"}'],
]);
const anchor = (value: string, kind = 'text') => ({ kind, value, score: 50 });

describe('scoreCase', () => {
  it('counts an anchor that finds only the right file', () => {
    const score = scoreCase([anchor('Monthly plan')], sources, ['src/Card.tsx']);
    expect(score.hit).toBe(true);
    expect(score.verdicts[0]?.matches).toEqual(['src/Card.tsx']);
  });

  it('does not count anchors that also lead elsewhere, or nowhere', () => {
    const score = scoreCase([anchor('Buy'), anchor('Your cart')], sources, ['src/Card.tsx']);
    expect(score.verdicts.map((verdict) => verdict.hit)).toEqual([false, false]);
    expect(score.hit).toBe(false);
  });

  it('accepts any file of the component', () => {
    expect(scoreCase([anchor('Buy')], sources, ['src/Card.tsx', 'src/App.tsx']).hit).toBe(true);
  });

  it('looks at the top five anchors only', () => {
    const misses = Array.from({ length: 5 }, () => anchor('nowhere'));
    expect(scoreCase([...misses, anchor('Monthly plan')], sources, ['src/Card.tsx']).hit).toBe(
      false,
    );
  });
});
