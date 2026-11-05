import type { DraftView, BundlePreview as Preview } from '@redline/rpc';
import { useEffect, useState } from 'preact/hooks';
import type { UiServices } from '../services';
import { PANEL_TEXT, formatBytes } from './copy';
import { LocalImage } from './LocalImage';

type PreviewState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'assembling' }
  | { readonly kind: 'ready'; readonly preview: Preview; readonly context: string }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * Shows the frozen bundle of the draft: `context.md` and every file, read from the bundle
 * the service worker stored. The same bundle is what gets delivered.
 */
export const BundlePreview = ({ services, draft }: { services: UiServices; draft: DraftView }) => {
  const [state, setState] = useState<PreviewState>({ kind: 'idle' });
  const stale = state.kind === 'ready' && state.preview.revision !== draft.revision;

  // A preview belongs to one draft; switching drafts starts over.
  useEffect(() => {
    setState({ kind: 'idle' });
  }, [draft.id]);

  const assemble = async () => {
    setState({ kind: 'assembling' });
    const preview = await services.rpc.call('task.assemble', { taskId: draft.id });
    if (!preview.ok) {
      setState({ kind: 'failed', message: preview.error.message });
      return;
    }
    const { taskId, digest, entry } = preview.value;
    const context = await services.files.bundleFile(taskId, digest, entry);
    setState(
      context.ok
        ? { kind: 'ready', preview: preview.value, context: await context.value.text() }
        : { kind: 'failed', message: context.error.message },
    );
  };

  return (
    <section class="card preview" aria-live="polite">
      <div class="row">
        <h2 class="grow">{PANEL_TEXT.previewTitle}</h2>
        <button
          type="button"
          data-testid="assemble"
          disabled={draft.steps.length === 0 || state.kind === 'assembling'}
          onClick={() => void assemble()}
        >
          {state.kind === 'assembling' ? PANEL_TEXT.previewing : PANEL_TEXT.preview}
        </button>
      </div>

      {state.kind === 'failed' && (
        <p role="alert" class="error">
          {state.message}
        </p>
      )}
      {stale && <p class="muted">{PANEL_TEXT.previewStale}</p>}
      {state.kind === 'ready' && !stale && (
        <>
          <p class="muted" data-testid="bundle-digest" data-digest={state.preview.digest}>
            sha256 {state.preview.digest.slice(0, 12)} ·{' '}
            {formatBytes(state.preview.files.reduce((sum, file) => sum + file.bytes, 0))}
          </p>
          <pre class="context" data-testid="bundle-context">
            {state.context}
          </pre>
          <h3>{PANEL_TEXT.files}</h3>
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
                  <span class="file-thumb placeholder" aria-hidden="true" />
                )}
                <code>{file.path}</code> <span class="muted">{formatBytes(file.bytes)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
};
