import type { AssetId, TaskId } from '@redline/core';
import { useEffect, useState } from 'preact/hooks';
import type { LocalFiles } from '../../ports/drafts';

export type ImageSource =
  | { readonly kind: 'asset'; readonly id: AssetId }
  | {
      readonly kind: 'bundle';
      readonly taskId: TaskId;
      readonly digest: string;
      readonly path: string;
    };

const keyOf = (source: ImageSource): string =>
  source.kind === 'asset'
    ? `asset:${source.id}`
    : `bundle:${source.taskId}:${source.digest}:${source.path}`;

const read = (files: LocalFiles, source: ImageSource) =>
  source.kind === 'asset'
    ? files.asset(source.id)
    : files.bundleFile(source.taskId, source.digest, source.path);

interface LocalImageProps {
  readonly files: LocalFiles;
  readonly source: ImageSource;
  readonly alt: string;
  readonly class?: string;
}

/** Shows a locally stored image through an object URL that is revoked when no longer shown. */
export const LocalImage = ({ files, source, alt, class: className }: LocalImageProps) => {
  const [url, setUrl] = useState<string | null>(null);
  const key = keyOf(source);

  useEffect(() => {
    let disposed = false;
    let objectUrl: string | null = null;
    void read(files, source).then((blob) => {
      if (disposed || !blob.ok) return;
      objectUrl = URL.createObjectURL(blob.value);
      setUrl(objectUrl);
    });
    return () => {
      disposed = true;
      if (objectUrl !== null) URL.revokeObjectURL(objectUrl);
      setUrl(null);
    };
    // The source is identified by its key; a new object with the same key is the same image.
  }, [files, key]);

  return url === null ? (
    <div class={`${className ?? ''} placeholder`} aria-hidden="true" />
  ) : (
    <img class={className} src={url} alt={alt} />
  );
};
