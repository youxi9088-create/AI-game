import { test, expect } from '@playwright/test';

/* 名册从 2 位变 3 位后，首屏多出一整块选人器（约 183px）。牌桌的溢出用例管不到首屏，
   所以这里单独量，并且**同一页面量两遍**：一遍真实名册（3 位，出选人器），
   一遍把第三位从 /api/pals 里摘掉（2 位，不出选人器）。只有两者的差值才是这次改动
   真正引入的溢出——先分清「谁造成的」，再谈怎么修。 */
const measure = (page) => page.evaluate(() => {
  const cta = document.querySelector('.lounge-cta')?.getBoundingClientRect();
  const picker = document.querySelector('.seat-picker')?.getBoundingClientRect();
  return {
    scrollH: document.documentElement.scrollHeight,
    innerH: window.innerHeight,
    ctaBottom: cta ? +cta.bottom.toFixed(1) : null,
    pickerH: picker ? +(picker.height).toFixed(1) : 0
  };
});

for (const size of [{ width: 1024, height: 720 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
  test(`home vertical budget at ${size.width}x${size.height}`, async ({ page }) => {
    const stripThirdPal = async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      body.pals = (body.pals || []).filter((pal) => pal.palId !== 'pal-yinlan');
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    };

    await page.setViewportSize(size);
    await page.route('**/api/pals', stripThirdPal);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const twoPals = await measure(page);

    await page.unroute('**/api/pals');
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    const threePals = await measure(page);

    console.log(`HOME ${size.width}x${size.height} 2位=${JSON.stringify(twoPals)} 3位=${JSON.stringify(threePals)} 差值=${threePals.scrollH - twoPals.scrollH}`);
    expect(threePals.pickerH, '3 位时应出现选人器').toBeGreaterThan(0);
    expect(twoPals.pickerH, '2 位时不应出现选人器').toBe(0);
    /* 主按钮是首屏的动作终点，无论几位都必须在视口内。 */
    expect(threePals.ctaBottom, '主按钮被挤出视口').toBeLessThanOrEqual(size.height);
    /* 名册从 2 位扩到 3 位后，选人器曾把首屏撑到 821/846（720 高视口），
       修法是让内边距·选人器·节奏间距都按 dvh 让出份额。这里守住结果：两种名册都不许滚。 */
    expect(twoPals.scrollH, '2 位名册首屏溢出').toBeLessThanOrEqual(size.height);
    expect(threePals.scrollH, '3 位名册首屏溢出').toBeLessThanOrEqual(size.height);
  });
}
