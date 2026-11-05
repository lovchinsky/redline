import { useCallback, useEffect, useState } from 'preact/hooks';
import type { UiServices } from '../services';

type Status =
  | { kind: 'checking' }
  | { kind: 'connected'; version: string; roundTripMs: number }
  | { kind: 'unreachable'; message: string };

export const ConnectionStatus = ({ services }: { services: UiServices }) => {
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
        : { kind: 'unreachable', message: result.error.message },
    );
  }, [services]);

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
    <section class="card" aria-live="polite">
      <h2>Service worker</h2>
      <p data-testid="sw-status" data-status={status.kind}>
        {status.kind === 'checking' && 'Перевіряю з’єднання…'}
        {status.kind === 'connected' &&
          `Підключено · v${status.version} · ${String(status.roundTripMs)} мс`}
        {status.kind === 'unreachable' && `Недоступний: ${status.message}`}
      </p>
      <p class="muted">
        Подій system.pinged отримано: <span data-testid="ping-events">{pings}</span>
      </p>
      <button type="button" data-testid="ping" onClick={() => void ping()}>
        Перевірити ще раз
      </button>
    </section>
  );
};
