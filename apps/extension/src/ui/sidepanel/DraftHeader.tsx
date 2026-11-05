import { MAX_TITLE_LENGTH, TaskId } from '@redline/core';
import type { DraftSummary, DraftView } from '@redline/rpc';
import { ChevronsUpDown, Ellipsis, Plus, Trash } from 'lucide-preact';
import { useState } from 'preact/hooks';
import { IconButton } from '../kit/Button';
import { InlineConfirm } from '../kit/InlineConfirm';
import { Menu, type MenuEntry } from '../kit/Menu';
import { useTranslator } from '../shared/i18n';
import { titleOf } from './task-state';
import type { DraftActions } from './use-drafts';

interface DraftHeaderProps {
  readonly drafts: readonly DraftSummary[];
  readonly draft: DraftView | null;
  readonly actions: DraftActions;
}

const hostsOf = (draft: DraftView): string =>
  [...new Set(draft.steps.map((step) => new URL(step.page.url).host))].join(', ');

/** The task's title, switching between drafts, starting one, deleting this one. */
export const DraftHeader = ({ drafts, draft, actions }: DraftHeaderProps) => {
  const t = useTranslator();
  const [confirming, setConfirming] = useState(false);

  const switcher: MenuEntry[] = [
    ...drafts.map((summary): MenuEntry => ({
      key: summary.id,
      label: titleOf(t, summary),
      meta: t.count('stepCount', summary.stepCount),
      checked: summary.id === draft?.id,
      onSelect: () => {
        const id = TaskId.safeParse(summary.id);
        if (id.success) actions.activate(id.data);
      },
    })),
    ...(drafts.length > 0 ? (['separator'] as const) : []),
    {
      key: 'new',
      label: t.text('newDraft'),
      icon: <Plus size={14} aria-hidden="true" />,
      testId: 'new-draft',
      onSelect: actions.create,
    },
  ];

  return (
    <div class="draft-header">
      <div class="draft-title-row">
        {draft === null ? (
          <p class="draft-title placeholder">{t.text('newDraft')}</p>
        ) : (
          <input
            key={draft.id}
            class="draft-title"
            data-testid="draft-title"
            type="text"
            maxLength={MAX_TITLE_LENGTH}
            aria-label={t.text('taskTitleLabel')}
            defaultValue={draft.title ?? ''}
            placeholder={draft.steps[0]?.comment ?? t.text('untitledTask')}
            onChange={(event) => {
              actions.rename(draft.id, event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
            }}
          />
        )}
        <Menu
          label={t.text('draftsMenu')}
          align="end"
          items={switcher}
          trigger={(props) => (
            <IconButton label={t.text('draftsMenu')} data-testid="draft-select" {...props}>
              <ChevronsUpDown size={16} />
            </IconButton>
          )}
        />
        {draft !== null && (
          <Menu
            label={t.text('moreActions')}
            align="end"
            items={[
              {
                key: 'delete',
                label: t.text('deleteDraft'),
                icon: <Trash size={14} aria-hidden="true" />,
                danger: true,
                onSelect: () => {
                  setConfirming(true);
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
      {draft !== null && draft.steps.length > 0 && (
        <p class="draft-meta">
          {t.count('stepCount', draft.steps.length)} · {hostsOf(draft)}
        </p>
      )}
      {draft !== null && confirming && (
        <InlineConfirm
          question={t.text('confirmDeleteDraft')}
          confirmLabel={t.text('confirmDelete')}
          cancelLabel={t.text('cancel')}
          onCancel={() => {
            setConfirming(false);
          }}
          onConfirm={() => {
            setConfirming(false);
            actions.deleteDraft(draft.id);
          }}
        />
      )}
    </div>
  );
};
