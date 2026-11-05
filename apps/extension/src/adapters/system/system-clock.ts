import type { Clock } from '@redline/core';

export const systemClock: Clock = { now: () => Date.now() };
