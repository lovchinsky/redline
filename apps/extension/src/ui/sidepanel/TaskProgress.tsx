import { MAX_COMMENT_LENGTH } from '@redline/core';
import type { TaskView } from '@redline/rpc';
import { ExternalLink, RotateCcw, Send, Undo2 } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { Badge } from '../kit/Badge';
import { Button } from '../kit/Button';
import type { UiServices } from '../services';
import { useTranslator } from '../shared/i18n';
import { describeStatus, toneOf } from './task-state';
import type { TaskActions } from './use-tasks';

const QuestionForm = ({
  task,
  question,
  actions,
}: {
  task: TaskView;
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
          maxLength={MAX_COMMENT_LENGTH}
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

/**
 * Where a sent task is and what can be done about it now: its state, the agent's question with
 * the answer form, and the actions. The same on a task's card and on its sheet.
 */
export const TaskProgress = ({
  task,
  actions,
  services,
}: {
  task: TaskView;
  actions: TaskActions;
  services: UiServices;
}) => {
  const t = useTranslator();
  const { status } = task;
  const remote = status.kind === 'with-agent' ? status.remote : null;
  const can = (action: TaskView['actions'][number]) => task.actions.includes(action);

  return (
    <>
      <Badge tone={toneOf(status)} data-testid="task-state">
        {describeStatus(t, status)}
      </Badge>
      {can('answer') && remote?.phase === 'needs-input' && (
        <QuestionForm
          key={remote.question.id}
          task={task}
          question={remote.question}
          actions={actions}
        />
      )}
      {(can('open-result') || can('send-now') || can('send-again') || can('reopen')) && (
        <div class="task-actions">
          {can('open-result') && remote?.phase === 'result-ready' && (
            <Button
              variant="primary"
              size="sm"
              icon={<ExternalLink size={14} aria-hidden="true" />}
              onClick={() => void services.navigation.openUrl(remote.resultUrl)}
            >
              {t.text('openResult')}
            </Button>
          )}
          {can('send-now') && (
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
          {can('send-again') && (
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
          )}
          {can('reopen') && (
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
          )}
        </div>
      )}
    </>
  );
};
