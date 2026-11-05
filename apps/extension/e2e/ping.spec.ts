import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser } from 'wxt/browser';
import { expect, launchExtension, openOptions, openSidePanel, test } from './fixtures';

test('Diagnostics reach the service worker over typed RPC and receive its events', async ({
  context,
}) => {
  const page = await openOptions(context);

  const status = page.getByTestId('sw-status');
  await expect(status).toHaveAttribute('data-status', 'connected');
  await expect(status).toContainText('v0.1.0');
  await expect(page.getByTestId('ping-events')).toHaveText('1');

  await page.getByTestId('ping').click();
  await expect(status).toHaveAttribute('data-status', 'connected');
  await expect(page.getByTestId('ping-events')).toHaveText('2');
});

test('the production manifest requests no host access and declares no content scripts', async () => {
  const manifestPath = path.resolve(import.meta.dirname, '../.output/chrome-mv3/manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Browser.runtime.ManifestV3;

  expect(manifest.permissions).toEqual([
    'sidePanel',
    'activeTab',
    'scripting',
    'contextMenus',
    'alarms',
    'storage',
    'notifications',
  ]);
  expect(manifest.host_permissions).toBeUndefined();
  expect(manifest.optional_host_permissions).toEqual([
    'https://*/*',
    'http://localhost/*',
    'http://127.0.0.1/*',
  ]);
  expect(manifest.content_scripts).toBeUndefined();
  expect(manifest.commands?.['start-capture']?.suggested_key).toEqual({ default: 'Alt+Shift+A' });
  expect(manifest.default_locale).toBe('en');
  expect(manifest.name).toBe('__MSG_extName__');
});

test('speaks the browser language, English for any language without a catalog', async () => {
  for (const [locale, draft, settings] of [
    ['uk', 'Чернетка', 'Налаштування Redline'],
    ['en-US', 'Draft', 'Redline settings'],
    ['de', 'Draft', 'Redline settings'],
  ] as const) {
    const context = await launchExtension('', locale);
    try {
      const panel = await openSidePanel(context);
      await expect(panel.getByTestId('tab-draft')).toHaveText(draft);
      await expect(panel.locator('html')).toHaveAttribute('lang', locale === 'uk' ? 'uk' : 'en');
      const options = await openOptions(context);
      await expect(options).toHaveTitle(settings);
    } finally {
      await context.close();
    }
  }
});
