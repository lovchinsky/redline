import { describe, expect, it } from 'vitest';
import { CoalescingRunner } from './coalescing-runner';

describe('CoalescingRunner', () => {
  it('never overlaps, and runs once more for any number of requests made meanwhile', async () => {
    let passes = 0;
    let concurrent = 0;
    let maxConcurrent = 0;
    let release!: () => void;
    let gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runner = new CoalescingRunner(async () => {
      passes += 1;
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await gate;
      concurrent -= 1;
    });

    const first = runner.run();
    const during = [runner.run(), runner.run(), runner.run()];
    release();
    gate = Promise.resolve();
    await Promise.all([first, ...during]);
    expect(passes).toBe(2);
    expect(maxConcurrent).toBe(1);

    await runner.run();
    expect(passes).toBe(3);
  });

  it('recovers after a failed pass', async () => {
    let fail = true;
    const runner = new CoalescingRunner(() => {
      if (fail) return Promise.reject(new Error('boom'));
      return Promise.resolve();
    });
    await expect(runner.run()).rejects.toThrow('boom');
    fail = false;
    await expect(runner.run()).resolves.toBeUndefined();
  });
});
