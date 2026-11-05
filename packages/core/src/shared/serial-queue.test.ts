import { describe, expect, it } from 'vitest';
import { SerialQueue } from './serial-queue';

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('SerialQueue', () => {
  it('starts a task only after the previous one has settled', async () => {
    const queue = new SerialQueue();
    const gate = deferred();
    const log: string[] = [];
    const first = queue.run(async () => {
      log.push('first:start');
      await gate.promise;
      log.push('first:end');
    });
    const second = queue.run(() => {
      log.push('second:start');
      return Promise.resolve();
    });
    await Promise.resolve();
    expect(log).toEqual(['first:start']);
    gate.resolve();
    await Promise.all([first, second]);
    expect(log).toEqual(['first:start', 'first:end', 'second:start']);
  });

  it('keeps running after a task fails, and the caller sees the failure', async () => {
    const queue = new SerialQueue();
    const failed = queue.run(() => Promise.reject(new Error('boom')));
    const next = queue.run(() => Promise.resolve(42));
    await expect(failed).rejects.toThrow('boom');
    await expect(next).resolves.toBe(42);
  });
});
