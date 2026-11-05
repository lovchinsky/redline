import type { TaskSummary } from '@redline/rpc';
import type { UiServices } from '../services';
import { TaskCard } from './TaskCard';
import type { TaskActions } from './use-tasks';

export const TasksPanel = ({
  services,
  tasks,
  actions,
  empty,
}: {
  services: UiServices;
  tasks: readonly TaskSummary[];
  actions: TaskActions;
  empty: string;
}) =>
  tasks.length === 0 ? (
    <p class="muted">{empty}</p>
  ) : (
    <ul class="tasks">
      {tasks.map((task) => (
        <TaskCard key={task.id} task={task} actions={actions} services={services} />
      ))}
    </ul>
  );
