import { useState } from 'preact/hooks';
import type { UiServices } from '../services';
import { ConnectionStatus } from './ConnectionStatus';
import { PANEL_TEXT } from './copy';
import { DraftsPanel } from './DraftsPanel';
import { TasksPanel } from './TasksPanel';
import { useTasks } from './use-tasks';

type Tab = 'draft' | 'active' | 'history';

export const App = ({ services }: { services: UiServices }) => {
  const [tab, setTab] = useState<Tab>('draft');
  const [tasks, actions] = useTasks(services);
  const tabs: readonly { id: Tab; label: string }[] = [
    { id: 'draft', label: PANEL_TEXT.tabDraft },
    {
      id: 'active',
      label:
        tasks.active.length === 0
          ? PANEL_TEXT.tabActive
          : `${PANEL_TEXT.tabActive} (${String(tasks.active.length)})`,
    },
    { id: 'history', label: PANEL_TEXT.tabHistory },
  ];

  return (
    <main>
      <header>
        <h1>Redline</h1>
        <nav class="tabs" role="tablist">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              data-testid={`tab-${id}`}
              aria-selected={tab === id}
              onClick={() => {
                setTab(id);
              }}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>
      {tasks.error !== null && (
        <p role="alert" class="error">
          {tasks.error}
        </p>
      )}
      {tab === 'draft' && <DraftsPanel services={services} />}
      {tab === 'active' && (
        <TasksPanel
          services={services}
          tasks={tasks.active}
          actions={actions}
          empty={PANEL_TEXT.noTasks}
        />
      )}
      {tab === 'history' && (
        <TasksPanel
          services={services}
          tasks={tasks.history}
          actions={actions}
          empty={PANEL_TEXT.noHistory}
        />
      )}
      <ConnectionStatus services={services} />
    </main>
  );
};
