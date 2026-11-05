import * as z from 'zod/mini';
import {
  PROTOCOL_VERSION,
  REQUEST_EVENT,
  RESPONSE_EVENT,
  type ComponentTrace,
  type Operation,
  type PingResult,
  type RuntimeReport,
} from './protocol';

/** Responses larger than this are not parsed: the page may answer instead of the runtime. */
const MAX_RESPONSE_CHARS = 64 * 1024;

const observedSince = z.enum(['page-load', 'capture-start']);
const text = (max: number) => z.string().check(z.maxLength(max));

const pingSchema = z.object({ version: z.number(), observedSince });

const traceSchema = z.nullable(
  z.object({
    framework: z.enum(['react', 'vue', 'svelte', 'angular']),
    version: z.nullable(text(40)),
    mode: z.enum(['development', 'production', 'unknown']),
    components: z
      .array(
        z.object({
          name: text(200),
          file: z.nullable(text(500)),
          line: z.nullable(z.int().check(z.nonnegative())),
        }),
      )
      .check(z.maxLength(20)),
  }),
);

const reportSchema = z.object({
  observedSince,
  errors: z
    .array(
      z.object({
        message: text(1000),
        source: z.nullable(text(1000)),
        count: z.int().check(z.positive()),
        lastSeenMsAgo: z.number().check(z.nonnegative()),
      }),
    )
    .check(z.maxLength(20)),
  failedRequests: z
    .array(
      z.object({
        url: text(1000),
        status: z.int().check(z.nonnegative()),
        initiator: text(40),
        count: z.int().check(z.positive()),
        lastSeenMsAgo: z.number().check(z.nonnegative()),
      }),
    )
    .check(z.maxLength(50)),
});

const responseSchema = z.discriminatedUnion('ok', [
  z.object({ id: z.string(), ok: z.literal(true), result: z.unknown() }),
  z.object({ id: z.string(), ok: z.literal(false), error: z.string() }),
]);

export type ClientFailure =
  /** Nobody answered: the runtime is not in this page (yet). */
  | { readonly kind: 'no-runtime' }
  /** An answer that is not a valid one: a different version, or the page interfering. */
  | { readonly kind: 'invalid-response'; readonly reason: string }
  | { readonly kind: 'runtime-error'; readonly reason: string };

export type ClientResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: ClientFailure };

/**
 * The content script's side of the protocol. Requests are synchronous: dispatching a DOM event
 * runs the runtime's listener, which answers before `dispatchEvent` returns.
 */
export class PageRuntimeClient {
  constructor(
    private readonly document: Document,
    private readonly newId: () => string,
  ) {}

  ping(): ClientResult<PingResult> {
    return this.request('ping', this.document, pingSchema);
  }

  componentTrace(element: Element): ClientResult<ComponentTrace | null> {
    return this.request('component-trace', element, traceSchema);
  }

  runtimeReport(): ClientResult<RuntimeReport> {
    return this.request('runtime-report', this.document, reportSchema);
  }

  private request<S extends z.ZodMiniType>(
    op: Operation,
    target: EventTarget,
    schema: S,
  ): ClientResult<z.output<S>> {
    const id = this.newId();
    // Filled by the listener while `dispatchEvent` runs.
    const received: { raw: string | null } = { raw: null };
    const listen = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail !== 'string') return;
      if (event.detail.length > MAX_RESPONSE_CHARS || !event.detail.includes(id)) return;
      received.raw = event.detail;
    };
    this.document.addEventListener(RESPONSE_EVENT, listen, true);
    try {
      target.dispatchEvent(
        new CustomEvent(REQUEST_EVENT, {
          detail: JSON.stringify({ v: PROTOCOL_VERSION, id, op }),
          bubbles: true,
          composed: true,
        }),
      );
    } finally {
      this.document.removeEventListener(RESPONSE_EVENT, listen, true);
    }
    const answer = received.raw;
    if (answer === null) return { ok: false, failure: { kind: 'no-runtime' } };

    let parsed: unknown;
    try {
      parsed = JSON.parse(answer);
    } catch {
      return { ok: false, failure: { kind: 'invalid-response', reason: 'Not JSON' } };
    }
    const response = responseSchema.safeParse(parsed);
    if (!response.success || response.data.id !== id) {
      return { ok: false, failure: { kind: 'invalid-response', reason: 'Malformed envelope' } };
    }
    if (!response.data.ok) {
      return { ok: false, failure: { kind: 'runtime-error', reason: response.data.error } };
    }
    const result = schema.safeParse(response.data.result);
    return result.success
      ? { ok: true, value: result.data }
      : { ok: false, failure: { kind: 'invalid-response', reason: result.error.message } };
  }
}
