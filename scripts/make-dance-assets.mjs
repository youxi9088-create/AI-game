/* 从竖屏写真视频产出配套静帧资产。**全部来自视频本身，不生成任何新画面。**
   产出：
     <poster>      源片的原始 4:7 整帧（600×1050）——同时当 <video poster> 和信箱式留边的模糊填充底
     <silhouette>  同一帧按卡面最终构图（3:4 + 信箱式）渲染后再去色压暗——与其它牌友的剪影风格一致
     <frame>       同一帧按卡面最终构图（3:4 + 信箱式）的**未压暗**版——给 layerSnapshot.outfit 用

   为什么 poster 保持 4:7 而不预先裁成 3:4：卡面里主体是 object-fit: contain 的，
   poster 跟着 contain 走才能和播放中的画面完全对齐；模糊底层再用 object-fit: cover 铺满。
   一张原比例图同时满足两个用途。

   那为什么还要 frame？因为 layerSnapshot.outfit 是**分层静帧**，在 .dressup-figure（3:4）里走
   object-fit: cover：直接拿 4:7 的 poster 当 outfit，cover 会按宽度撑满后裁掉 24% 的高度——
   正好是脚。所以 4:7 归 poster，3:4 信箱式归 outfit，各归其位。

   用法：node scripts/make-dance-assets.mjs <视频> <poster输出> <silhouette输出> [frame输出]
*/
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

const rawArgs = process.argv.slice(2);
const maskFooter = rawArgs.includes('--mask-footer');
const [videoPath, posterOut, silhouetteOut, frameOut] = rawArgs.filter((arg) => arg !== '--mask-footer');
if (!videoPath || !posterOut || !silhouetteOut) throw new Error('用法: <视频> <poster输出> <silhouette输出> [frame输出] [--mask-footer]');

const videoMime = extname(videoPath).toLowerCase() === '.webm' ? 'video/webm' : 'video/mp4';
const buf = await readFile(videoPath);
const dataUrl = `data:${videoMime};base64,${buf.toString('base64')}`;

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('about:blank');

/* headless 下给 video 设 currentTime 再 drawImage 拿到的仍是首帧（seek 没真正生效），
   所以真的播一遍，用 requestVideoFrameCallback 挑最接近目标时间的帧。 */
const out = await page.evaluate(async ({ url, maskFooter }) => {
  const v = document.createElement('video');
  v.src = url; v.muted = true; v.playsInline = true; v.preload = 'auto';
  v.style.cssText = 'position:fixed;left:0;top:0;width:240px';
  document.body.appendChild(v);
  await new Promise((r) => { v.onloadeddata = r; v.onerror = r; });
  if (!v.videoWidth) return { error: 'no metadata' };
  const dur = v.duration;
  /* 生成片最后几帧经常出现人物出画、头顶被切掉或转身未完成。
     取距结尾一个安全窗口内的最后稳定帧，宁可早一点定格，也不把坏尾帧
     固化成 poster/frame，后续所有卡面与回放都会复用这张安全帧。 */
  const tailSafe = Math.min(0.6, Math.max(0.24, dur * 0.08));
  const target = Math.max(0, dur - tailSafe);
  let best = null;
  let bestDelta = Infinity;
  v.playbackRate = 4;
  await v.play();
  await new Promise((resolve) => {
    const step = (_now, meta) => {
      const d = Math.abs(meta.mediaTime - target);
      if (d < bestDelta) {
        bestDelta = d;
        const c = document.createElement('canvas');
        c.width = v.videoWidth; c.height = v.videoHeight;
        c.getContext('2d').drawImage(v, 0, 0);
        best = c;
      }
      if (v.ended || meta.mediaTime >= target) return resolve();
      v.requestVideoFrameCallback(step);
    };
    v.requestVideoFrameCallback(step);
    setTimeout(resolve, 30000);
  });
  v.pause();
  if (!best) return { error: 'no frame' };
  const grab = best;
  const w = grab.width, h = grab.height;
  /* 某些生成片会把「AI 生成」之类的运行时角标压在右下。它不是角色或舞蹈内容，
     在静帧派生时用舞台收光渐隐遮掉；实际播放走同样的 CSS 遮罩，避免卡面/舞台前后不一致。 */
  const coverFooter = (ctx, width, height) => {
    if (!maskFooter) return;
    const x = width * .56, y = height * .9;
    const gradient = ctx.createLinearGradient(x, y, width, height);
    gradient.addColorStop(0, 'rgba(9,13,24,0)');
    gradient.addColorStop(.34, 'rgba(9,13,24,.72)');
    gradient.addColorStop(1, 'rgba(9,13,24,.96)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, width - x, height - y);
  };

  // 1) poster：原始 4:7 整帧，缩到宽 600。
  const pw = 600, ph = Math.round((600 * h) / w);
  const pc = document.createElement('canvas');
  pc.width = pw; pc.height = ph;
  const pctx = pc.getContext('2d');
  pctx.drawImage(grab, 0, 0, pw, ph);
  coverFooter(pctx, pw, ph);

  // 2) 卡面最终构图（3:4 信箱式：模糊铺满 + 主体 contain + 两侧压暗），先出一张未压暗的 frame。
  const cw = 600, ch = 800;
  const sc = document.createElement('canvas');
  sc.width = cw; sc.height = ch;
  const sctx = sc.getContext('2d');
  sctx.fillStyle = '#05080f'; sctx.fillRect(0, 0, cw, ch);
  // 模糊底层：cover 铺满，放大 1.18 倍（与 CSS 的 .vframe-blur 同参数）
  const coverScale = Math.max(cw / w, ch / h) * 1.18;
  const coverW = w * coverScale, coverH = h * coverScale;
  sctx.save();
  sctx.filter = 'blur(26px) saturate(1.25) brightness(0.62)';
  sctx.drawImage(grab, (cw - coverW) / 2, (ch - coverH) / 2, coverW, coverH);
  sctx.restore();
  // 主体：contain 居中（与 CSS 的 .vframe-main 同参数）
  const mainScale = Math.min(cw / w, ch / h);
  const mainW = w * mainScale, mainH = h * mainScale;
  sctx.drawImage(grab, (cw - mainW) / 2, (ch - mainH) / 2, mainW, mainH);
  // 两侧渐隐（与 CSS 的 .vframe::after 同参数）
  const grad = sctx.createLinearGradient(0, 0, cw, 0);
  grad.addColorStop(0, '#05080fcc'); grad.addColorStop(0.18, '#05080f00');
  grad.addColorStop(0.82, '#05080f00'); grad.addColorStop(1, '#05080fcc');
  sctx.fillStyle = grad; sctx.fillRect(0, 0, cw, ch);
  coverFooter(sctx, cw, ch);
  const frameUrl = sc.toDataURL('image/jpeg', 0.88);
  // 3) 在同一个画布上继续去色压暗 → 剪影
  sctx.globalCompositeOperation = 'saturation';
  sctx.fillStyle = '#000'; sctx.fillRect(0, 0, cw, ch);
  sctx.globalCompositeOperation = 'multiply';
  sctx.fillStyle = '#1d1d1d'; sctx.fillRect(0, 0, cw, ch);
  sctx.globalCompositeOperation = 'source-over';

  return {
    w, h, dur: +dur.toFixed(2), grabbedAt: +(target).toFixed(2), tailSafe: +tailSafe.toFixed(2),
    poster: pc.toDataURL('image/jpeg', 0.88),
    silhouette: sc.toDataURL('image/jpeg', 0.86),
    frame: frameUrl
  };
}, { url: dataUrl, maskFooter });

await browser.close();
if (out.error) throw new Error(`${basename(videoPath)}: ${out.error}`);
await writeFile(posterOut, Buffer.from(out.poster.split(',')[1], 'base64'));
await writeFile(silhouetteOut, Buffer.from(out.silhouette.split(',')[1], 'base64'));
if (frameOut) await writeFile(frameOut, Buffer.from(out.frame.split(',')[1], 'base64'));
console.log(`${basename(videoPath)} ${out.w}x${out.h} ${out.dur}s → 安全取帧 t≈${out.grabbedAt}s（距尾 ${out.tailSafe}s）`);
console.log(`  poster     ${posterOut}`);
console.log(`  silhouette ${silhouetteOut}`);
if (frameOut) console.log(`  frame      ${frameOut}`);
