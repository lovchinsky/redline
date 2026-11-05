import { describe, expect, it } from 'vitest';
import { SerialRateLimiter } from './rate-limiter';

const fakeTime = () => {
  let now = 0;
  const slept: number[] = [];
  return {
    clock: { now: () => now },
    sleep: (ms: number) => {
      slept.push(ms);
      now += ms;
      return Promise.resolve();
    },
    advance: (ms: number) => {
      now += ms;
    },
    slept,
  };
};

describe('SerialRateLimiter', () => {
  it('spaces task starts by the minimum interval', async () => {
    const time = fakeTime();
    const limiter = new SerialRateLimiter(500, time.clock, time.sleep);
    const starts: number[] = [];
    const task = () => {
      starts.push(time.clock.now());
      return Promise.resolve();
    };
    await Promise.all([limiter.run(task), limiter.run(task), limiter.run(task)]);
    expect(starts).toEqual([0, 500, 1000]);
  });

  it('does not wait when the interval has already passed', async () => {
    const time = fakeTime();
    const limiter = new SerialRateLimiter(500, time.clock, time.sleep);
    await limiter.run(() => Promise.resolve());
    time.advance(800);
    await limiter.run(() => Promise.resolve());
    expect(time.slept).toEqual([]);
  });

  it('keeps working after a task fails', async () => {
    const time = fakeTime();
    const limiter = new SerialRateLimiter(100, time.clock, time.sleep);
    await expect(limiter.run(() => Promise.reject(new Error('quota')))).rejects.toThrow('quota');
    await expect(limiter.run(() => Promise.resolve('ok'))).resolves.toBe('ok');
  });
});
