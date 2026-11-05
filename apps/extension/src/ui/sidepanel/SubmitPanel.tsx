import { hostPermissionOf, parseBindingPattern } from '@redline/core';
import type { DeliveryTarget, DraftView, ProjectRef } from '@redline/rpc';
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { UiServices } from '../services';
import { PANEL_TEXT } from './copy';

type Projects =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly projects: readonly ProjectRef[] }
  | { readonly kind: 'not-configured' }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Sends the draft. The project comes from the bindings of the draft's sites; for a site seen
 * for the first time the user picks it once, and the site is remembered for that project.
 */
export const SubmitPanel = ({ services, draft }: { services: UiServices; draft: DraftView }) => {
  const [target, setTarget] = useState<DeliveryTarget | null>(null);
  const [projects, setProjects] = useState<Projects>({ kind: 'loading' });
  const [chosen, setChosen] = useState<ProjectRef | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
          : { kind: 'failed', message: listed.error.message },
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
    if (!sent.ok) setError(sent.error.message);
  };

  return (
    <section class="card submit" aria-live="polite">
      <h2>{PANEL_TEXT.sendTitle}</h2>
      {target.conflict ? (
        <p class="error">{PANEL_TEXT.conflict}</p>
      ) : projects.kind === 'not-configured' && target.project === null ? (
        <p>
          {PANEL_TEXT.noReceiver}{' '}
          <button type="button" onClick={() => void services.navigation.openSettings()}>
            {PANEL_TEXT.openSettings}
          </button>
        </p>
      ) : (
        <>
          {target.project === null && (
            <label>
              <span class="label">{PANEL_TEXT.project}</span>
              <select
                data-testid="project-select"
                value={chosen?.id ?? ''}
                onChange={(event) => {
                  const id = event.currentTarget.value;
                  const options = projects.kind === 'ready' ? projects.projects : [];
                  setChosen(options.find((option) => option.id === id) ?? null);
                }}
              >
                <option value="">{PANEL_TEXT.chooseProject}</option>
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
            <p class="muted">{PANEL_TEXT.bindHint(unbound.join(', '))}</p>
          )}
          {projects.kind === 'failed' && <p class="error">{projects.message}</p>}
          {error !== null && (
            <p role="alert" class="error">
              {error}
            </p>
          )}
          <button
            type="button"
            class="primary"
            data-testid="send"
            disabled={project === null || sending}
            onClick={() => void send()}
          >
            {sending ? PANEL_TEXT.sending : PANEL_TEXT.sendTo(project?.name ?? '…')}
          </button>
        </>
      )}
    </section>
  );
};
