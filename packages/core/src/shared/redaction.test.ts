import { describe, expect, it } from 'vitest';
import { redactText, redactUrl } from './redaction';

describe('redactText', () => {
  it.each([
    ['Signed in as maria.k@acme.io', 'Signed in as [email]'],
    ['Card 4242 4242 4242 4242 expires', 'Card [card] expires'],
    ['Call +380 (67) 123-45-67 now', 'Call [phone] now'],
    ['Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.abcdefghijk', 'Bearer [token]'],
    ['key sk_live_4eC39HqLyjWDarjtT1zdp7dc', 'key [secret]'],
  ])('%s', (input, expected) => {
    expect(redactText(input)).toBe(expected);
  });

  it.each([
    'Order #1042 · $1,200.00',
    'Pro plan — $29 per month',
    '2026-11-05 10:42',
    'grid-cols-3 Card_root__x9f2a',
    'Ticket 1234 5678 9012 3456', // fails Luhn: an id, not a card
    'Version 1.23.456',
  ])('keeps %s', (input) => {
    expect(redactText(input)).toBe(input);
  });
});

describe('redactUrl', () => {
  it('drops sensitive parameters and credentials, keeps the route', () => {
    expect(
      redactUrl('https://user:pw@app.acme.io/orders/42?tab=items&token=abc123&ref=nav#x'),
    ).toBe('https://app.acme.io/orders/42?tab=items&token=[redacted]&ref=nav#x');
  });

  it('redacts OAuth-style fragments and personal data in the path', () => {
    expect(redactUrl('https://app.acme.io/u/maria@acme.io#access_token=xyz&state=1')).toBe(
      'https://app.acme.io/u/[email]#access_token=[redacted]&state=1',
    );
  });

  it('survives malformed escapes', () => {
    expect(redactUrl('https://app.acme.io/a%E0%A4%A/b?q=1')).toContain('app.acme.io');
  });

  it('falls back to text redaction for what is not a URL', () => {
    expect(redactUrl('mailto maria@acme.io')).toBe('mailto [email]');
  });
});
