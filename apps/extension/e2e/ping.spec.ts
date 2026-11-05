import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Browser } from 'wxt/browser';
import { expect, test } from './fixtures';

test('side panel reaches the service worker over typed RPC and receives its events', async ({
  context,
  extensionId,
}) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);

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
});
