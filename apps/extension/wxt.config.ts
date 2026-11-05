import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

export const E2E_MODE = 'e2e';
export const E2E_ORIGIN = 'https://redline.test/*';

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  // Explicit imports only: dependencies stay visible to the boundary linter.
  imports: false,
  manifest: ({ mode }) => ({
    name: 'Redline',
    description: 'Обведи область на сайті, опиши правку — і відправ задачу агенту.',
    // activeTab + scripting: inject only into the tab the user invoked us on. No host access.
    permissions: ['sidePanel', 'activeTab', 'scripting', 'contextMenus'],
    // e2e builds stand in for a host permission the user grants when binding a site (phase 4):
    // browser automation cannot press extension shortcuts, which is what grants activeTab.
    ...(mode === E2E_MODE ? { host_permissions: [E2E_ORIGIN] } : {}),
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
