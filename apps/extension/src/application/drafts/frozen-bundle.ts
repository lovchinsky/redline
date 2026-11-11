import type { Bundle } from '@redline/assembly';
import type { TaskId } from '@redline/core';
import type { FrozenBundle } from '@redline/rpc';

/** What the UI reads of a task's frozen bundle: its files, by the digest they are read under. */
export const frozenBundleOf = (taskId: TaskId, bundle: Bundle): FrozenBundle => ({
  taskId,
  digest: bundle.digest,
  entry: bundle.manifest.entry,
  files: bundle.manifest.files.map(({ path, mediaType, bytes }) => ({ path, mediaType, bytes })),
});
