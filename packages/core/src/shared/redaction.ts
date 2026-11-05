/**
 * Removes personal data and secrets from text before it leaves the page: what an agent needs
 * is the shape of the UI and where it lives in code, never the people or credentials in it.
 * Patterns are deliberately narrow (Luhn for cards, `+` for phones) so that prices, ids and
 * code identifiers survive.
 */
interface Rule {
  readonly label: string;
  readonly pattern: RegExp;
  readonly accept?: (match: string) => boolean;
}

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
  { label: 'token', pattern: /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g },
  {
    label: 'secret',
    pattern:
      /\b(?:[sprk]k_(?:live|test)_[A-Za-z0-9]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|xox[abpr]-[A-Za-z0-9-]{10,})\b/g,
  },
  { label: 'email', pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g },
  {
    label: 'card',
    pattern: /\b\d(?:[ -]?\d){12,18}\b/g,
    accept: (match) => passesLuhn(match.replace(/\D/g, '')),
  },
  {
    label: 'phone',
    pattern: /\+\d[\d ().-]{7,18}\d/g,
    accept: (match) => {
      const digits = match.replace(/\D/g, '').length;
      return digits >= 10 && digits <= 15;
    },
  },
];

export const redactText = (text: string): string =>
  RULES.reduce(
    (current, rule) =>
      current.replace(rule.pattern, (match) =>
        rule.accept === undefined || rule.accept(match) ? `[${rule.label}]` : match,
      ),
    text,
  );

const safeDecode = (decode: (text: string) => string, text: string): string => {
  try {
    return decode(text);
  } catch {
    return text;
  }
};

/** Query and fragment parameters that carry credentials or identities by name. */
const SENSITIVE_PARAM =
  /token|key|secret|pass(word|wd)?|pwd|auth|session|sig(nature)?|code|otp|email|jwt|credential/i;

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
  url.pathname = redactText(safeDecode(decodeURIComponent, url.pathname));
  // Readable in context.md: brackets and non-ASCII letters, not percent escapes.
  return safeDecode(decodeURI, url.toString());
};
