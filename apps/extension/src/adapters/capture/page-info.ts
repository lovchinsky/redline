import type { PageInfo } from '@redline/capture';

/** Page facts read from the live window. */
export const pageInfoOf = (view: Window): PageInfo => ({
  url: view.location.href,
  title: view.document.title,
  viewport: { width: view.innerWidth, height: view.innerHeight },
  devicePixelRatio: view.devicePixelRatio,
  scroll: { x: view.scrollX, y: view.scrollY },
  language: view.document.documentElement.lang === '' ? null : view.document.documentElement.lang,
  colorScheme: view.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
});
