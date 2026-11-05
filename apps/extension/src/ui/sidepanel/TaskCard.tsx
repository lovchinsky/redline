import { isTerminal } from '@redline/core';
import type { TaskSummary } from '@redline/rpc';
import { useState } from 'preact/hooks';
import type { UiServices } from '../services';
import { PANEL_TEXT, STATE_TEXT, formatTime } from './copy';
import type { TaskActions } from './use-tasks';

const titleOf = (task: TaskSummary): string =>
  task.title ?? task.firstComment ?? PANEL_TEXT.emptyDraft;

const stateLine = (task: TaskSummary): string => {
  const { state } = task;
  switch (state.kind) {
    case 'draft':
      return '';
    case 'queued':
      return state.lastError === null
        ? STATE_TEXT.queued
        : STATE_TEXT.retryAt(formatTime(state.nextAttemptAt), state.lastError.message);
    case 'failed':
      return STATE_TEXT.failed(state.error.message);
    case 'submitted':
      return state.status.phase === 'failed'
        ? `${STATE_TEXT.remote.failed}: ${state.status.reason}`
        : STATE_TEXT.remote[state.status.phase];
  }
};

const QuestionForm = ({
  task,
  question,
  actions,
}: {
  task: TaskSummary;
  question: { id: string; text: string; options?: readonly string[] | undefined };
  actions: TaskActions;
}) => {
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
        aria-label={PANEL_TEXT.answerLabel}
        rows={2}
        value={answer}
        onInput={(event) => {
          setAnswer(event.currentTarget.value);
        }}
      />
      <button type="submit" disabled={sending || answer.trim() === ''}>
        {PANEL_TEXT.answer}
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
      <h3>{titleOf(task)}</h3>
      <p class="muted">
        {state.kind === 'draft' ? '' : state.projectName} · {PANEL_TEXT.stepCount(task.stepCount)}
      </p>
      <p class="state" data-testid="task-state">
        {stateLine(task)}
      </p>
      {status?.phase === 'needs-input' && (
        <QuestionForm task={task} question={status.question} actions={actions} />
      )}
      <div class="actions">
        {status?.phase === 'result-ready' && (
          <button type="button" onClick={() => void services.navigation.openUrl(status.resultUrl)}>
            {PANEL_TEXT.openResult}
          </button>
        )}
        {state.kind === 'queued' && (
          <button
            type="button"
            onClick={() => {
              actions.retry(task.id);
            }}
          >
            {PANEL_TEXT.retry}
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
              {PANEL_TEXT.retrySend}
            </button>
            <button
              type="button"
              onClick={() => {
                actions.reopen(task.id);
              }}
            >
              {PANEL_TEXT.reopen}
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
            {PANEL_TEXT.refresh}
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
            {PANEL_TEXT.deleteTask}
          </button>
        )}
      </div>
    </li>
  );
};
