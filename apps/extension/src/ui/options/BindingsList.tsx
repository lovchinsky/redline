import { hostPermissionOf, parseBindingPattern, type Binding } from '@redline/core';
import type { ProjectRef } from '@redline/rpc';
import { useCallback, useEffect, useState } from 'preact/hooks';
import type { UiServices } from '../services';
import { OPTIONS_TEXT } from './copy';

/** Site patterns and the projects they send to; adding one asks for access to that site. */
export const BindingsList = ({ services }: { services: UiServices }) => {
  const [bindings, setBindings] = useState<readonly Binding[]>([]);
  const [projects, setProjects] = useState<readonly ProjectRef[]>([]);
  const [pattern, setPattern] = useState('');
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [listed, available] = await Promise.all([
      services.rpc.call('bindings.list', {}),
      services.rpc.call('projects.list', {}),
    ]);
    if (listed.ok) setBindings(listed.value.bindings);
    else setError(listed.error.message);
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
      setError(parsed.error.message);
      return;
    }
    if (project === undefined) return;
    // Optional: capture on a bound site then starts without a gesture.
    await services.hostAccess.request([hostPermissionOf(parsed.value)]);
    const bound = await services.rpc.call('bindings.set', { pattern, project });
    if (!bound.ok) setError(bound.error.message);
    else setPattern('');
  };

  const remove = async (target: string) => {
    const removed = await services.rpc.call('bindings.remove', { pattern: target });
    if (!removed.ok) setError(removed.error.message);
  };

  return (
    <section class="card">
      <h2>{OPTIONS_TEXT.bindingsTitle}</h2>
      <p class="muted">{OPTIONS_TEXT.bindingsHint}</p>
      {bindings.length === 0 ? (
        <p class="muted" data-testid="no-bindings">
          {OPTIONS_TEXT.noBindings}
        </p>
      ) : (
        <table class="bindings">
          <thead>
            <tr>
              <th>{OPTIONS_TEXT.pattern}</th>
              <th>{OPTIONS_TEXT.project}</th>
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
                  <button type="button" onClick={() => void remove(binding.pattern)}>
                    {OPTIONS_TEXT.remove}
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
            <span class="label">{OPTIONS_TEXT.pattern}</span>
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
            <span class="label">{OPTIONS_TEXT.project}</span>
            <select
              value={projectId}
              onChange={(event) => {
                setProjectId(event.currentTarget.value);
              }}
            >
              <option value="">{OPTIONS_TEXT.chooseProject}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={pattern.trim() === '' || projectId === ''}>
            {OPTIONS_TEXT.add}
          </button>
        </form>
      )}
      {error !== null && (
        <p role="alert" class="error">
          {error}
        </p>
      )}
    </section>
  );
};
