import { hostPermissionOf, parseBindingPattern, type AppError } from '@redline/core';
import type { DeliveryTarget, DraftView, ProjectRef } from '@redline/rpc';
import { Eye, PlugZap, Send, TriangleAlert } from 'lucide-preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { Button } from '../kit/Button';
import type { UiServices } from '../services';
import { ErrorAlert } from '../shared/ErrorAlert';
import { useTranslator } from '../shared/i18n';

type Projects =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly projects: readonly ProjectRef[] }
  | { readonly kind: 'not-configured' }
  | { readonly kind: 'failed'; readonly error: AppError };

interface ActionBarProps {
  readonly services: UiServices;
  readonly draft: DraftView;
  readonly onPreview: () => void;
}

/**
 * The draft's actions, pinned under the steps: preview what the agent gets, and send it. The
 * project comes from the bindings of the draft's sites; for a site seen for the first time the
 * user picks it once, and the site is remembered for that project.
 */
export const ActionBar = ({ services, draft, onPreview }: ActionBarProps) => {
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

  const unbound =
    target?.sites.filter((site) => site.binding === null).map((site) => site.origin) ?? [];
  const project = target?.project ?? chosen;
  const receiverMissing = projects.kind === 'not-configured' && target?.project === null;
  const choosing =
    target !== null && !target.conflict && !receiverMissing && target.project === null;

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
    // The revision on screen is what the user approves; the project is the one shown, which
    // the service worker binds the unbound sites to (and checks against the bound ones).
    const sent = await services.rpc.call('task.submit', {
      taskId: draft.id,
      revision: draft.revision,
      project,
    });
    setSending(false);
    if (!sent.ok) setError(sent.error);
  };

  return (
    <footer class="action-bar" aria-label={t.text('sendTitle')} aria-live="polite">
      {target?.conflict === true && (
        <p class="note warning">
          <TriangleAlert size={14} aria-hidden="true" />
          <span>{t.text('projectConflict')}</span>
        </p>
      )}
      {receiverMissing && (
        <div class="note">
          <PlugZap size={14} aria-hidden="true" />
          <span class="grow">{t.text('connectReceiverHint')}</span>
          <Button size="sm" onClick={() => void services.navigation.openSettings()}>
            {t.text('connectReceiver')}
          </Button>
        </div>
      )}
      {choosing && (
        <label class="field">
          <span class="field-label">{t.text('project')}</span>
          <select
            class="select"
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
          {project !== null && unbound.length > 0 && (
            <span class="field-hint">{t.text('bindHint', unbound.join(', '))}</span>
          )}
        </label>
      )}
      {projects.kind === 'failed' && <ErrorAlert error={projects.error} />}
      <ErrorAlert error={error} />
      <div class="action-row">
        <Button
          data-testid="assemble"
          icon={<Eye size={15} aria-hidden="true" />}
          onClick={onPreview}
        >
          {t.text('preview')}
        </Button>
        {target !== null && !target.conflict && !receiverMissing && (
          <Button
            variant="primary"
            grow
            data-testid="send"
            disabled={project === null || sending}
            icon={<Send size={15} aria-hidden="true" />}
            onClick={() => void send()}
          >
            {sending ? t.text('sending') : t.text('sendTo', project?.name ?? '…')}
          </Button>
        )}
      </div>
    </footer>
  );
};
