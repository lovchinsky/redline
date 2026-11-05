import type { Translator } from '../../ports/i18n';

const KB = 1024;
const MB = KB * 1024;

const oneDecimal = (value: number): number => Math.round(value * 10) / 10;

export const formatBytes = (t: Translator, bytes: number): string =>
  bytes < KB
    ? t.text('sizeBytes', t.number(bytes))
    : bytes < MB
      ? t.text('sizeKilobytes', t.number(oneDecimal(bytes / KB)))
      : t.text('sizeMegabytes', t.number(oneDecimal(bytes / MB)));
