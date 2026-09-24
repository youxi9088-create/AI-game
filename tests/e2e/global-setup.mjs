import { unlink } from 'node:fs/promises';
import { join } from 'node:path';

/* 生产默认画廊必须跨重启保留；E2E 每次运行则从空收藏开始，避免上一轮胜方改变本轮登台牌友。 */
export default async function globalSetup() {
  await unlink(join(process.cwd(), 'test-results', 'e2e-gallery.json')).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}
