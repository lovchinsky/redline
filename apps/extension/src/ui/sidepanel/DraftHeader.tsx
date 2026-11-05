import { TaskId } from '@redline/core';
import type { DraftSummary, DraftView } from '@redline/rpc';
import { useState } from 'preact/hooks';
import type { Translator } from '../../ports/i18n';
import { useTranslator } from '../shared/i18n';
import { titleOf } from './task-state';
import type { DraftActions } from './use-drafts';

const labelOf = (t: Translator, draft: DraftSummary): string =>
  t.text('draftOption', titleOf(t, draft), t.count('stepCount', draft.stepCount));

interface DraftHeaderProps {
  readonly drafts: readonly DraftSummary[];
  readonly draft: DraftView | null;
  readonly actions: DraftActions;
}

/** Which draft new steps go to, its title, and creating or deleting drafts. */
export const DraftHeader = ({ drafts, draft, actions }: DraftHeaderProps) => {
  const t = useTranslator();
  const [confirming, setConfirming] = useState(false);

  return (
    <section class="card draft-header">
      <div class="row">
        <label class="grow">
          <span class="label">{t.text('draftLabel')}</span>
          <select
            data-testid="draft-select"
            value={draft?.id ?? ''}
            onChange={(event) => {
              const id = TaskId.safeParse(event.currentTarget.value);
              if (id.success) actions.activate(id.data);
            }}
          >
            {draft === null && <option value="">—</option>}
            {drafts.map((summary) => (
              <option key={summary.id} value={summary.id}>
                {labelOf(t, summary)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" data-testid="new-draft" onClick={actions.create}>
          {t.text('newDraft')}
        </button>
      </div>

      {draft !== null && (
        <div class="row">
          <label class="grow">
            <span class="label">{t.text('titleLabel')}</span>
            <input
              key={draft.id}
              data-testid="draft-title"
              type="text"
              defaultValue={draft.title ?? ''}
              placeholder={t.text('titlePlaceholder')}
              onChange={(event) => {
                actions.rename(draft.id, event.currentTarget.value);
              }}
            />
          </label>
          {confirming ? (
            <>
              <button
                type="button"
                class="danger"
                onClick={() => {
                  setConfirming(false);
                  actions.deleteDraft(draft.id);
                }}
              >
                {t.text('confirmDelete')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {t.text('cancel')}
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label={t.text('deleteDraft')}
              title={t.text('deleteDraft')}
              onClick={() => {
                setConfirming(true);
              }}
            >
              🗑
            </button>
          )}
        </div>
      )}
    </section>
  );
};
