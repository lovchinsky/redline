import { ok, type AppError, type Result } from '@redline/core';
import type { FrozenBundle } from '@redline/rpc';
import { FileText } from 'lucide-preact';
import { useEffect, useState } from 'preact/hooks';
import type { UiServices } from '../services';
import { downloadBlob } from '../shared/download';
import { ErrorAlert } from '../shared/ErrorAlert';
import { formatBytes } from '../shared/format';
import { useTranslator } from '../shared/i18n';
import { LocalImage } from './LocalImage';

/** Saves a frozen bundle as a .zip, for handing it to an agent by hand. */
export const downloadBundle = async (
  services: UiServices,
  bundle: FrozenBundle,
): Promise<Result<void, AppError>> => {
  const files = await services.files.bundle(bundle.taskId, bundle.digest);
  const archive = files.ok ? await services.archiver.archive(files.value) : files;
  if (!archive.ok) return archive;
  downloadBlob(archive.value, `redline-${bundle.taskId.slice(0, 8)}.zip`);
  return ok(undefined);
};

type EntryState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly text: string }
  | { readonly kind: 'failed'; readonly error: AppError };

/**
 * What a frozen bundle holds: its size and digest, `context.md` as the agent reads it, and
 * every file. Read from the bundle the service worker stored, byte for byte what is delivered.
 */
export const BundleContents = ({
  services,
  bundle,
}: {
  services: UiServices;
  bundle: FrozenBundle;
}) => {
  const t = useTranslator();
  const [entry, setEntry] = useState<EntryState>({ kind: 'loading' });
  const { taskId, digest, entry: entryPath } = bundle;

  useEffect(() => {
    let current = true;
    setEntry({ kind: 'loading' });
    void services.files.bundleFile(taskId, digest, entryPath).then(async (file) => {
      const next: EntryState = file.ok
        ? { kind: 'ready', text: await file.value.text() }
        : { kind: 'failed', error: file.error };
      if (current) setEntry(next);
    });
    return () => {
      current = false;
    };
  }, [services, taskId, digest, entryPath]);

  return (
    <>
      <p class="preview-summary" role="status" data-testid="bundle-digest" data-digest={digest}>
        {t.text(
          'previewSummary',
          t.count('fileCount', bundle.files.length),
          formatBytes(
            t,
            bundle.files.reduce((sum, file) => sum + file.bytes, 0),
          ),
          digest.slice(0, 12),
        )}
      </p>
      {entry.kind === 'failed' && <ErrorAlert error={entry.error} />}
      {entry.kind === 'ready' && (
        <section class="preview-section">
          <h3 class="section-label">{entryPath}</h3>
          {/* Scrolls on its own, so it takes focus to be scrollable from the keyboard. */}
          <pre class="context" data-testid="bundle-context" tabIndex={0} aria-label={entryPath}>
            {entry.text}
          </pre>
        </section>
      )}
      <section class="preview-section">
        <h3 class="section-label">{t.text('files')}</h3>
        <ul class="files">
          {bundle.files.map((file) => (
            <li key={file.path}>
              {file.mediaType.startsWith('image/') ? (
                <LocalImage
                  class="file-thumb"
                  files={services.files}
                  source={{ kind: 'bundle', taskId, digest, path: file.path }}
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
  );
};
