import { useState } from 'preact/hooks';
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
  const active = tasks.active.length;

  return (
    <main>
      <h1>{t.text('extName')}</h1>
      <Tabs
        label={t.text('panelLabel')}
        selected={tab}
        onSelect={setTab}
        tabs={[
          { id: 'draft', label: t.text('tabDraft') },
          {
            id: 'active',
            label: active === 0 ? t.text('tabActive') : t.text('tabActiveCount', t.number(active)),
          },
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
