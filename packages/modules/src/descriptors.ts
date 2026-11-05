import type { ErasedFragmentDescriptor } from '@redline/core';
import { anchorsFragment } from './anchors/descriptor';
import { domSnapshotFragment } from './dom-snapshot/descriptor';
import { layoutFragment } from './layout/descriptor';
import { pageMetaFragment } from './page-meta/descriptor';
import { regionFragment } from './region/descriptor';
import { screenshotFragment } from './screenshot/descriptor';

/** Every fragment kind: schemas, versions and presenters. Safe to load in any context. */
export const fragmentDescriptors: readonly ErasedFragmentDescriptor[] = [
  pageMetaFragment,
  regionFragment,
  screenshotFragment,
  anchorsFragment,
  layoutFragment,
  domSnapshotFragment,
];
