import type { TaskId } from '@redline/core';
import type { TaskView } from '@redline/rpc';
import { Inbox } from 'lucide-preact';
import type { UiServices } from '../services';
import { TaskCard } from './TaskCard';
import type { TaskActions } from './use-tasks';

export const TasksPanel = ({
  services,
  tasks,
  actions,
  empty,
  onOpen,
}: {
  services: UiServices;
  tasks: readonly TaskView[];
  actions: TaskActions;
  empty: string;
  onOpen: (taskId: TaskId) => void;
}) =>
  tasks.length === 0 ? (
    <div class="panel-content">
      <div class="empty compact">
        <Inbox size={28} class="empty-icon" aria-hidden="true" />
        <p class="muted">{empty}</p>
      </div>
    </div>
  ) : (
    <div class="panel-content">
      <ul class="tasks">
        {tasks.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            actions={actions}
            services={services}
            onOpen={() => {
              onOpen(task.id);
            }}
          />
        ))}
      </ul>
    </div>
  );
