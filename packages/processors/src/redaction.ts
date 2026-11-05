import { redactText, redactUrl, type FragmentProcessor } from '@redline/core';

const URL_LIKE = /^https?:\/\//i;

const redactValue = (value: unknown): unknown => {
  if (typeof value === 'string') {
    return URL_LIKE.test(value) ? redactUrl(value) : redactText(value);
  }
  if (Array.isArray(value)) return value.map(redactValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, redactValue(entry)]),
    );
  }
  return value;
};

/**
 * Second line of privacy after what collectors avoid reading (form values, sensitive fields):
 * every string any fragment carries goes through redaction, whichever module produced it.
 * Generic on purpose, so a new module cannot forget it. Strings stay strings, so every
 * fragment still matches its schema.
 */
export const redactionProcessor: FragmentProcessor<unknown> = {
  id: 'redaction',
  process: (set) => set.mapData(redactValue),
};
