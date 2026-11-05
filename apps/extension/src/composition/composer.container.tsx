import { render } from 'preact';
import { chromeMessages } from '../adapters/i18n/chrome-messages';
import { MessageTranslator } from '../adapters/i18n/message-translator';
import { ComposerApp, awaitChannel } from '../ui/overlay/ComposerApp';

/** Composition root of the composer frame, embedded in pages by the capture overlay. */
export const startComposer = (root: HTMLElement): void => {
  // Listen first: the session sends the channel as soon as the frame has loaded.
  const channel = awaitChannel(window);
  const i18n = new MessageTranslator(chromeMessages);
  document.documentElement.lang = i18n.locale;
  void channel.then((port) => {
    render(<ComposerApp translator={i18n} port={port} />, root);
  });
};
