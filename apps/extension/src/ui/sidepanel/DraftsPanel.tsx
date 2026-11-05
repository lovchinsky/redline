import { useState } from 'preact/hooks';
import type { UiServices } from '../services';
import { ErrorAlert } from '../shared/ErrorAlert';
import { useTranslator } from '../shared/i18n';
import { PreviewSheet } from './BundlePreview';
import { DraftHeader } from './DraftHeader';
import { EmptyDraft, NextStepHint } from './EmptyDraft';
import { StepCard } from './StepCard';
import { ActionBar } from './SubmitPanel';
import { useDrafts } from './use-drafts';

export const DraftsPanel = ({ services }: { services: UiServices }) => {
  const t = useTranslator();
  const [state, actions] = useDrafts(services);
  const [previewing, setPreviewing] = useState(false);
  const { draft } = state;

  if (state.loading) return <p class="panel-loading faint">{t.text('loading')}</p>;
  const hasSteps = draft !== null && draft.steps.length > 0;

  return (
    <>
      <div class="panel-content">
        <ErrorAlert error={state.error} />
        <DraftHeader drafts={state.drafts} draft={draft} actions={actions} />
        {hasSteps ? (
          <>
            <ol class="steps" data-testid="steps" aria-label={t.text('stepsLabel')}>
              {draft.steps.map((step, position) => (
                <StepCard
                  key={step.id}
                  taskId={draft.id}
                  step={step}
                  position={position}
                  count={draft.steps.length}
                  actions={actions}
                  files={services.files}
                />
              ))}
            </ol>
            <NextStepHint services={services} />
          </>
        ) : (
          <EmptyDraft services={services} />
        )}
      </div>
      {hasSteps && (
        <ActionBar
          services={services}
          draft={draft}
          onPreview={() => {
            setPreviewing(true);
          }}
        />
      )}
      {previewing && draft !== null && (
        <PreviewSheet
          services={services}
          draft={draft}
          onClose={() => {
            setPreviewing(false);
          }}
        />
      )}
    </>
  );
};
