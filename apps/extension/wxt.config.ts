import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

export const E2E_MODE = 'e2e';
/**
 * Stands in for the user's gesture (activeTab), which browser automation cannot produce.
 * `tabs.captureVisibleTab` accepts only activeTab or <all_urls>, so a single origin is not enough.
 */
export const E2E_HOST_PERMISSIONS = ['<all_urls>'];

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  // Explicit imports only: dependencies stay visible to the boundary linter.
  imports: false,
  manifest: ({ mode }) => ({
    name: 'Redline',
    description: 'Обведи область на сайті, опиши правку — і відправ задачу агенту.',
    // activeTab + scripting: inject only into the tab the user invoked us on. No host access.
    permissions: ['sidePanel', 'activeTab', 'scripting', 'contextMenus', 'alarms'],
    // e2e builds only: see E2E_HOST_PERMISSIONS.
    ...(mode === E2E_MODE ? { host_permissions: E2E_HOST_PERMISSIONS } : {}),
    action: { default_title: 'Redline' },
    commands: {
      'start-capture': {
        suggested_key: { default: 'Alt+Shift+A' },
        description: 'Обвести область на сторінці',
      },
    },
  }),
  vite: () => ({
    plugins: [preact()],
  }),
});
