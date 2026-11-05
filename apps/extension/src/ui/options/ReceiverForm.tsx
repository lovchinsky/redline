import type { AppError } from '@redline/core';
import type { ReceiverView } from '@redline/rpc';
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { UiServices } from '../services';
import { CircleAlert, CircleCheck } from 'lucide-preact';
import { Button } from '../kit/Button';
import { describeError } from '../shared/errors';
import { useTranslator } from '../shared/i18n';
import { SettingsSection } from './SettingsSection';

type Feedback =
  | { readonly kind: 'none' }
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'error'; readonly error: AppError }
  | { readonly kind: 'denied' };

/** The receiver's address and token. The token is write-only: the page never reads it back. */
export const ReceiverForm = ({ services }: { services: UiServices }) => {
  const t = useTranslator();
  const [stored, setStored] = useState<ReceiverView | null>(null);
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [feedback, setFeedback] = useState<Feedback>({ kind: 'none' });

  const load = useCallback(async () => {
    const receiver = await services.rpc.call('receiver.get', {});
    if (!receiver.ok) {
      setFeedback({ kind: 'error', error: receiver.error });
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
      setFeedback({ kind: 'denied' });
      return;
    }
    const saved = await services.rpc.call(
      'receiver.configure',
      token === '' ? { baseUrl: url } : { baseUrl: url, token },
    );
    if (!saved.ok) {
      setFeedback({ kind: 'error', error: saved.error });
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
        ? { kind: 'ok', text: t.text('projectsFound', t.number(projects.value.projects.length)) }
        : { kind: 'error', error: projects.error },
    );
  };

  const clear = async () => {
    const cleared = await services.rpc.call('receiver.clear', {});
    if (!cleared.ok) setFeedback({ kind: 'error', error: cleared.error });
    else {
      setFeedback({ kind: 'none' });
      await load();
    }
  };

  return (
    <SettingsSection
      id="receiver"
      title={t.text('receiverTitle')}
      description={t.text('receiverHint')}
    >
      <form
        class="settings-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label class="field">
          <span class="field-label">{t.text('receiverUrl')}</span>
          <input
            class="input"
            data-testid="receiver-url"
            type="url"
            required
            value={url}
            placeholder="https://receiver.example.com"
            onInput={(event) => {
              setUrl(event.currentTarget.value);
            }}
          />
        </label>
        <label class="field">
          <span class="field-label">{t.text('receiverToken')}</span>
          <input
            class="input"
            data-testid="receiver-token"
            type="password"
            autocomplete="off"
            value={token}
            placeholder={stored?.hasToken === true ? t.text('tokenKept') : t.text('tokenNone')}
            onInput={(event) => {
              setToken(event.currentTarget.value);
            }}
          />
        </label>
        {feedback.kind !== 'none' && (
          <p
            role={feedback.kind === 'ok' ? 'status' : 'alert'}
            class={feedback.kind === 'ok' ? 'status-line ok' : 'alert'}
            data-testid="receiver-feedback"
          >
            {feedback.kind === 'ok' ? (
              <CircleCheck size={14} aria-hidden="true" />
            ) : (
              <CircleAlert size={14} aria-hidden="true" />
            )}
            <span>
              {feedback.kind === 'ok'
                ? feedback.text
                : feedback.kind === 'denied'
                  ? t.text('permissionDenied')
                  : describeError(t, feedback.error)}
            </span>
          </p>
        )}
        <div class="form-actions">
          {stored !== null && (
            <>
              <Button variant="danger" onClick={() => void clear()}>
                {t.text('disconnect')}
              </Button>
              <Button onClick={() => void check()}>{t.text('check')}</Button>
            </>
          )}
          <Button type="submit" variant="primary" data-testid="receiver-save">
            {t.text('save')}
          </Button>
        </div>
      </form>
    </SettingsSection>
  );
};
