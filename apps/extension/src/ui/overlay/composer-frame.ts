import type { Rect, Size } from '@redline/geometry';
import {
  COMPOSER_MARGIN,
  CONNECT,
  type ComposerView,
  type ConnectMessage,
  type FromComposer,
  type ToComposer,
} from './composer-messages';
import { placePanel } from './placement';

const FROM_COMPOSER = new Set<FromComposer['type']>([
  'size',
  'comment',
  'submit',
  'cancel',
  'remove-last-shape',
  'pick-keyboard',
]);

const isFromComposer = (data: unknown): data is FromComposer =>
  typeof data === 'object' &&
  data !== null &&
  FROM_COMPOSER.has((data as { type?: unknown }).type as FromComposer['type']);

export interface ComposerFrameOptions {
  /** The composer page. It may be a per-session alias of the extension's URL. */
  readonly url: string;
  /**
   * The extension's own origin: the only one allowed to receive the channel. If the page
   * navigated the frame elsewhere, the browser drops the message instead of handing it over.
   */
  readonly origin: string;
  /** Proves to the frame that the channel comes from this session. */
  readonly token: string;
  /** Accessible name of the frame. */
  readonly title: string;
  readonly onMessage: (message: FromComposer) => void;
}

/**
 * The page side of the composer frame: creates it inside the overlay, hands it a private
 * channel, forwards what to show, and places it next to the latest shape once it reports its
 * size. Nothing typed in it is visible to the page.
 */
export class ComposerFrame {
  private readonly frame: HTMLIFrameElement;
  private port: MessagePort | null = null;
  private readonly queue: ToComposer[] = [];
  private size: Size | null = null;
  private anchor: { readonly rect: Rect; readonly viewport: Size } | null = null;
  private shown = false;
  private focused = false;

  constructor(
    container: HTMLElement,
    private readonly options: ComposerFrameOptions,
  ) {
    const frame = container.ownerDocument.createElement('iframe');
    frame.className = 'composer-frame';
    frame.title = options.title;
    frame.dataset['visible'] = 'false';
    frame.addEventListener('load', () => {
      this.connect();
    });
    frame.src = `${options.url}#${options.token}`;
    container.append(frame);
    this.frame = frame;
  }

  /** Starts editing: the frame takes the draft's comment and, once placed, the focus. */
  open(view: ComposerView): void {
    this.shown = true;
    this.focused = false;
    this.send({ type: 'open', view });
    this.layout();
  }

  /** Shows the session's latest state without touching what the user is typing. */
  update(view: ComposerView): void {
    this.send({ type: 'update', view });
  }

  close(): void {
    this.shown = false;
    this.frame.dataset['visible'] = 'false';
  }

  /** Keeps the panel next to the latest shape, e.g. after scrolling. */
  placeNear(rect: Rect, viewport: Size): void {
    this.anchor = { rect, viewport };
    this.layout();
  }

  dispose(): void {
    this.port?.close();
    this.frame.remove();
  }

  private connect(): void {
    const target = this.frame.contentWindow;
    if (target === null) return;
    const channel = new MessageChannel();
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      if (!isFromComposer(event.data)) return;
      if (event.data.type === 'size') {
        this.size = { width: event.data.width, height: event.data.height };
        this.layout();
        return;
      }
      this.options.onMessage(event.data);
    };
    const hello: ConnectMessage = { type: CONNECT, token: this.options.token };
    target.postMessage(hello, this.options.origin, [channel.port2]);
    this.port = channel.port1;
    for (const message of this.queue.splice(0)) this.port.postMessage(message);
  }

  private send(message: ToComposer): void {
    if (this.port === null) this.queue.push(message);
    else this.port.postMessage(message);
  }

  /** Places the frame (panel plus its shadow margin) once both its size and anchor are known. */
  private layout(): void {
    if (!this.shown || this.size === null || this.anchor === null) return;
    const panel = {
      width: this.size.width - 2 * COMPOSER_MARGIN,
      height: this.size.height - 2 * COMPOSER_MARGIN,
    };
    const position = placePanel(this.anchor.rect, panel, this.anchor.viewport);
    const style = this.frame.style;
    style.left = `${String(position.x - COMPOSER_MARGIN)}px`;
    style.top = `${String(position.y - COMPOSER_MARGIN)}px`;
    style.width = `${String(this.size.width)}px`;
    style.height = `${String(this.size.height)}px`;
    this.frame.dataset['visible'] = 'true';
    if (!this.focused) {
      // Focus enters the frame first, then the frame focuses its comment field.
      this.focused = true;
      this.frame.focus();
      this.send({ type: 'focus' });
    }
  }
}
