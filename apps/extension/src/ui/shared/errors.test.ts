import { appError } from '@redline/core';
import { describe, expect, it } from 'vitest';
import { translatorFor } from '../../adapters/i18n/testing/catalog-messages';
import { describeError } from './errors';

describe('describeError', () => {
  it('uses the message of a known reason, filled from the details', () => {
    const error = appError('conflict', 'These pages are bound to Acme', {
      reason: 'bound-elsewhere',
      projectName: 'Acme',
    });
    expect(describeError(translatorFor('uk'), error)).toBe(
      'Ці сторінки прив’язані до проєкту Acme',
    );
    expect(describeError(translatorFor('en'), error)).toBe('These pages are bound to Acme');
  });

  it('falls back to the code, keeping the technical message', () => {
    expect(describeError(translatorFor('en'), appError('timeout', 'No answer in 10 s'))).toBe(
      'No answer in time (No answer in 10 s)',
    );
  });

  it('describes errors recorded with an unknown code as internal', () => {
    expect(describeError(translatorFor('en'), { code: 'gone', message: 'x' })).toBe(
      'Something went wrong (x)',
    );
  });
});
