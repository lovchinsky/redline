import preact from '@preact/preset-vite';
import { defineConfig } from 'wxt';

export const E2E_MODE = 'e2e';
/**
 * Stands in for the user's gesture (activeTab), which browser automation cannot produce.
 * `tabs.captureVisibleTab` accepts only activeTab or <all_urls>, so a single origin is not enough.
 */
export const E2E_HOST_PERMISSIONS = ['<all_urls>'];

/** Sites a user may bind, and the receiver; requested per origin, never at install. */
export const OPTIONAL_HOST_PERMISSIONS = [
  'https://*/*',
  'http://localhost/*',
  'http://127.0.0.1/*',
];

export default defineConfig({
  srcDir: 'src',
  manifestVersion: 3,
  // Explicit imports only: dependencies stay visible to the boundary linter.
  imports: false,
  manifest: ({ mode }) => ({
    // Texts come from public/_locales; English is the fallback for every other language.
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'en',
    // activeTab + scripting: inject only into the tab the user invoked us on. No host access.
    permissions: [
      'sidePanel',
      'activeTab',
      'scripting',
      'contextMenus',
      'alarms',
      'storage',
      'notifications',
    ],
    // Asked for at runtime, one origin at a time: a bound site, the receiver.
    optional_host_permissions: OPTIONAL_HOST_PERMISSIONS,
    // e2e builds only: see E2E_HOST_PERMISSIONS.
    ...(mode === E2E_MODE ? { host_permissions: E2E_HOST_PERMISSIONS } : {}),
    action: { default_title: '__MSG_extName__' },
    // The composer frame: pages embed it, so what the user types never enters the page.
    // A dynamic URL keeps pages from detecting the extension by probing for it.
    web_accessible_resources: [
      { resources: ['composer.html'], matches: ['<all_urls>'], use_dynamic_url: true },
    ],
    commands: {
      'start-capture': {
        suggested_key: { default: 'Alt+Shift+A' },
        description: '__MSG_commandStartCapture__',
      },
    },
  }),
  vite: () => ({
    plugins: [preact()],
  }),
});
