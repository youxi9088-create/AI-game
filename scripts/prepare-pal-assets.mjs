/* 把「品红底全身立绘」加工成游戏要的两份素材。**不生成任何新画面**，只做抠像与缩放。

   为什么走色键而不是直接要透明 PNG：实测图像接口的 background:"transparent" 并不生效——
   回包是 colorType=2 的 RGB（无 alpha 通道），预览里那层棋盘格是**画进像素里**的。
   所以改成「纯品红底 + 本地抠像」，把透明这件事掌握在自己手里。

   色键判据用 key = min(R,B) − G：
     品红 R,B 都高、G 低 → key 很大；而银色头发/白上衣(≈灰) key≈0，
     皮肤 R>G>B → min(R,B)=B<G，key 为负；藏青与蓝色护腕 R 低，key 也为负。
     整条色域里只有一个方向是品红，不需要逐色枚举。
   抠完只保留**最大连通区域**：右下角那枚生成水印是独立的小岛，会随其它杂点一起被丢掉。

   产出：
     <standee>  透明底全身抠像，高度对齐既有立绘 1360
     <portrait> 3:4 头像/卡面底图，figure 居中铺在深色渐变上（与 linxing-v1.png 同为 1086×1448）
     <table-seat> 可选：牌桌 L2 半身裁切。全身图直接塞进等高座位盒，会比已有半身角色
                  小一档；这里从抠好的 standee 顶端取 4:5，保持脸/肩/手在同一份额。
   用法：node scripts/prepare-pal-assets.mjs <源图> <standee输出> <portrait输出> [table-seat输出]
*/
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';

const [srcPath, standeeOut, portraitOut, tableSeatOut] = process.argv.slice(2);
if (!srcPath || !standeeOut || !portraitOut) throw new Error('用法: <源图> <standee输出> <portrait输出> [table-seat输出]');

const STANDEE_H = 1360;   // 与 linxing-standee.png / mia-standee.png 一致
const PORTRAIT_W = 1086;  // 与 linxing-v1.png / mia-v1.png 一致（3:4）
const PORTRAIT_H = 1448;
const MARGIN = 8;         // 裁边后保留的透明边距，避免贴边元素被 CSS 阴影切到

const dataUrl = `data:image/png;base64,${(await readFile(srcPath)).toString('base64')}`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('about:blank');

const out = await page.evaluate(async ({ url, STANDEE_H, PORTRAIT_W, PORTRAIT_H, MARGIN }) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H);
  const px = data.data;

  /* 背景色从四个角各取一小块的中位数：单点采样会被压缩噪声或水印带偏。 */
  const sample = (x0, y0) => {
    const vals = [];
    for (let y = y0; y < y0 + 8; y += 1) for (let x = x0; x < x0 + 8; x += 1) vals.push([px[(y * W + x) * 4], px[(y * W + x) * 4 + 1], px[(y * W + x) * 4 + 2]]);
    vals.sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]));
    return vals[Math.floor(vals.length / 2)];
  };
  const corners = [sample(0, 0), sample(W - 8, 0), sample(0, H - 8), sample(W - 8, H - 8)];
  const bg = [0, 1, 2].map((i) => Math.round(corners.reduce((s, v) => s + v[i], 0) / corners.length));
  const bgKey = Math.min(bg[0], bg[2]) - bg[1];

  /* 软阈值：LO 以下判为前景，HI 以上判为背景，中间线性过渡，避免头发边缘出现硬锯齿。 */
  const LO = Math.max(24, bgKey * 0.25);
  const HI = Math.max(60, bgKey * 0.62);
  const alpha = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i += 1) {
    const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2];
    const key = Math.min(r, b) - g;
    alpha[i] = key <= LO ? 255 : key >= HI ? 0 : Math.round(255 * (1 - (key - LO) / (HI - LO)));
  }

  /* 最大连通区域：4 邻域 flood fill，取像素数最多的一个。 */
  const comp = new Int32Array(W * H).fill(-1);
  const sizes = [];
  const stack = [];
  for (let start = 0; start < W * H; start += 1) {
    if (comp[start] !== -1 || alpha[start] < 128) continue;
    const id = sizes.length;
    let size = 0;
    comp[start] = id; stack.push(start);
    while (stack.length) {
      const p = stack.pop(); size += 1;
      const x = p % W, y = (p - x) / W;
      if (x > 0 && comp[p - 1] === -1 && alpha[p - 1] >= 128) { comp[p - 1] = id; stack.push(p - 1); }
      if (x < W - 1 && comp[p + 1] === -1 && alpha[p + 1] >= 128) { comp[p + 1] = id; stack.push(p + 1); }
      if (y > 0 && comp[p - W] === -1 && alpha[p - W] >= 128) { comp[p - W] = id; stack.push(p - W); }
      if (y < H - 1 && comp[p + W] === -1 && alpha[p + W] >= 128) { comp[p + W] = id; stack.push(p + W); }
    }
    sizes.push(size);
  }
  if (!sizes.length) return { error: '抠像后没有留下任何前景：色键判据可能不适用于这张图' };
  let keep = 0;
  for (let i = 1; i < sizes.length; i += 1) if (sizes[i] > sizes[keep]) keep = i;
  let dropped = 0;
  for (let i = 0; i < W * H; i += 1) if (alpha[i] && comp[i] !== keep) { alpha[i] = 0; dropped += 1; }

  /* 裁到前景包围盒。 */
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (let y = 0; y < H; y += 1) for (let x = 0; x < W; x += 1) {
    if (alpha[y * W + x] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return { error: '包围盒为空' };
  x0 = Math.max(0, x0 - MARGIN); y0 = Math.max(0, y0 - MARGIN);
  x1 = Math.min(W - 1, x1 + MARGIN); y1 = Math.min(H - 1, y1 + MARGIN);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1;

  /* 把 alpha 写回一份只含前景的 RGBA 图，供后续两次绘制复用。 */
  const cut = document.createElement('canvas');
  cut.width = bw; cut.height = bh;
  const cctx = cut.getContext('2d');
  const cutData = cctx.createImageData(bw, bh);
  for (let y = 0; y < bh; y += 1) for (let x = 0; x < bw; x += 1) {
    const s = (y + y0) * W + (x + x0), d = (y * bw + x) * 4;
    cutData.data[d] = px[s * 4]; cutData.data[d + 1] = px[s * 4 + 1]; cutData.data[d + 2] = px[s * 4 + 2];
    cutData.data[d + 3] = alpha[s];
  }
  cctx.putImageData(cutData, 0, 0);

  /* ① standee：等比缩放到统一高度。 */
  const st = document.createElement('canvas');
  const sh = STANDEE_H, sw = Math.round(bw * (sh / bh));
  st.width = sw; st.height = sh;
  const stx = st.getContext('2d');
  stx.imageSmoothingQuality = 'high';
  stx.drawImage(cut, 0, 0, sw, sh);

  /* ② table seat（可选）：L2 的 4:5 半身镜头。
     不能把 st 再缩放后塞进 4:5：那会把 1360 高的全身压成 780 高，人脸比林星/米娅
     小约 43%。这里从顶部取 `width ÷ (4/5)`，包含头、肩、腰和手，底部自然落在牌桌
     中心方向；若输出 standee 不是 4:5（例如有长发/手势），仍然以它的实际宽度推导。 */
  const seatH = Math.min(sh, Math.round(sw / (4 / 5)));
  const seat = document.createElement('canvas');
  seat.width = sw; seat.height = seatH;
  const seatCtx = seat.getContext('2d');
  seatCtx.imageSmoothingQuality = 'high';
  seatCtx.drawImage(st, 0, 0, sw, seatH, 0, 0, sw, seatH);

  /* ③ portrait：3:4 深色渐变底 + figure contain 居中。 */
  const pt = document.createElement('canvas');
  pt.width = PORTRAIT_W; pt.height = PORTRAIT_H;
  const ptx = pt.getContext('2d');
  const grad = ptx.createLinearGradient(0, 0, 0, PORTRAIT_H);
  grad.addColorStop(0, '#1b2438'); grad.addColorStop(1, '#070c16');
  ptx.fillStyle = grad; ptx.fillRect(0, 0, PORTRAIT_W, PORTRAIT_H);
  const scale = Math.min(PORTRAIT_W / bw, PORTRAIT_H / bh);
  const pw = bw * scale, ph = bh * scale;
  ptx.imageSmoothingQuality = 'high';
  ptx.drawImage(cut, (PORTRAIT_W - pw) / 2, (PORTRAIT_H - ph) / 2, pw, ph);

  return {
    W, H, bg, bgKey, LO: Math.round(LO), HI: Math.round(HI),
    islands: sizes.length, droppedPixels: dropped,
    bbox: { x0, y0, x1, y1, bw, bh },
    standee: { w: sw, h: sh },
    tableSeat: { w: sw, h: seatH },
    portrait: { w: PORTRAIT_W, h: PORTRAIT_H },
    standeePng: st.toDataURL('image/png'),
    tableSeatPng: seat.toDataURL('image/png'),
    portraitPng: pt.toDataURL('image/png')
  };
}, { url: dataUrl, STANDEE_H, PORTRAIT_W, PORTRAIT_H, MARGIN });

await browser.close();
if (out.error) throw new Error(`${basename(srcPath)}: ${out.error}`);
await writeFile(standeeOut, Buffer.from(out.standeePng.split(',')[1], 'base64'));
await writeFile(portraitOut, Buffer.from(out.portraitPng.split(',')[1], 'base64'));
if (tableSeatOut) await writeFile(tableSeatOut, Buffer.from(out.tableSeatPng.split(',')[1], 'base64'));
console.log(`${basename(srcPath)} ${out.W}x${out.H}`);
console.log(`  背景色 rgb(${out.bg.join(',')}) key=${out.bgKey} → 软阈值 ${out.LO}..${out.HI}`);
console.log(`  连通区域 ${out.islands} 个，丢弃非主体像素 ${out.droppedPixels}`);
console.log(`  包围盒 ${out.bbox.bw}x${out.bbox.bh} @ (${out.bbox.x0},${out.bbox.y0})`);
console.log(`  standee  ${standeeOut}  ${out.standee.w}x${out.standee.h}`);
if (tableSeatOut) console.log(`  tableSeat ${tableSeatOut}  ${out.tableSeat.w}x${out.tableSeat.h}`);
console.log(`  portrait ${portraitOut}  ${out.portrait.w}x${out.portrait.h}`);
