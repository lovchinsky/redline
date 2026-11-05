import { Settings } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { IconButton } from '../kit/Button';
import type { UiServices } from '../services';
import { ErrorAlert } from '../shared/ErrorAlert';
import { TranslatorProvider, useTranslator } from '../shared/i18n';
import { Tabs } from '../shared/Tabs';
import { DraftsPanel } from './DraftsPanel';
import { TasksPanel } from './TasksPanel';
import { useTasks } from './use-tasks';

type Tab = 'draft' | 'active' | 'history';

const Panel = ({ services }: { services: UiServices }) => {
  const t = useTranslator();
  const [tab, setTab] = useState<Tab>('draft');
  const [tasks, actions] = useTasks(services);

  return (
    <main class="panel">
      {/* Chrome's side panel already shows the extension's icon and name above the page. */}
      <h1 class="sr-only">{t.text('extName')}</h1>
      <Tabs
        label={t.text('panelLabel')}
        selected={tab}
        onSelect={setTab}
        trailing={
          <IconButton
            label={t.text('openSettings')}
            onClick={() => void services.navigation.openSettings()}
          >
            <Settings size={16} />
          </IconButton>
        }
        tabs={[
          { id: 'draft', label: t.text('tabDraft') },
          { id: 'active', label: t.text('tabActive'), count: tasks.active.length },
          { id: 'history', label: t.text('tabHistory') },
        ]}
      >
        <ErrorAlert error={tasks.error} />
        {tab === 'draft' && <DraftsPanel services={services} />}
        {tab === 'active' && (
          <TasksPanel
            services={services}
            tasks={tasks.active}
            actions={actions}
            empty={t.text('noTasks')}
          />
        )}
        {tab === 'history' && (
          <TasksPanel
            services={services}
            tasks={tasks.history}
            actions={actions}
            empty={t.text('noHistory')}
          />
        )}
      </Tabs>
    </main>
  );
};

export const App = ({ services }: { services: UiServices }) => (
  <TranslatorProvider translator={services.i18n}>
    <Panel services={services} />
  </TranslatorProvider>
);
