import type { AppError } from '@redline/core';
import type { SentTask, TaskView } from '@redline/rpc';
import { ChevronRight, Download, LoaderCircle } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import { Button } from '../kit/Button';
import { Sheet } from '../kit/Sheet';
import type { UiServices } from '../services';
import { ErrorAlert } from '../shared/ErrorAlert';
import { useTranslator } from '../shared/i18n';
import { BundleContents, downloadBundle } from './BundleContents';
import { StepItem } from './StepItem';
import { metaOf, titleOf } from './task-state';
import { TaskProgress } from './TaskProgress';
import type { TaskActions } from './use-tasks';

type ContentState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly content: SentTask }
  | { readonly kind: 'failed'; readonly error: AppError };

interface TaskSheetProps {
  readonly services: UiServices;
  /** The task as last listed: where it is now, kept current while the sheet is open. */
  readonly task: TaskView;
  readonly actions: TaskActions;
  readonly onClose: () => void;
}

/**
 * Everything a sent task asked for: each step in full with its picture, and the bundle the
 * agent got; above them, where the task is and what can be done now. What was sent is frozen,
 * so it is read once; where the task is follows the list.
 */
export const TaskSheet = ({ services, task, actions, onClose }: TaskSheetProps) => {
  const t = useTranslator();
  const [state, setState] = useState<ContentState>({ kind: 'loading' });
  const [bundleOpen, setBundleOpen] = useState(false);
  const [downloadError, setDownloadError] = useState<AppError | null>(null);
  const { id } = task;

  useEffect(() => {
    let current = true;
    setState({ kind: 'loading' });
    void services.rpc.call('tasks.get', { taskId: id }).then((content) => {
      if (!current) return;
      setState(
        content.ok
          ? { kind: 'ready', content: content.value }
          : { kind: 'failed', error: content.error },
      );
    });
    return () => {
      current = false;
    };
  }, [services, id]);

  const bundle = state.kind === 'ready' ? state.content.bundle : null;

  return (
    <Sheet
      title={titleOf(t, task)}
      closeLabel={t.text('close')}
      onClose={onClose}
      actions={
        bundle !== null && (
          <Button
            size="sm"
            data-testid="download-zip"
            icon={<Download size={14} aria-hidden="true" />}
            onClick={() =>
              void downloadBundle(services, bundle).then((downloaded) => {
                setDownloadError(downloaded.ok ? null : downloaded.error);
              })
            }
          >
            {t.text('downloadZip')}
          </Button>
        )
      }
    >
      <div class="task-sheet" data-testid="task-sheet">
        <div class="task-sheet-status">
          <p class="task-meta">{metaOf(t, task)}</p>
          <TaskProgress task={task} actions={actions} services={services} />
        </div>
        <ErrorAlert error={downloadError} />
        {state.kind === 'loading' && (
          <p class="note" role="status">
            <LoaderCircle size={14} class="spin" aria-hidden="true" />
            <span>{t.text('loading')}</span>
          </p>
        )}
        {state.kind === 'failed' && <ErrorAlert error={state.error} />}
        {state.kind === 'ready' && (
          <>
            <section class="preview-section">
              <h3 class="section-label">{t.text('stepsLabel')}</h3>
              <ol class="steps" aria-label={t.text('stepsLabel')}>
                {state.content.steps.map((step, position) => (
                  <StepItem
                    key={step.id}
                    position={position}
                    page={step.page}
                    comment={step.comment}
                    image={
                      bundle === null || step.image === null
                        ? null
                        : { kind: 'bundle', taskId: id, digest: bundle.digest, path: step.image }
                    }
                    files={services.files}
                  />
                ))}
              </ol>
            </section>
            {bundle === null ? (
              <p class="note">{t.text('taskBundleMissing')}</p>
            ) : (
              <details
                class="task-bundle"
                data-testid="task-bundle"
                onToggle={(event) => {
                  setBundleOpen(event.currentTarget.open);
                }}
              >
                <summary>
                  <ChevronRight size={14} class="disclosure" aria-hidden="true" />
                  <span>{t.text('taskBundle', t.count('fileCount', bundle.files.length))}</span>
                </summary>
                {/* Read only once opened: most of the time the steps say enough. */}
                {bundleOpen && (
                  <div class="preview">
                    <BundleContents services={services} bundle={bundle} />
                  </div>
                )}
              </details>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
};
