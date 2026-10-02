import { defineConfig } from '@playwright/test';
import { join } from 'node:path';

// Each spec boots its own API process. Game state is per-process, while the player's gallery
// is persisted in apps/api/data/gallery.json so a normal server restart does not erase unlocks.
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.mjs',
  timeout: 30_000,
  retries: 0,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:4176',
    browserName: 'chromium',
    launchOptions: process.env.PLAYWRIGHT_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {},
    channel: process.env.PLAYWRIGHT_CHANNEL === 'bundled' ? undefined : 'chrome',
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure'
    /* 这里刻意**不**加 --autoplay-policy=no-user-gesture-required：实测在本环境的
       headless Chrome 上它并不生效（连 preload="auto" 的对照元素都停在 readyState 1），
       留一个不起作用的开关只会让人误以为自动播放已被覆盖。
       所以凡是要验「视频真的在放」的用例，都显式 play() 后再断言解码，并在注释里写明。 */
  },
  webServer: {
    command: 'node apps/api/server.mjs',
    url: 'http://127.0.0.1:4176/health',
    env: {
      PORT: '4176',
      GALLERY_STATE_PATH: join(process.cwd(), 'test-results', 'e2e-gallery.json'),
      TOKEN_STATE_PATH: join(process.cwd(), 'test-results', 'e2e-wallet.json'),
      CONFIRMED_PALS_PATH: join(process.cwd(), 'test-results', 'e2e-confirmed-pals.json'),
      PAL_RESOURCE_STATE_PATH: join(process.cwd(), 'test-results', 'e2e-pal-resource-tasks.json')
    },
    reuseExistingServer: false,
    timeout: 30_000
  }
});
