import type { ErasedFragmentDescriptor } from '@redline/core';
import { computedStylesFragment } from './computed-styles/descriptor';
import { cssRulesFragment } from './css-rules/descriptor';
import { anchorsFragment } from './anchors/descriptor';
import { domSnapshotFragment } from './dom-snapshot/descriptor';
import { layoutFragment } from './layout/descriptor';
import { pageMetaFragment } from './page-meta/descriptor';
import { regionFragment } from './region/descriptor';
import { screenshotFragment } from './screenshot/descriptor';
import { frameworkFragment } from './framework/descriptor';
import { networkFailuresFragment } from './network-failures/descriptor';
import { runtimeErrorsFragment } from './runtime-errors/descriptor';

/** Every fragment kind: schemas, versions and presenters. Safe to load in any context. */
export const fragmentDescriptors: readonly ErasedFragmentDescriptor[] = [
  pageMetaFragment,
  regionFragment,
  screenshotFragment,
  anchorsFragment,
  frameworkFragment,
  layoutFragment,
  computedStylesFragment,
  cssRulesFragment,
  domSnapshotFragment,
  runtimeErrorsFragment,
  networkFailuresFragment,
];
