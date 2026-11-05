import { RESPONSE_TYPE, type CallerInfo } from '@redline/rpc';
import { beforeEach, describe, expect, it } from 'vitest';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { RuntimeServerTransport } from './runtime-server-transport';

const extensionUrl = (path: string) => browser.runtime.getURL(path as '/');

describe('RuntimeServerTransport', () => {
  let seen: (CallerInfo | 'ignored')[];
  beforeEach(() => {
    fakeBrowser.reset();
    seen = [];
    new RuntimeServerTransport().listen((_, caller) => {
      seen.push(caller);
      return Promise.resolve({ type: RESPONSE_TYPE, id: 'x', result: { ok: true, value: {} } });
    });
  });

  const send = async (sender: Parameters<typeof fakeBrowser.runtime.onMessage.trigger>[1]) => {
    const before = seen.length;
    // Each listener answers with a promise; wait for those too.
    const answers = await fakeBrowser.runtime.onMessage.trigger(
      { type: 'anything' },
      sender,
      () => undefined,
    );
    for (const answer of answers) await answer;
    if (seen.length === before) seen.push('ignored');
  };

  it('tells extension pages from content scripts by what Chrome reports', async () => {
    await send({ id: browser.runtime.id, url: extensionUrl('/sidepanel.html') });
    // The options page opens in a tab, but is still an extension page.
    await send({
      id: browser.runtime.id,
      url: extensionUrl('/options.html'),
      tab: { id: 3 } as never,
      frameId: 0,
    });
    await send({
      id: browser.runtime.id,
      url: 'https://acme.io/a',
      tab: { id: 5 } as never,
      frameId: 2,
    });
    expect(seen).toEqual([
      { kind: 'extension' },
      { kind: 'extension' },
      { kind: 'content-script', tabId: 5, frameId: 2, url: 'https://acme.io/a' },
    ]);
  });

  it('ignores other extensions and senders without a frame to answer', async () => {
    await send({ id: 'someone-else', url: 'https://acme.io/' });
    await send({ id: browser.runtime.id, url: 'https://acme.io/' });
    expect(seen).toEqual(['ignored', 'ignored']);
  });
});
