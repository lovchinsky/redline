import type { TaskId } from '@redline/core';
import { Settings } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { IconButton } from '../kit/Button';
import type { UiServices } from '../services';
import { ErrorAlert } from '../shared/ErrorAlert';
import { TranslatorProvider, useTranslator } from '../shared/i18n';
import { Tabs } from '../shared/Tabs';
import { DraftsPanel } from './DraftsPanel';
import { TaskSheet } from './TaskSheet';
import { TasksPanel } from './TasksPanel';
import { useTasks } from './use-tasks';

type Tab = 'draft' | 'active' | 'history';

const Panel = ({ services }: { services: UiServices }) => {
  const t = useTranslator();
  const [tab, setTab] = useState<Tab>('draft');
  const [tasks, actions] = useTasks(services);
  // Kept here, not in a tab: a task that finishes moves to History and its sheet stays open.
  const [openId, setOpenId] = useState<TaskId | null>(null);
  const opened =
    openId === null
      ? undefined
      : [...tasks.active, ...tasks.history].find((task) => task.id === openId);
  // A task deleted or reopened as a draft has nothing left to show: its sheet closes for good.
  const gone = openId !== null && !tasks.loading && opened === undefined;
  useEffect(() => {
    if (gone) setOpenId(null);
  }, [gone]);

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
            onOpen={setOpenId}
          />
        )}
        {tab === 'history' && (
          <TasksPanel
            services={services}
            tasks={tasks.history}
            actions={actions}
            empty={t.text('noHistory')}
            onOpen={setOpenId}
          />
        )}
      </Tabs>
      {opened !== undefined && (
        <TaskSheet
          key={opened.id}
          services={services}
          task={opened}
          actions={actions}
          onClose={() => {
            setOpenId(null);
          }}
        />
      )}
    </main>
  );
};

export const App = ({ services }: { services: UiServices }) => (
  <TranslatorProvider translator={services.i18n}>
    <Panel services={services} />
  </TranslatorProvider>
);
