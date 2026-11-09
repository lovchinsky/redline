import type { Clock, Timers } from '../../ports/system';

export const systemClock: Clock = {
  now: () => Date.now(),
  iso: () => new Date().toISOString(),
};

export const systemTimers: Timers = {
  after(ms, callback) {
    const timer = setTimeout(callback, ms);
    return () => {
      clearTimeout(timer);
    };
  },
};
