import type { UiServices } from '../services';
import { BundlePreview } from './BundlePreview';
import { PANEL_TEXT } from './copy';
import { DraftHeader } from './DraftHeader';
import { StepCard } from './StepCard';
import { useDrafts } from './use-drafts';

export const DraftsPanel = ({ services }: { services: UiServices }) => {
  const [state, actions] = useDrafts(services);
  const { draft } = state;

  if (state.loading) return <p class="muted">{PANEL_TEXT.loading}</p>;

  return (
    <>
      {state.error !== null && (
        <p role="alert" class="error">
          {state.error}
        </p>
      )}
      <DraftHeader drafts={state.drafts} draft={draft} actions={actions} />
      {draft === null || draft.steps.length === 0 ? (
        <section class="card empty" data-testid="empty-draft">
          {draft === null && <p>{PANEL_TEXT.noActiveDraft}</p>}
          <p class="muted">{PANEL_TEXT.howToCapture}</p>
        </section>
      ) : (
        <ol class="steps" data-testid="steps">
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
    </>
  );
};
