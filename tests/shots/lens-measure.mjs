/* 四级镜头不变量。规范与降级都写在这里，改 CSS 前先看懂注释里的推导：
     L1 大厅主视觉：立绘高 = 视口高的 55–72%（窄视口见下）
     L2 牌桌座位半身：立绘高 = 牌桌高的 35–45%
     L5 写真卡：固定 3:4
   L3 特写与 L4 结算舞台各自在 e2e 里断言（前者需要服务端事件，后者要打完一局）。 */
import { test, expect } from '@playwright/test';

const VIEWPORTS = [
  { w: 1024, h: 720, narrow: true },
  { w: 1280, h: 720 },
  { w: 1440, h: 900 },
  { w: 1920, h: 1080 },
  { w: 2560, h: 1440 }
];

for (const vp of VIEWPORTS) {
  test(`lens invariants @ ${vp.w}x${vp.h}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.addInitScript(() => { window.__DRESSBATTLE_SKIP_ENTRY = true; });

    /* ---- L1 大厅主视觉 ---- */
    await page.goto('/');
    await page.waitForSelector('.lounge-character .pal-standee');
    const home = await page.evaluate(() => {
      const rect = (n) => { const q = n.getBoundingClientRect(); return { left: q.left, top: q.top, right: q.right, bottom: q.bottom }; };
      const hits = (a, b) => Boolean(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
      /* 标题必须量「文字行盒」而不是块盒：.lounge-copy 是 text-align:center 的 510px 列，
         而「月光落桌，以牌会友。」实际只占中间约 340px。1440 上块盒左边 465、行盒左边 550，
         林星立绘右缘 526 —— 量块盒会误报 62px 压字，量行盒才是真的没压到。 */
      const h1 = document.querySelector('.lounge-copy h1');
      const range = document.createRange();
      range.selectNodeContents(h1);
      const h1Lines = [...range.getClientRects()].filter((q) => q.width > 1).map((q) => ({ left: q.left, top: q.top, right: q.right, bottom: q.bottom }));
      const cta = document.querySelector('.lounge-cta');
      const brief = document.querySelector('.lounge-brief');
      const figs = [...document.querySelectorAll('.lounge-character .pal-standee')].map((fig) => {
        const r = fig.getBoundingClientRect();
        return {
          pal: fig.dataset.pal,
          // offsetWidth/Height 未被 rotate(±5deg) 撑大，是立绘的真实尺寸。
          w: fig.offsetWidth, h: fig.offsetHeight, box: rect(fig),
          coversH1: h1Lines.some((line) => hits(rect(fig), line)),
          coversCta: hits(rect(fig), rect(cta)),
          coversBrief: hits(rect(fig), rect(brief))
        };
      });
      return { figs, vh: window.innerHeight, h1Lines: h1Lines.length };
    });
    expect(home.h1Lines, '标题应当有可量的文字行盒').toBeGreaterThan(0);
    expect(home.figs.length, '大厅应当左右各一位牌友').toBe(2);
    for (const fig of home.figs) {
      const share = fig.h / home.vh;
      if (vp.narrow) {
        /* 1024×720 的横向净空撑不住 55%：真正卡住的是主按钮而不是标题——
           CTA 左边 340px，立绘右缘 = 24 + 0.842×H（0.842 = 0.4 + 0.442，后者是
           0.8H 宽、H 高的盒子绕中心转 5° 后右缘的外扩系数）。留出余量只能到 ~356px，
           即 49% 屏高。取 44vh（316px，右缘 291，离 CTA 49px）留足安全量，
           窄视口因此是记录在案的降级档，不假装达标。 */
        expect(share, `窄视口 ${fig.pal} 占屏 ${Math.round(share * 100)}%`).toBeGreaterThan(0.4);
      } else {
        expect(share, `${fig.pal} 占屏 ${Math.round(share * 100)}%`).toBeGreaterThanOrEqual(0.55);
        expect(share, `${fig.pal} 占屏 ${Math.round(share * 100)}%`).toBeLessThanOrEqual(0.72);
      }
      expect(fig.coversH1, `${fig.pal} 不得压住标题`).toBe(false);
      expect(fig.coversCta, `${fig.pal} 不得压住主按钮`).toBe(false);
      expect(fig.coversBrief, `${fig.pal} 不得压住底部说明条`).toBe(false);
      expect(fig.w / fig.h, `${fig.pal} 应为 4:5 立绘`).toBeCloseTo(0.8, 2);
    }
    expect(Math.abs(home.figs[0].h - home.figs[1].h), '左右两位牌友应当一样大').toBeLessThanOrEqual(1);

    /* ---- L2 牌桌座位半身 ---- */
    await page.getByRole('button', { name: /进入今晚牌局/ }).click();
    await page.waitForSelector('.table-felt');
    await page.getByRole('button', { name: '叫 3 分' }).click();
    await page.waitForSelector('.opponent .pal-standee');
    const felt = await page.evaluate(() => {
      const f = document.querySelector('.table-felt').getBoundingClientRect();
      const figs = [...document.querySelectorAll('.opponent .pal-standee')].map((n) => n.getBoundingClientRect().height);
      return { feltH: f.height, feltW: f.width, figs };
    });
    for (const height of felt.figs) {
      const s = height / felt.feltH;
      expect(s, `半身像占牌桌高 ${Math.round(s * 100)}%`).toBeGreaterThan(0.35);
      expect(s, `半身像占牌桌高 ${Math.round(s * 100)}%`).toBeLessThan(0.45);
    }
    expect(Math.abs(felt.figs[0] - felt.figs[1])).toBeLessThanOrEqual(1);

    /* ---- L5 写真卡 3:4 ---- */
    await page.evaluate(() => { location.hash = '#/gallery'; });
    await page.waitForSelector('.pcard-art');
    const card = await page.evaluate(() => {
      const a = document.querySelector('.pcard-art').getBoundingClientRect();
      return { w: a.width, h: a.height };
    });
    expect(card.w / card.h).toBeCloseTo(0.75, 2);
  });
}
