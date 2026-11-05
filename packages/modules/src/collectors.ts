import type { ErasedCollector } from '@redline/capture';
import { computedStylesCollector } from './computed-styles/collector';
import { cssRulesCollector } from './css-rules/collector';
import { anchorsCollector } from './anchors/collector';
import { domSnapshotCollector } from './dom-snapshot/collector';
import { layoutCollector } from './layout/collector';
import { pageMetaCollector } from './page-meta/collector';
import { regionCollector } from './region/collector';
import { screenshotCollector } from './screenshot/collector';
import { frameworkCollector } from './framework/collector';
import { networkFailuresCollector } from './network-failures/collector';
import { runtimeErrorsCollector } from './runtime-errors/collector';

/** Every collector. Reads the live page: load only in the content script. */
export const collectors: readonly ErasedCollector[] = [
  pageMetaCollector,
  regionCollector,
  screenshotCollector,
  anchorsCollector,
  frameworkCollector,
  layoutCollector,
  computedStylesCollector,
  cssRulesCollector,
  domSnapshotCollector,
  runtimeErrorsCollector,
  networkFailuresCollector,
];
