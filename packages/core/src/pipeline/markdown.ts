/**
 * Small Markdown builders for presenters. Content from web pages is untrusted text: every
 * builder here keeps it inline, so no page string can start a heading, quote, list or block.
 */

/**
 * Line breaks and other control characters as single spaces. Markdown recognises block structure
 * (headings, quotes, rules) at the start of a line before it reads inline code, so text that
 * stays on one line cannot leave the span or paragraph it is put in.
 */
const singleLine = (text: string): string =>
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is removed
  text.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ');

/** Inline code span that stays intact even when the text contains backticks or line breaks. */
export const code = (raw: string): string => {
  const text = singleLine(raw);
  const longestRun = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const fence = '`'.repeat(longestRun + 1);
  const padded = text.startsWith('`') || text.endsWith('`') ? ` ${text} ` : text;
  return `${fence}${padded}${fence}`;
};

/** Escapes characters that would turn page text into Markdown structure. */
export const escapeText = (text: string): string =>
  singleLine(text)
    .replace(/[\\`*_[\]<>#|]/g, (char) => `\\${char}`)
    .replace(/\s+/g, ' ')
    .trim();

/** Collapses whitespace and shortens to `max` characters with an ellipsis. */
export const truncate = (text: string, max: number): string => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`;
};

/** GitHub-flavoured table; cells are escaped so `|` in page text cannot break columns. */
export const table = (headers: readonly string[], rows: readonly (readonly string[])[]): string => {
  const line = (cells: readonly string[]) =>
    `| ${cells.map((c) => singleLine(c).replace(/\|/g, '\\|')).join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
};
