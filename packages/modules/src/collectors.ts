import type { ErasedCollector } from '@redline/capture';
import { anchorsCollector } from './anchors/collector';
import { domSnapshotCollector } from './dom-snapshot/collector';
import { layoutCollector } from './layout/collector';
import { pageMetaCollector } from './page-meta/collector';
import { regionCollector } from './region/collector';
import { screenshotCollector } from './screenshot/collector';

/** Every collector. Reads the live page: load only in the content script. */
export const collectors: readonly ErasedCollector[] = [
  pageMetaCollector,
  regionCollector,
  screenshotCollector,
  anchorsCollector,
  layoutCollector,
  domSnapshotCollector,
];
