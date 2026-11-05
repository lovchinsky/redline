import { hostPermissionOf, parseBindingPattern, type AppError, type Binding } from '@redline/core';
import type { ProjectRef } from '@redline/rpc';
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { UiServices } from '../services';
import { Globe, Plus, Trash } from 'lucide-preact';
import { Button, IconButton } from '../kit/Button';
import { ErrorAlert } from '../shared/ErrorAlert';
import { useTranslator } from '../shared/i18n';
import { SettingsSection } from './SettingsSection';
import { useLatestLoad } from '../shared/use-latest-load';

/** Site patterns and the projects they send to; adding one asks for access to that site. */
export const BindingsList = ({ services }: { services: UiServices }) => {
  const t = useTranslator();
  const [bindings, setBindings] = useState<readonly Binding[]>([]);
  const [projects, setProjects] = useState<readonly ProjectRef[]>([]);
  const [pattern, setPattern] = useState('');
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<AppError | null>(null);

  const begin = useLatestLoad();
  const load = useCallback(async () => {
    const isLatest = begin();
    const [listed, available] = await Promise.all([
      services.rpc.call('bindings.list', {}),
      services.rpc.call('projects.list', {}),
    ]);
    if (!isLatest()) return;
    if (listed.ok) setBindings(listed.value.bindings);
    else setError(listed.error);
    setProjects(available.ok ? available.value.projects : []);
  }, [services, begin]);

  useEffect(() => {
    void load();
    return services.events.on('settings.changed', () => void load());
  }, [services, load]);

  const add = async () => {
    setError(null);
    const parsed = parseBindingPattern(pattern);
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (project === undefined) return;
    // Optional: capture on a bound site then starts without a gesture.
    await services.hostAccess.request([hostPermissionOf(parsed.value)]);
    const bound = await services.rpc.call('bindings.set', { pattern, project });
    if (!bound.ok) setError(bound.error);
    else setPattern('');
  };

  const remove = async (target: string) => {
    const removed = await services.rpc.call('bindings.remove', { pattern: target });
    if (!removed.ok) setError(removed.error);
  };

  return (
    <SettingsSection
      id="bindings"
      title={t.text('bindingsTitle')}
      description={t.text('bindingsHint')}
    >
      {bindings.length === 0 ? (
        <p class="list-empty" data-testid="no-bindings">
          {t.text('noBindings')}
        </p>
      ) : (
        <ul class="list" aria-label={t.text('bindingsTitle')}>
          {bindings.map((binding) => (
            <li key={binding.pattern} class="list-row" data-testid="binding">
              <Globe size={14} class="faint" aria-hidden="true" />
              <code class="grow">{binding.pattern}</code>
              <span class="muted">{binding.projectName}</span>
              <IconButton
                label={t.text('removeBinding', binding.pattern)}
                danger
                onClick={() => void remove(binding.pattern)}
              >
                <Trash size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      {projects.length > 0 && (
        <form
          class="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <label class="field grow">
            <span class="field-label">{t.text('site')}</span>
            <input
              class="input"
              type="text"
              value={pattern}
              placeholder="https://app.acme.io"
              onInput={(event) => {
                setPattern(event.currentTarget.value);
              }}
            />
          </label>
          <label class="field">
            <span class="field-label">{t.text('project')}</span>
            <select
              class="select"
              value={projectId}
              onChange={(event) => {
                setProjectId(event.currentTarget.value);
              }}
            >
              <option value="">{t.text('chooseProject')}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="submit"
            icon={<Plus size={14} aria-hidden="true" />}
            disabled={pattern.trim() === '' || projectId === ''}
          >
            {t.text('add')}
          </Button>
        </form>
      )}
      <ErrorAlert error={error} />
    </SettingsSection>
  );
};
