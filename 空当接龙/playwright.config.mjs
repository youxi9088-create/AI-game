import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://127.0.0.1:4273',
    browserName: 'chromium',
    channel: 'chrome',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
  },
  webServer: [
    { command: 'node scripts/serve-test.mjs', url: 'http://127.0.0.1:4273', reuseExistingServer: !process.env.CI },
    { command: 'node scripts/api-test-server.mjs', url: 'http://127.0.0.1:4274/health', reuseExistingServer: !process.env.CI },
  ],
});
