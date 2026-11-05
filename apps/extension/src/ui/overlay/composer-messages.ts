import type { DraftProblem, ShapeResolution } from './capture-machine';

/**
 * The composer runs in a frame of the extension's own origin, so the page never sees the
 * user's keystrokes: events inside it do not travel through the page's `window` or `document`.
 * The capture session and the frame talk over a private `MessageChannel`; these are its messages.
 */

/** What the composer shows. */
export interface ComposerView {
  readonly shapes: readonly ShapeResolution[];
  readonly comment: string;
  readonly problem: DraftProblem | null;
  readonly committing: boolean;
}

/** Session → frame. `open` (re)starts editing with the draft's comment; `update` keeps the text. */
export type ToComposer =
  | { readonly type: 'open'; readonly view: ComposerView }
  | { readonly type: 'update'; readonly view: ComposerView }
  | { readonly type: 'focus' };

/** Frame → session: what the user did, and how much room the composer needs. */
export type FromComposer =
  | { readonly type: 'size'; readonly width: number; readonly height: number }
  | { readonly type: 'comment'; readonly text: string }
  | { readonly type: 'submit' }
  | { readonly type: 'cancel' }
  | { readonly type: 'remove-last-shape' }
  | { readonly type: 'pick-keyboard' };

/**
 * The handshake that hands the frame its end of the channel. The token travels in the frame's
 * URL fragment, which the page cannot read, so a page cannot hand the frame a channel of its own.
 */
export const CONNECT = 'redline:composer:connect';
export interface ConnectMessage {
  readonly type: typeof CONNECT;
  readonly token: string;
}

export const isConnectMessage = (data: unknown, token: string): data is ConnectMessage =>
  typeof data === 'object' &&
  data !== null &&
  (data as Partial<ConnectMessage>).type === CONNECT &&
  (data as Partial<ConnectMessage>).token === token;

/** Room around the panel inside the frame, so its shadow is not cut off at the frame's edge. */
export const COMPOSER_MARGIN = 32;
