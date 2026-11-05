import type { UiServices } from '../services';
import { BundlePreview } from './BundlePreview';
import { ErrorAlert } from '../shared/ErrorAlert';
import { useTranslator } from '../shared/i18n';
import { DraftHeader } from './DraftHeader';
import { StepCard } from './StepCard';
import { SubmitPanel } from './SubmitPanel';
import { useDrafts } from './use-drafts';

export const DraftsPanel = ({ services }: { services: UiServices }) => {
  const t = useTranslator();
  const [state, actions] = useDrafts(services);
  const { draft } = state;

  if (state.loading) return <p class="muted">{t.text('loading')}</p>;

  return (
    <>
      <ErrorAlert error={state.error} />
      <DraftHeader drafts={state.drafts} draft={draft} actions={actions} />
      {draft === null || draft.steps.length === 0 ? (
        <section class="card empty" data-testid="empty-draft">
          {draft === null && <p>{t.text('noActiveDraft')}</p>}
          <p class="muted">{t.text('howToCapture')}</p>
        </section>
      ) : (
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
      )}
      {draft !== null && <BundlePreview services={services} draft={draft} />}
      {draft !== null && draft.steps.length > 0 && (
        <SubmitPanel services={services} draft={draft} />
      )}
    </>
  );
};
