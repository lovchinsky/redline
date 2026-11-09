import type { TokenUsage } from '../../domain/usage';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The usage block of a Messages response, as the provider reports it. */
type ProviderUsage = Record<string, unknown>;

const usageOf = (value: unknown): ProviderUsage | null => {
  const usage = isRecord(value) ? value['usage'] : null;
  return isRecord(usage) ? usage : null;
};

/** The largest JSON answer read for its usage; a larger one passes through unmetered. */
const JSON_LIMIT = 8 * 1024 * 1024;

/**
 * Reads the usage of a Messages answer as it passes: from `message_start` and `message_delta`
 * events of a stream (whose counts are running totals), or from the body of a JSON answer.
 */
export class UsageMeter {
  private readonly totals = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  private seen = false;
  private readonly decoder = new TextDecoder();
  private pending = '';
  private json: Uint8Array[] | null;
  private jsonBytes = 0;

  constructor(private readonly kind: 'stream' | 'json') {
    this.json = kind === 'json' ? [] : null;
  }

  push(chunk: Uint8Array): void {
    if (this.kind === 'json') {
      this.jsonBytes += chunk.byteLength;
      if (this.json !== null && this.jsonBytes <= JSON_LIMIT) this.json.push(chunk);
      else this.json = null;
      return;
    }
    this.pending += this.decoder.decode(chunk, { stream: true });
    const lines = this.pending.split('\n');
    this.pending = lines.pop() ?? '';
    for (const line of lines) this.line(line);
  }

  /** What the answer used, or null when it reported nothing. */
  finish(): TokenUsage | null {
    if (this.kind === 'stream') {
      this.line(this.pending + this.decoder.decode());
    } else if (this.json !== null) {
      try {
        this.add(usageOf(JSON.parse(Buffer.concat(this.json).toString('utf8'))));
      } catch {
        // Not JSON: an answer without usage.
      }
    }
    return this.seen ? { ...this.totals } : null;
  }

  private line(line: string): void {
    if (!line.startsWith('data:')) return;
    let event: unknown;
    try {
      event = JSON.parse(line.slice(5));
    } catch {
      return;
    }
    if (!isRecord(event)) return;
    if (event['type'] === 'message_start') this.add(usageOf(event['message']));
    else if (event['type'] === 'message_delta') this.add(usageOf(event));
  }

  /** Takes the counts a usage block reports; later blocks carry running totals. */
  private add(usage: ProviderUsage | null): void {
    if (usage === null) return;
    this.seen = true;
    const take = (field: string, current: number) => {
      const value = usage[field];
      return typeof value === 'number' ? Math.max(value, current) : current;
    };
    this.totals.input = take('input_tokens', this.totals.input);
    this.totals.output = take('output_tokens', this.totals.output);
    this.totals.cacheWrite = take('cache_creation_input_tokens', this.totals.cacheWrite);
    this.totals.cacheRead = take('cache_read_input_tokens', this.totals.cacheRead);
  }
}
