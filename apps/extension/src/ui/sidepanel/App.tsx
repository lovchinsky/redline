import { Settings } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { IconButton } from '../kit/Button';
import { Logo } from '../kit/Logo';
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
      <header class="panel-header">
        <h1 class="brand">
          <Logo />
          {t.text('extName')}
        </h1>
        <IconButton
          label={t.text('openSettings')}
          onClick={() => void services.navigation.openSettings()}
        >
          <Settings size={16} />
        </IconButton>
      </header>
      <Tabs
        label={t.text('panelLabel')}
        selected={tab}
        onSelect={setTab}
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
