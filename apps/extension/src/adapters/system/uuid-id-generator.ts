import type { IdGenerator } from '@redline/core';

export const uuidIdGenerator: IdGenerator = { next: () => crypto.randomUUID() };
