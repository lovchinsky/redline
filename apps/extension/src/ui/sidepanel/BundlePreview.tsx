import type { AppError } from '@redline/core';
import type { DraftView, BundlePreview as Preview } from '@redline/rpc';
import { Download, LoaderCircle, RefreshCw } from 'lucide-preact';
import { useCallback, useEffect, useState } from 'preact/hooks';
import { Button, IconButton } from '../kit/Button';
import { Sheet } from '../kit/Sheet';
import type { UiServices } from '../services';
import { ErrorAlert } from '../shared/ErrorAlert';
import { useTranslator } from '../shared/i18n';
import { useLatestLoad } from '../shared/use-latest-load';
import { BundleContents, downloadBundle } from './BundleContents';

type PreviewState =
  | { readonly kind: 'assembling' }
  | { readonly kind: 'ready'; readonly preview: Preview }
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

  const begin = useLatestLoad();
  const assemble = useCallback(async () => {
    const isLatest = begin();
    setState({ kind: 'assembling' });
    const preview = await services.rpc.call('drafts.assemble', { taskId: draft.id });
    if (!isLatest()) return;
    setState(
      preview.ok
        ? { kind: 'ready', preview: preview.value }
        : { kind: 'failed', error: preview.error },
    );
  }, [services, draft.id, begin]);

  useEffect(() => {
    void assemble();
  }, [assemble]);

  const download = async (preview: Preview) => {
    const downloaded = await downloadBundle(services, preview);
    if (!downloaded.ok) setState({ kind: 'failed', error: downloaded.error });
  };

  return (
    <Sheet
      title={t.text('previewTitle')}
      closeLabel={t.text('close')}
      onClose={onClose}
      actions={
        state.kind === 'ready' && (
          <IconButton
            label={t.text('downloadZip')}
            data-testid="download-zip"
            onClick={() => void download(state.preview)}
          >
            <Download size={16} />
          </IconButton>
        )
      }
    >
      <div class="preview">
        {/* Only the short status lines are announced, never the bundle's text. */}
        {state.kind === 'assembling' && (
          <p class="note" role="status">
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
        {state.kind === 'ready' && <BundleContents services={services} bundle={state.preview} />}
      </div>
    </Sheet>
  );
};
