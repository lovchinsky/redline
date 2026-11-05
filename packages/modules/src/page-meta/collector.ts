import { defineCollector } from '@redline/capture';
import { routePatternOf } from '@redline/core';
import * as z from 'zod/mini';
import type { PageMetaData } from './types';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '0.0.0.0']);

const environmentOf = (document: Document, url: URL): PageMetaData['environment'] => {
  const devServer = document.querySelector(
    'script[src*="/@vite/client"], script[src*="webpack-dev-server"], style[data-vite-dev-id]',
  );
  if (devServer !== null) return 'dev-server';
  const local =
    LOCAL_HOSTS.has(url.hostname) ||
    url.hostname.endsWith('.localhost') ||
    url.hostname.endsWith('.local');
  return local ? 'local' : 'deployed';
};

/** Where the step happened: route, viewport and how the page is served. */
export const pageMetaCollector = defineCollector({
  id: 'page-meta',
  produces: 'page-meta',
  level: 'step',
  priority: 'critical',
  optionsSchema: z.undefined(),
  collect: ({ context: { page, document } }) => {
    const url = new URL(page.url);
    return Promise.resolve({
      status: 'collected',
      items: [
        {
          data: {
            url: page.url,
            routePattern: routePatternOf(url),
            title: page.title,
            viewport: page.viewport,
            devicePixelRatio: page.devicePixelRatio,
            colorScheme: page.colorScheme,
            language: page.language,
            environment: environmentOf(document, url),
          },
        },
      ],
    });
  },
});
