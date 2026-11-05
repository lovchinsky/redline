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

test('manifest requests only the permissions that are in use', async ({ serviceWorker }) => {
  const manifest = await serviceWorker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions).toEqual(['sidePanel']);
  expect(manifest.host_permissions ?? []).toEqual([]);
  expect(manifest.content_scripts ?? []).toEqual([]);
});
