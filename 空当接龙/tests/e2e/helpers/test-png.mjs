// e2e 测试用的合成牌面资产图：8×8 白底、中心 2×2 黑块（墨迹占比 25%，符合“干净剪影”特征）。
// 用程序化 PNG 生成替代旧的 1×1 像素 mock——1×1 会被花色重染的“脏图拒绝”逻辑判定为非剪影图。
import { deflateSync, crc32 } from 'node:zlib';

function chunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

export function makeCardAssetPng() {
  const size = 8;
  const raw = [];
  for (let y = 0; y < size; y++) {
    const row = [0];
    for (let x = 0; x < size; x++) {
      const ink = x >= 3 && x < 5 && y >= 3 && y < 5;
      row.push(ink ? 0 : 255, ink ? 0 : 255, ink ? 0 : 255);
    }
    raw.push(...row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return 'data:image/png;base64,' + Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.from(raw))),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}
