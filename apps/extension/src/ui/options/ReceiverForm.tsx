import type { ReceiverView } from '@redline/rpc';
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { UiServices } from '../services';
import { OPTIONS_TEXT } from './copy';

type Feedback =
  | { readonly kind: 'none' }
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'error'; readonly text: string };

/** The receiver's address and token. The token is write-only: the page never reads it back. */
export const ReceiverForm = ({ services }: { services: UiServices }) => {
  const [stored, setStored] = useState<ReceiverView | null>(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'none' });

  const load = useCallback(async () => {
    const receiver = await services.rpc.call('receiver.get', {});
    if (!receiver.ok) {
      setFeedback({ kind: 'error', text: receiver.error.message });
      return;
    }
    setStored(receiver.value.receiver);
    setUrl(receiver.value.receiver?.baseUrl ?? '');
  }, [services]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    // Asked first, while the click still counts as a user gesture.
    let origin: string | null = null;
    try {
      origin = new URL(url.trim()).origin;
    } catch {
      // Invalid URLs are reported by the service worker below.
    }
    if (origin !== null && !(await services.hostAccess.request([`${origin}/*`]))) {
      setFeedback({ kind: 'error', text: OPTIONS_TEXT.permissionDenied });
      return;
    }
    const saved = await services.rpc.call(
      'receiver.configure',
      token === '' ? { baseUrl: url } : { baseUrl: url, token },
    );
    if (!saved.ok) {
      setFeedback({ kind: 'error', text: saved.error.message });
      return;
    }
    setToken('');
    await load();
    await check();
  };

  const check = async () => {
    const projects = await services.rpc.call('projects.list', {});
    setFeedback(
      projects.ok
        ? { kind: 'ok', text: OPTIONS_TEXT.projectsFound(projects.value.projects.length) }
        : { kind: 'error', text: projects.error.message },
    );
  };

  const clear = async () => {
    const cleared = await services.rpc.call('receiver.clear', {});
    if (!cleared.ok) setFeedback({ kind: 'error', text: cleared.error.message });
    else {
      setFeedback({ kind: 'none' });
      await load();
    }
  };

  return (
    <section class="card">
      <h2>{OPTIONS_TEXT.receiverTitle}</h2>
      <p class="muted">{OPTIONS_TEXT.receiverHint}</p>
      <form
        class="form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label>
          <span class="label">{OPTIONS_TEXT.url}</span>
          <input
            data-testid="receiver-url"
            type="url"
            required
            value={url}
            placeholder={OPTIONS_TEXT.urlPlaceholder}
            onInput={(event) => {
              setUrl(event.currentTarget.value);
            }}
          />
        </label>
        <label>
          <span class="label">{OPTIONS_TEXT.token}</span>
          <input
            data-testid="receiver-token"
            type="password"
            autocomplete="off"
            value={token}
            placeholder={
              stored?.hasToken === true ? OPTIONS_TEXT.tokenKept : OPTIONS_TEXT.tokenNone
            }
            onInput={(event) => {
              setToken(event.currentTarget.value);
            }}
          />
        </label>
        <div class="actions">
          <button type="submit" class="primary" data-testid="receiver-save">
            {OPTIONS_TEXT.save}
          </button>
          {stored !== null && (
            <>
              <button type="button" onClick={() => void check()}>
                {OPTIONS_TEXT.check}
              </button>
              <button type="button" class="danger" onClick={() => void clear()}>
                {OPTIONS_TEXT.clear}
              </button>
            </>
          )}
        </div>
      </form>
      {feedback.kind !== 'none' && (
        <p
          role={feedback.kind === 'error' ? 'alert' : 'status'}
          class={feedback.kind === 'error' ? 'error' : 'muted'}
          data-testid="receiver-feedback"
        >
          {feedback.text}
        </p>
      )}
    </section>
  );
};
