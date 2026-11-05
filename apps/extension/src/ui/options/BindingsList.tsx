import { hostPermissionOf, parseBindingPattern, type AppError, type Binding } from '@redline/core';
import type { ProjectRef } from '@redline/rpc';
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { UiServices } from '../services';
import { ErrorAlert } from '../shared/ErrorAlert';
import { useTranslator } from '../shared/i18n';

/** Site patterns and the projects they send to; adding one asks for access to that site. */
export const BindingsList = ({ services }: { services: UiServices }) => {
  const t = useTranslator();
  const [bindings, setBindings] = useState<readonly Binding[]>([]);
  const [projects, setProjects] = useState<readonly ProjectRef[]>([]);
  const [pattern, setPattern] = useState('');
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<AppError | null>(null);

  const load = useCallback(async () => {
    const [listed, available] = await Promise.all([
      services.rpc.call('bindings.list', {}),
      services.rpc.call('projects.list', {}),
    ]);
    if (listed.ok) setBindings(listed.value.bindings);
    else setError(listed.error);
    setProjects(available.ok ? available.value.projects : []);
  }, [services]);

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
    <section class="card">
      <h2>{t.text('bindingsTitle')}</h2>
      <p class="muted">{t.text('bindingsHint')}</p>
      {bindings.length === 0 ? (
        <p class="muted" data-testid="no-bindings">
          {t.text('noBindings')}
        </p>
      ) : (
        <table class="bindings">
          <thead>
            <tr>
              <th>{t.text('site')}</th>
              <th>{t.text('project')}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {bindings.map((binding) => (
              <tr key={binding.pattern} data-testid="binding">
                <td>
                  <code>{binding.pattern}</code>
                </td>
                <td>{binding.projectName}</td>
                <td>
                  <button
                    type="button"
                    aria-label={t.text('removeBinding', binding.pattern)}
                    onClick={() => void remove(binding.pattern)}
                  >
                    {t.text('remove')}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {projects.length > 0 && (
        <form
          class="row"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <label class="grow">
            <span class="label">{t.text('site')}</span>
            <input
              type="text"
              value={pattern}
              placeholder="https://app.acme.io"
              onInput={(event) => {
                setPattern(event.currentTarget.value);
              }}
            />
          </label>
          <label>
            <span class="label">{t.text('project')}</span>
            <select
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
          <button type="submit" disabled={pattern.trim() === '' || projectId === ''}>
            {t.text('add')}
          </button>
        </form>
      )}
      <ErrorAlert error={error} />
    </section>
  );
};
