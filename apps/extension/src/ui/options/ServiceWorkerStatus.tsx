import { useCallback, useEffect, useState } from 'preact/hooks';
import type { UiServices } from '../services';
import { Button } from '../kit/Button';
import { describeError } from '../shared/errors';
import { useTranslator } from '../shared/i18n';

type Status =
  | { kind: 'checking' }
  | { kind: 'connected'; version: string; roundTripMs: number }
  | { kind: 'unreachable'; message: string };

/** Whether the background process answers, its version, and the round trip of a ping. */
export const ServiceWorkerStatus = ({ services }: { services: UiServices }) => {
  const t = useTranslator();
  const [status, setStatus] = useState<Status>({ kind: 'checking' });
  const [pings, setPings] = useState(0);

  const ping = useCallback(async () => {
    setStatus({ kind: 'checking' });
    const startedAt = services.clock.now();
    const result = await services.rpc.call('system.ping', { nonce: services.ids.next() });
    setStatus(
      result.ok
        ? {
            kind: 'connected',
            version: result.value.version,
            roundTripMs: services.clock.now() - startedAt,
          }
        : { kind: 'unreachable', message: describeError(t, result.error) },
    );
  }, [services, t]);

  useEffect(
    () =>
      services.events.on('system.pinged', () => {
        setPings((n) => n + 1);
      }),
    [services],
  );

  useEffect(() => {
    void ping();
  }, [ping]);

  return (
    <div class="sw-status" aria-live="polite">
      <span class="status-dot" data-status={status.kind} aria-hidden="true" />
      <span class="grow">
        <span class="muted">{t.text('swTitle')}: </span>
        <span data-testid="sw-status" data-status={status.kind}>
          {status.kind === 'checking' && t.text('swChecking')}
          {status.kind === 'connected' &&
            t.text('swConnected', status.version, t.number(status.roundTripMs))}
          {status.kind === 'unreachable' && t.text('swUnreachable', status.message)}
        </span>
        <span class="faint">
          {' · '}
          {t.text('swPingEvents')} <span data-testid="ping-events">{pings}</span>
        </span>
      </span>
      <Button size="sm" variant="ghost" data-testid="ping" onClick={() => void ping()}>
        {t.text('swCheckAgain')}
      </Button>
    </div>
  );
};
