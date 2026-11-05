import { decodeOrKeep } from './uri';

/**
 * Removes personal data and secrets from text before it leaves the page: what an agent needs
 * is the shape of the UI and where it lives in code, never the people or credentials in it.
 * Patterns are deliberately narrow (Luhn for cards, `+` for phones) so that prices, ids and
 * code identifiers survive.
 */
interface Rule {
  readonly pattern: RegExp;
  /** What a match becomes, given the pattern's groups (all required); returning it unchanged keeps it. */
  readonly replace: (match: string, ...groups: string[]) => string;
}

/** A labelled placeholder for matches that `accept` confirms (all of them by default). */
const labelled =
  (label: string, accept: (match: string) => boolean = () => true) =>
  (match: string): string =>
    accept(match) ? `[${label}]` : match;

/** Query and fragment parameters that carry credentials or identities by name. */
const SENSITIVE_PARAM =
  /token|key|secret|pass(word|wd)?|pwd|auth|session|sig(nature)?|code|otp|email|jwt|credential/i;

const passesLuhn = (digits: string): boolean => {
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
  }
  return sum % 10 === 0;
};

const RULES: readonly Rule[] = [
  // Text carries URLs too (links in markup, failed requests in errors, relative paths): their
  // credentials go, and sensitive parameters lose their values wherever a query appears.
  {
    pattern: /\b([a-z][a-z\d+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi,
    replace: (_, scheme) => scheme,
  },
  {
    pattern: /([?&#;]|&amp;)([\w.%[\]-]+)=([^&#\s"'<>]+)/g,
    replace: (match, separator, name) =>
      SENSITIVE_PARAM.test(name) ? `${separator}${name}=[redacted]` : match,
  },
  { pattern: /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, replace: labelled('token') },
  {
    replace: labelled('secret'),
    pattern:
      /\b(?:[sprk]k_(?:live|test)_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[abpr]-[A-Za-z0-9-]{10,})\b/g,
  },
  {
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
    replace: labelled('email'),
  },
  {
    pattern: /\b\d(?:[ -]?\d){12,18}\b/g,
    replace: labelled('card', (match) => passesLuhn(match.replace(/\D/g, ''))),
  },
  {
    pattern: /\+\d[\d ().-]{7,18}\d/g,
    replace: labelled('phone', (match) => {
      const digits = match.replace(/\D/g, '').length;
      return digits >= 10 && digits <= 15;
    }),
  },
];

export const redactText = (text: string): string =>
  RULES.reduce((current, rule) => current.replace(rule.pattern, rule.replace), text);

const redactParams = (params: URLSearchParams): void => {
  for (const [name, value] of [...params]) {
    params.set(name, SENSITIVE_PARAM.test(name) ? '[redacted]' : redactText(value));
  }
};

/**
 * A URL without secrets: sensitive parameters (also in `#a=b` fragments, as OAuth uses) lose
 * their values, and the rest of the URL goes through `redactText`.
 */
export const redactUrl = (text: string): string => {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return redactText(text);
  }
  if (url.username !== '' || url.password !== '') {
    url.username = '';
    url.password = '';
  }
  redactParams(url.searchParams);
  if (url.hash.includes('=')) {
    const fragment = new URLSearchParams(url.hash.slice(1));
    redactParams(fragment);
    url.hash = fragment.toString();
  }
  url.pathname = redactText(decodeOrKeep(url.pathname));
  // Readable in context.md: brackets and non-ASCII letters, not percent escapes.
  return decodeOrKeep(url.toString(), decodeURI);
};
