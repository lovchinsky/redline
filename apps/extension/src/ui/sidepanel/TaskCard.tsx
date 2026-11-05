import { isTerminal } from '@redline/core';
import type { TaskSummary } from '@redline/rpc';
import { useState } from 'preact/hooks';
import type { UiServices } from '../services';
import { useTranslator } from '../shared/i18n';
import { describeTaskState, titleOf } from './task-state';
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
      <p data-testid="question">{question.text}</p>
      {question.options !== undefined && (
        <div class="actions">
          {question.options.map((option) => (
            <button key={option} type="button" disabled={sending} onClick={() => void send(option)}>
              {option}
            </button>
          ))}
        </div>
      )}
      <textarea
        aria-label={t.text('answerLabel')}
        rows={2}
        value={answer}
        onInput={(event) => {
          setAnswer(event.currentTarget.value);
        }}
      />
      <button type="submit" disabled={sending || answer.trim() === ''}>
        {t.text('answer')}
      </button>
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
  return (
    <li
      class="task card"
      data-testid="task"
      data-state={state.kind}
      data-phase={status?.phase}
      data-attempts={state.kind === 'queued' ? state.attempts : undefined}
    >
      <h3>{titleOf(t, task)}</h3>
      <p class="muted">
        {state.kind === 'draft' ? '' : state.projectName} · {t.count('stepCount', task.stepCount)}
      </p>
      <p class="state" data-testid="task-state">
        {describeTaskState(t, task)}
      </p>
      {status?.phase === 'needs-input' && (
        <QuestionForm task={task} question={status.question} actions={actions} />
      )}
      <div class="actions">
        {status?.phase === 'result-ready' && (
          <button type="button" onClick={() => void services.navigation.openUrl(status.resultUrl)}>
            {t.text('openResult')}
          </button>
        )}
        {state.kind === 'queued' && (
          <button
            type="button"
            onClick={() => {
              actions.retry(task.id);
            }}
          >
            {t.text('retry')}
          </button>
        )}
        {state.kind === 'failed' && (
          <>
            <button
              type="button"
              onClick={() => {
                actions.retry(task.id);
              }}
            >
              {t.text('retrySend')}
            </button>
            <button
              type="button"
              onClick={() => {
                actions.reopen(task.id);
              }}
            >
              {t.text('reopen')}
            </button>
          </>
        )}
        {status !== null && !isTerminal(status) && (
          <button
            type="button"
            data-testid="refresh"
            onClick={() => {
              actions.refresh(task.id);
            }}
          >
            {t.text('refresh')}
          </button>
        )}
        {state.kind !== 'queued' && (
          <button
            type="button"
            class="danger"
            onClick={() => {
              actions.remove(task.id);
            }}
          >
            {t.text('deleteTask')}
          </button>
        )}
      </div>
    </li>
  );
};
