import type * as z from 'zod/mini';
import type { AssetRef } from '../ports/asset-store';
import type { Fragment, FragmentBase, FragmentKind, FragmentRegistry } from './fragment';

/** Where a block appears within its step or area; the renderer orders sections. */
export const SECTIONS = [
  'page',
  'region',
  'images',
  'anchors',
  'layout',
  'styles',
  'runtime',
  'details',
] as const;
export type Section = (typeof SECTIONS)[number];

export interface MarkdownBlock {
  readonly section: Section;
  readonly markdown: string;
}

/** A supporting file that is too detailed for `context.md`; linked from it. */
export interface DetailFile {
  /** Short name, unique within one area, e.g. `dom`. */
  readonly name: string;
  readonly extension: 'html' | 'json' | 'md' | 'txt';
  readonly mediaType: string;
  readonly content: string;
}

export interface RenderContext {
  /** Bundle path for an asset; `role` makes the file name readable (e.g. `crop`). */
  assetPath(asset: AssetRef, role: string): string;
  /**
   * Adds a detail file to the bundle and returns its path: the one way a presenter ships a
   * file, so every file it ships is one its Markdown links to.
   */
  detailPath(file: DetailFile): string;
}

/** Turns one fragment kind into Markdown for `context.md` and optional detail files. */
export interface FragmentPresenter<K extends FragmentKind> {
  summarize(fragment: Fragment<K>, context: RenderContext): readonly MarkdownBlock[];
  /** An image that stands for the fragment in lists, e.g. a step's thumbnail. */
  thumbnail?(fragment: Fragment<K>): AssetRef | null;
}

/** Upgrades stored data written with `fromVersion` to `fromVersion + 1`. */
export interface FragmentMigration {
  readonly fromVersion: number;
  migrate(data: unknown): unknown;
}

/**
 * Everything about a fragment kind that does not depend on where it is collected:
 * schema, version and presentation. Shared by the content script and the service worker.
 */
export interface FragmentDescriptor<K extends FragmentKind> {
  readonly kind: K;
  /** Human-readable name of the kind, used where the renderer refers to a fragment. */
  readonly title: string;
  readonly version: number;
  readonly schema: z.ZodMiniType<FragmentRegistry[K]>;
  readonly migrations: readonly FragmentMigration[];
  readonly presenter: FragmentPresenter<K>;
}

/**
 * Kind-agnostic view of a descriptor for machinery that handles every kind (catalog, renderer).
 * Every `FragmentDescriptor<K>` is assignable to it.
 */
export interface ErasedFragmentDescriptor {
  readonly kind: string;
  readonly title: string;
  readonly version: number;
  readonly schema: z.ZodMiniType;
  readonly migrations: readonly FragmentMigration[];
  readonly presenter: {
    summarize(fragment: FragmentBase, context: RenderContext): readonly MarkdownBlock[];
    thumbnail?(fragment: FragmentBase): AssetRef | null;
  };
}

export const defineFragment = <K extends FragmentKind>(
  descriptor: FragmentDescriptor<K>,
): FragmentDescriptor<K> => descriptor;
