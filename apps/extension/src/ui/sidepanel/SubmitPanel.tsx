import { hostPermissionOf, parseBindingPattern } from '@redline/core';
import type { DeliveryTarget, DraftView, ProjectRef } from '@redline/rpc';
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { UiServices } from '../services';
import type { AppError } from '@redline/core';
import { ErrorAlert } from '../shared/ErrorAlert';
import { useTranslator } from '../shared/i18n';

type Projects =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly projects: readonly ProjectRef[] }
  | { readonly kind: 'not-configured' }
  | { readonly kind: 'failed'; readonly error: AppError };

/**
 * Sends the draft. The project comes from the bindings of the draft's sites; for a site seen
 * for the first time the user picks it once, and the site is remembered for that project.
 */
export const SubmitPanel = ({ services, draft }: { services: UiServices; draft: DraftView }) => {
  const t = useTranslator();
  const [target, setTarget] = useState<DeliveryTarget | null>(null);
  const [projects, setProjects] = useState<Projects>({ kind: 'loading' });
  const [chosen, setChosen] = useState<ProjectRef | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<AppError | null>(null);

  const load = useCallback(async () => {
    const [resolved, listed] = await Promise.all([
      services.rpc.call('task.deliveryTarget', { taskId: draft.id }),
      services.rpc.call('projects.list', {}),
    ]);
    setTarget(resolved.ok ? resolved.value : null);
    setProjects(
      listed.ok
        ? { kind: 'ready', projects: listed.value.projects }
        : listed.error.code === 'not-configured'
          ? { kind: 'not-configured' }
          : { kind: 'failed', error: listed.error },
    );
  }, [services, draft.id]);

  useEffect(() => {
    void load();
    return services.events.on('settings.changed', () => void load());
  }, [services, load, draft.revision]);

  if (target === null) return null;
  const unbound = target.sites.filter((site) => site.binding === null).map((site) => site.origin);
  const project = target.project ?? chosen;

  const send = async () => {
    if (project === null) return;
    setSending(true);
    setError(null);
    // Asked first, while the click still counts as a user gesture. Optional: the binding
    // works without it; with it, capture on that site starts without a gesture.
    await services.hostAccess.request(
      unbound.flatMap((origin) => {
        const pattern = parseBindingPattern(origin);
        return pattern.ok ? [hostPermissionOf(pattern.value)] : [];
      }),
    );
    const sent = await services.rpc.call('task.submit', {
      taskId: draft.id,
      project: unbound.length > 0 ? project : null,
    });
    setSending(false);
    if (!sent.ok) setError(sent.error);
  };

  return (
    <section class="card submit" aria-live="polite">
      <h2>{t.text('sendTitle')}</h2>
      {target.conflict ? (
        <p class="error">{t.text('projectConflict')}</p>
      ) : projects.kind === 'not-configured' && target.project === null ? (
        <p>
          {t.text('noReceiver')}{' '}
          <button type="button" onClick={() => void services.navigation.openSettings()}>
            {t.text('openSettings')}
          </button>
        </p>
      ) : (
        <>
          {target.project === null && (
            <label>
              <span class="label">{t.text('project')}</span>
              <select
                data-testid="project-select"
                value={chosen?.id ?? ''}
                onChange={(event) => {
                  const id = event.currentTarget.value;
                  const options = projects.kind === 'ready' ? projects.projects : [];
                  setChosen(options.find((option) => option.id === id) ?? null);
                }}
              >
                <option value="">{t.text('chooseProject')}</option>
                {projects.kind === 'ready' &&
                  projects.projects.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {project !== null && unbound.length > 0 && (
            <p class="muted">{t.text('bindHint', unbound.join(', '))}</p>
          )}
          {projects.kind === 'failed' && <ErrorAlert error={projects.error} />}
          <ErrorAlert error={error} />
          <button
            type="button"
            class="primary"
            data-testid="send"
            disabled={project === null || sending}
            onClick={() => void send()}
          >
            {sending ? t.text('sending') : t.text('sendTo', project?.name ?? '…')}
          </button>
        </>
      )}
    </section>
  );
};
