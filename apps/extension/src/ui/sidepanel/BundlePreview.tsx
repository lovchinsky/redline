import type { AppError } from '@redline/core';
import type { DraftView, BundlePreview as Preview } from '@redline/rpc';
import { Download, FileText, LoaderCircle, RefreshCw } from 'lucide-preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { Button } from '../kit/Button';
import { Sheet } from '../kit/Sheet';
import type { UiServices } from '../services';
import { downloadBlob } from '../shared/download';
import { ErrorAlert } from '../shared/ErrorAlert';
import { formatBytes } from '../shared/format';
import { useTranslator } from '../shared/i18n';
import { LocalImage } from './LocalImage';

type PreviewState =
  | { readonly kind: 'assembling' }
  | { readonly kind: 'ready'; readonly preview: Preview; readonly context: string }
  | { readonly kind: 'failed'; readonly error: AppError };

interface PreviewSheetProps {
  readonly services: UiServices;
  readonly draft: DraftView;
  readonly onClose: () => void;
}

/**
 * The frozen bundle of the draft: `context.md` and every file, read from the bundle the service
 * worker stored. The same bundle is what gets delivered.
 */
export const PreviewSheet = ({ services, draft, onClose }: PreviewSheetProps) => {
  const t = useTranslator();
  const [state, setState] = useState<PreviewState>({ kind: 'assembling' });
  const stale = state.kind === 'ready' && state.preview.revision !== draft.revision;

  const assemble = useCallback(async () => {
    setState({ kind: 'assembling' });
    const preview = await services.rpc.call('task.assemble', { taskId: draft.id });
    if (!preview.ok) {
      setState({ kind: 'failed', error: preview.error });
      return;
    }
    const { taskId, digest, entry } = preview.value;
    const context = await services.files.bundleFile(taskId, digest, entry);
    setState(
      context.ok
        ? { kind: 'ready', preview: preview.value, context: await context.value.text() }
        : { kind: 'failed', error: context.error },
    );
  }, [services, draft.id]);

  useEffect(() => {
    void assemble();
  }, [assemble]);

  /** Saves the frozen bundle as a .zip, for handing it to an agent by hand. */
  const download = async (preview: Preview) => {
    const bundle = await services.files.bundle(preview.taskId, preview.digest);
    const archive = bundle.ok ? await services.archiver.archive(bundle.value) : bundle;
    if (!archive.ok) {
      setState({ kind: 'failed', error: archive.error });
      return;
    }
    downloadBlob(archive.value, `redline-${preview.taskId.slice(0, 8)}.zip`);
  };

  return (
    <Sheet
      title={t.text('previewTitle')}
      closeLabel={t.text('close')}
      onClose={onClose}
      actions={
        state.kind === 'ready' && (
          <Button
            size="sm"
            data-testid="download-zip"
            icon={<Download size={14} aria-hidden="true" />}
            onClick={() => void download(state.preview)}
          >
            {t.text('downloadZip')}
          </Button>
        )
      }
    >
      <div class="preview" aria-live="polite">
        {state.kind === 'assembling' && (
          <p class="note">
            <LoaderCircle size={14} class="spin" aria-hidden="true" />
            <span>{t.text('previewing')}</span>
          </p>
        )}
        {state.kind === 'failed' && <ErrorAlert error={state.error} />}
        {stale && (
          <div class="note">
            <span class="grow">{t.text('previewStale')}</span>
            <Button
              size="sm"
              icon={<RefreshCw size={14} aria-hidden="true" />}
              onClick={() => void assemble()}
            >
              {t.text('previewRefresh')}
            </Button>
          </div>
        )}
        {state.kind === 'ready' && (
          <>
            <p
              class="preview-summary"
              data-testid="bundle-digest"
              data-digest={state.preview.digest}
            >
              {t.text(
                'previewSummary',
                t.count('fileCount', state.preview.files.length),
                formatBytes(
                  t,
                  state.preview.files.reduce((sum, file) => sum + file.bytes, 0),
                ),
                state.preview.digest.slice(0, 12),
              )}
            </p>
            <section class="preview-section">
              <h3 class="section-label">{state.preview.entry}</h3>
              {/* Scrolls on its own, so it takes focus to be scrollable from the keyboard. */}
              <pre
                class="context"
                data-testid="bundle-context"
                tabIndex={0}
                aria-label={state.preview.entry}
              >
                {state.context}
              </pre>
            </section>
            <section class="preview-section">
              <h3 class="section-label">{t.text('files')}</h3>
              <ul class="files">
                {state.preview.files.map((file) => (
                  <li key={file.path}>
                    {file.mediaType.startsWith('image/') ? (
                      <LocalImage
                        class="file-thumb"
                        files={services.files}
                        source={{
                          kind: 'bundle',
                          taskId: state.preview.taskId,
                          digest: state.preview.digest,
                          path: file.path,
                        }}
                        alt=""
                      />
                    ) : (
                      <span class="file-thumb file-icon" aria-hidden="true">
                        <FileText size={16} />
                      </span>
                    )}
                    <code class="file-path">{file.path}</code>
                    <span class="file-size">{formatBytes(t, file.bytes)}</span>
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </Sheet>
  );
};
