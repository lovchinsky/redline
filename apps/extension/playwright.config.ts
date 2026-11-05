import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  // One persistent browser profile per test; extensions cannot share it across workers.
  workers: 1,
  forbidOnly: Boolean(process.env['CI']),
  retries: 0,
  reporter: process.env['CI'] ? [['github'], ['list']] : 'list',
  use: { trace: 'retain-on-failure' },
});
