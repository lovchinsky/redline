import type { TaskView } from '@redline/rpc';
import { ChevronRight, Ellipsis, RefreshCw, Trash } from 'lucide-preact';
import { IconButton } from '../kit/Button';
import { Menu } from '../kit/Menu';
import type { UiServices } from '../services';
import { useTranslator } from '../shared/i18n';
import { metaOf, titleOf } from './task-state';
import { TaskProgress } from './TaskProgress';
import type { TaskActions } from './use-tasks';

export const TaskCard = ({
  task,
  actions,
  services,
  onOpen,
}: {
  task: TaskView;
  actions: TaskActions;
  services: UiServices;
  /** Opens the task's sheet: everything it asked for. */
  onOpen: () => void;
}) => {
  const t = useTranslator();
  const { status } = task;
  const remote = status.kind === 'with-agent' ? status.remote : null;
  const can = (action: TaskView['actions'][number]) => task.actions.includes(action);

  return (
    <li
      class="task"
      data-testid="task"
      data-state={status.kind}
      data-phase={remote?.phase}
      data-attempts={status.kind === 'sending' ? status.attempts : undefined}
    >
      <div class="task-head">
        <h3 class="task-title">
          {/* The whole title is a target for the pointer; the keyboard has the button beside it. */}
          <button
            type="button"
            class="task-open"
            data-testid="task-open"
            tabIndex={-1}
            onClick={onOpen}
          >
            {titleOf(t, task)}
          </button>
        </h3>
        {can('refresh') && (
          <IconButton
            label={t.text('refresh')}
            data-testid="refresh"
            onClick={() => {
              actions.refresh(task.id);
            }}
          >
            <RefreshCw size={14} />
          </IconButton>
        )}
        {can('delete') && (
          <Menu
            label={t.text('moreActions')}
            align="end"
            items={[
              {
                key: 'delete',
                label: t.text('deleteTask'),
                icon: <Trash size={14} aria-hidden="true" />,
                danger: true,
                onSelect: () => {
                  actions.remove(task.id);
                },
              },
            ]}
            trigger={(props) => (
              <IconButton label={t.text('moreActions')} {...props}>
                <Ellipsis size={16} />
              </IconButton>
            )}
          />
        )}
        <IconButton label={t.text('openTask')} aria-haspopup="dialog" onClick={onOpen}>
          <ChevronRight size={16} />
        </IconButton>
      </div>
      <p class="task-meta" data-testid="task-meta">
        {metaOf(t, task)}
      </p>
      <TaskProgress task={task} actions={actions} services={services} />
    </li>
  );
};
