import { isTerminal } from '@redline/core';
import type { TaskSummary } from '@redline/rpc';
import { Ellipsis, ExternalLink, RefreshCw, RotateCcw, Send, Trash, Undo2 } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { Badge } from '../kit/Badge';
import { Button, IconButton } from '../kit/Button';
import { Menu } from '../kit/Menu';
import type { UiServices } from '../services';
import { useTranslator } from '../shared/i18n';
import { describeTaskState, titleOf, toneOf } from './task-state';
import type { TaskActions } from './use-tasks';

const QuestionForm = ({
  task,
  question,
  actions,
}: {
  task: TaskSummary;
  question: { id: string; text: string; options?: readonly string[] | undefined };
  actions: TaskActions;
}) => {
  const t = useTranslator();
  const [answer, setAnswer] = useState('');
  const [sending, setSending] = useState(false);
  const send = async (text: string) => {
    setSending(true);
    if (await actions.reply(task.id, question.id, text)) setAnswer('');
    setSending(false);
  };
  return (
    <form
      class="question"
      onSubmit={(event) => {
        event.preventDefault();
        void send(answer);
      }}
    >
      <p class="question-text" data-testid="question">
        {question.text}
      </p>
      {question.options !== undefined && (
        <div class="question-options">
          {question.options.map((option) => (
            <Button key={option} size="sm" disabled={sending} onClick={() => void send(option)}>
              {option}
            </Button>
          ))}
        </div>
      )}
      <div class="question-answer">
        <textarea
          class="textarea"
          aria-label={t.text('answerLabel')}
          placeholder={t.text('answerLabel')}
          rows={2}
          value={answer}
          onInput={(event) => {
            setAnswer(event.currentTarget.value);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) void send(answer);
          }}
        />
        <Button
          type="submit"
          variant="primary"
          size="sm"
          disabled={sending || answer.trim() === ''}
          icon={<Send size={14} aria-hidden="true" />}
        >
          {t.text('answer')}
        </Button>
      </div>
    </form>
  );
};

export const TaskCard = ({
  task,
  actions,
  services,
}: {
  task: TaskSummary;
  actions: TaskActions;
  services: UiServices;
}) => {
  const t = useTranslator();
  const { state } = task;
  const status = state.kind === 'submitted' ? state.status : null;
  const followable = status !== null && !isTerminal(status);

  return (
    <li
      class="task"
      data-testid="task"
      data-state={state.kind}
      data-phase={status?.phase}
      data-attempts={state.kind === 'queued' ? state.attempts : undefined}
    >
      <div class="task-head">
        <h3 class="task-title">{titleOf(t, task)}</h3>
        {followable && (
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
        {state.kind !== 'queued' && (
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
      </div>
      <p class="task-meta">
        {state.kind === 'draft' ? '' : `${state.projectName} · `}
        {t.count('stepCount', task.stepCount)} · {t.time(task.updatedAt)}
      </p>
      <Badge tone={toneOf(task)} data-testid="task-state">
        {describeTaskState(t, task)}
      </Badge>
      {status?.phase === 'needs-input' && (
        <QuestionForm task={task} question={status.question} actions={actions} />
      )}
      {(status?.phase === 'result-ready' || state.kind === 'queued' || state.kind === 'failed') && (
        <div class="task-actions">
          {status?.phase === 'result-ready' && (
            <Button
              variant="primary"
              size="sm"
              icon={<ExternalLink size={14} aria-hidden="true" />}
              onClick={() => void services.navigation.openUrl(status.resultUrl)}
            >
              {t.text('openResult')}
            </Button>
          )}
          {state.kind === 'queued' && (
            <Button
              size="sm"
              icon={<RotateCcw size={14} aria-hidden="true" />}
              onClick={() => {
                actions.retry(task.id);
              }}
            >
              {t.text('retry')}
            </Button>
          )}
          {state.kind === 'failed' && (
            <>
              <Button
                variant="primary"
                size="sm"
                icon={<RotateCcw size={14} aria-hidden="true" />}
                onClick={() => {
                  actions.retry(task.id);
                }}
              >
                {t.text('retrySend')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={<Undo2 size={14} aria-hidden="true" />}
                onClick={() => {
                  actions.reopen(task.id);
                }}
              >
                {t.text('reopen')}
              </Button>
            </>
          )}
        </div>
      )}
    </li>
  );
};
