/** Small Markdown builders for presenters. Content from web pages is untrusted text. */

/** Inline code span that stays intact even when the text contains backticks. */
export const code = (text: string): string => {
  const longestRun = Math.max(0, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length));
  const fence = '`'.repeat(longestRun + 1);
  const padded = text.startsWith('`') || text.endsWith('`') ? ` ${text} ` : text;
  return `${fence}${padded}${fence}`;
};

/** Escapes characters that would turn page text into Markdown structure. */
export const escapeText = (text: string): string =>
  text
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
    `| ${cells.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`;
  return [line(headers), line(headers.map(() => '---')), ...rows.map(line)].join('\n');
};
