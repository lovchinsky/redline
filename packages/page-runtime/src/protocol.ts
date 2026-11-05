/**
 * Wire protocol between the extension's content script (isolated world) and the page runtime
 * (MAIN world). Both worlds share the DOM but no JavaScript objects, so messages are DOM
 * events whose `detail` is a JSON string. The page can see and forge these events: whatever
 * comes back is a hint, validated and size-capped by the client.
 */
export const REQUEST_EVENT = 'redline:page-runtime:request';
export const RESPONSE_EVENT = 'redline:page-runtime:response';
export const PROTOCOL_VERSION = 1;

export type Operation = 'ping' | 'component-trace' | 'runtime-report';

/**
 * Sizes both sides agree on: the runtime trims what it reports to them, and the client rejects
 * anything larger as not coming from the runtime.
 */
export const LIMITS = {
  /** Characters of a whole response. */
  response: 64 * 1024,
  errors: 5,
  failedRequests: 10,
  components: 8,
  message: 300,
  /** A script or request URL (without its query). */
  url: 500,
  initiator: 40,
  componentName: 200,
  version: 40,
} as const;

/** Text trimmed to `max` characters, marked when something was cut. */
export const clip = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

/** Dispatched on the element of interest (or the document); bubbles and crosses shadow roots. */
export interface RuntimeRequest {
  readonly v: typeof PROTOCOL_VERSION;
  readonly id: string;
  readonly op: Operation;
}

export type RuntimeResponse =
  | { readonly id: string; readonly ok: true; readonly result: unknown }
  | { readonly id: string; readonly ok: false; readonly error: string };

/** From page load (registered for a bound site) or from when capture injected the runtime. */
export type ObservedSince = 'page-load' | 'capture-start';

export interface PingResult {
  readonly version: number;
  readonly observedSince: ObservedSince;
}

export type Framework = 'react' | 'vue' | 'svelte' | 'angular';

export interface ComponentFrame {
  readonly name: string;
  /** Source file as the framework's dev build records it. */
  readonly file: string | null;
  readonly line: number | null;
}

/** Components that render an element, innermost first. */
export interface ComponentTrace {
  readonly framework: Framework;
  readonly version: string | null;
  readonly mode: 'development' | 'production' | 'unknown';
  readonly components: readonly ComponentFrame[];
}

export interface ObservedError {
  readonly message: string;
  readonly source: string | null;
  readonly count: number;
  readonly lastSeenMsAgo: number;
}

export interface FailedRequest {
  readonly url: string;
  /** HTTP status; 0 when the request failed without a response (network error, blocked). */
  readonly status: number;
  readonly initiator: string;
  readonly count: number;
  readonly lastSeenMsAgo: number;
}

export interface RuntimeReport {
  readonly observedSince: ObservedSince;
  readonly errors: readonly ObservedError[];
  readonly failedRequests: readonly FailedRequest[];
}
