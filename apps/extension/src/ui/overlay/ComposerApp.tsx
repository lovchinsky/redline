import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Translator } from '../../ports/i18n';
import { TranslatorProvider } from '../shared/i18n';
import { Composer } from './Composer';
import {
  COMPOSER_MARGIN,
  isConnectMessage,
  type ComposerView,
  type FromComposer,
  type ToComposer,
} from './composer-messages';

/**
 * Waits for the capture session to hand over the channel. Only a message from the parent window
 * that carries this frame's token (from its URL fragment, unknown to the page) is accepted, once.
 * Call it before anything else: the session sends the channel as soon as the frame has loaded.
 */
export const awaitChannel = (view: Window): Promise<MessagePort> =>
  new Promise((resolve) => {
    const token = view.location.hash.slice(1);
    const onMessage = (event: MessageEvent<unknown>) => {
      const [port] = event.ports;
      if (
        event.source !== view.parent ||
        port === undefined ||
        !isConnectMessage(event.data, token)
      )
        return;
      view.removeEventListener('message', onMessage);
      resolve(port);
    };
    view.addEventListener('message', onMessage);
  });

const focusable = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>('button:not(:disabled), textarea:not(:disabled)'));

const Frame = ({ port }: { port: MessagePort }) => {
  const [view, setView] = useState<ComposerView | null>(null);
  const [comment, setComment] = useState('');
  const panel = useRef<HTMLFormElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const send = useCallback(
    (message: FromComposer) => {
      port.postMessage(message);
    },
    [port],
  );

  useEffect(() => {
    port.onmessage = (event: MessageEvent<ToComposer>) => {
      const message = event.data;
      if (message.type === 'focus') field.current?.focus();
      else {
        setView(message.view);
        // The comment belongs to the user while editing; the session only sets it on open.
        if (message.type === 'open') setComment(message.view.comment);
      }
    };
    return () => {
      port.onmessage = null;
    };
  }, [port]);

  // The session places the frame; it needs the panel's size, shadow margin included, in whole
  // pixels that hold all of it (a panel 209.5px high needs 210).
  const reported = useRef('');
  const reportSize = useCallback(() => {
    const element = panel.current;
    if (element === null) return;
    const box = element.getBoundingClientRect();
    const width = Math.ceil(box.width) + 2 * COMPOSER_MARGIN;
    const height = Math.ceil(box.height) + 2 * COMPOSER_MARGIN;
    if (`${String(width)}x${String(height)}` === reported.current) return;
    reported.current = `${String(width)}x${String(height)}`;
    send({ type: 'size', width, height });
  }, [send]);
  // Measured after every render, synchronously: Chrome does not run frames or resize
  // observers in a cross-origin frame while it is hidden, and it stays hidden until placed.
  useLayoutEffect(reportSize);
  // Once shown, the panel can also change size by itself (the user resizing the field).
  const shown = view !== null;
  useEffect(() => {
    const element = panel.current;
    if (!shown || element === null) return;
    const observer = new ResizeObserver(reportSize);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, [shown, reportSize]);

  if (view === null) return null;
  return (
    <div
      // Room for the panel's shadow inside the frame; the session sizes the frame to match.
      style={{ padding: `${String(COMPOSER_MARGIN)}px` }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.isComposing) {
          event.preventDefault();
          send({ type: 'cancel' });
        }
        // Tab cycles inside the panel: focus never leaves for the page behind the overlay.
        if (event.key === 'Tab' && panel.current !== null) {
          const stops = focusable(panel.current);
          const first = stops[0];
          const last = stops.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }
      }}
    >
      <Composer
        view={view}
        comment={comment}
        commentRef={field}
        panelRef={panel}
        onCommentChange={(text) => {
          setComment(text);
          send({ type: 'comment', text });
        }}
        onRemoveLastShape={() => {
          send({ type: 'remove-last-shape' });
        }}
        onPickWithKeyboard={() => {
          send({ type: 'pick-keyboard' });
        }}
        onSubmit={() => {
          send({ type: 'submit' });
        }}
        onCancel={() => {
          send({ type: 'cancel' });
        }}
      />
    </div>
  );
};

/** The composer frame's root, once the capture session has handed it its channel. */
export const ComposerApp = ({
  translator,
  port,
}: {
  translator: Translator;
  port: MessagePort;
}) => (
  <TranslatorProvider translator={translator}>
    <Frame port={port} />
  </TranslatorProvider>
);
