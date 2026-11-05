import { TaskId } from '@redline/core';
import type { DraftSummary, DraftView } from '@redline/rpc';
import { useState } from 'preact/hooks';
import { PANEL_TEXT } from './copy';
import type { DraftActions } from './use-drafts';

const labelOf = (draft: DraftSummary): string =>
  `${draft.title ?? draft.firstComment ?? PANEL_TEXT.emptyDraft} · ${PANEL_TEXT.stepCount(draft.stepCount)}`;

interface DraftHeaderProps {
  readonly drafts: readonly DraftSummary[];
  readonly draft: DraftView | null;
  readonly actions: DraftActions;
}

/** Which draft new steps go to, its title, and creating or deleting drafts. */
export const DraftHeader = ({ drafts, draft, actions }: DraftHeaderProps) => {
  const [confirming, setConfirming] = useState(false);

  return (
    <section class="card draft-header">
      <div class="row">
        <label class="grow">
          <span class="label">{PANEL_TEXT.draftsLabel}</span>
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
                {labelOf(summary)}
              </option>
            ))}
          </select>
        </label>
        <button type="button" data-testid="new-draft" onClick={actions.create}>
          {PANEL_TEXT.newDraft}
        </button>
      </div>

      {draft !== null && (
        <div class="row">
          <label class="grow">
            <span class="label">{PANEL_TEXT.titleLabel}</span>
            <input
              key={draft.id}
              data-testid="draft-title"
              type="text"
              defaultValue={draft.title ?? ''}
              placeholder={PANEL_TEXT.titlePlaceholder}
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
                {PANEL_TEXT.confirmDelete}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                }}
              >
                {PANEL_TEXT.cancel}
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label={PANEL_TEXT.deleteDraft}
              title={PANEL_TEXT.deleteDraft}
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
