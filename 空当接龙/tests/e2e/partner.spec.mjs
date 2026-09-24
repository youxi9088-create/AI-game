import { test, expect } from '@playwright/test';
import { themes } from '../../app/core/themes.js';

test('platform creator clears ticket, resumes after reload, retries same work, and returns to platform', async ({ page }) => {
  let jobCreated = false, completed = false, submits = 0;
  const session = () => ({ session_id:'test-session',draft_id:'draft-browser',return_url:'https://platform.example/my-games',state:'creating',jobId:jobCreated?'job-browser':null });
  await page.route('**/health', route => route.fulfill({json:{providerConfigured:true,provider:'BrowserFixture',mockAllowed:false}}));
  await page.route('**/v1/partner/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/session')) return route.fulfill({json:session()});
    expect(route.request().headers().authorization).toBe('Bearer test-session');
    if (path.endsWith('/jobs')) { jobCreated = true; return route.fulfill({json:{jobId:'job-browser'}}); }
    if (path.endsWith('/job')) return route.fulfill({json:completed?{status:'completed',stage:'completed',progress:100,result:{theme:themes.ink,provider:'BrowserFixture'}}:{status:'running',stage:'assets',progress:45,message:'测试任务正在生成'}});
    if (path.endsWith('/query')) return route.fulfill({status:404,json:{error:'尚未确认'}});
    if (path.endsWith('/submit')) { submits++; return route.fulfill(submits===1?{status:502,json:{error:'测试响应丢失'}}:{json:{work_id:'platform-browser',state:'pending_confirm'}}); }
    return route.fulfill({json:{}});
  });
  await page.goto('/?apiPort=4274&ticket=test-ticket&template_id=freecell&return_url=https%3A%2F%2Fplatform.example%2Fmy-games&proto=v0.1');
  await expect(page.getByText('草稿已保存，刷新后可继续。')).toBeVisible();
  expect(page.url()).not.toContain('ticket');
  await page.locator('#prompt').fill('水墨山水'); await page.locator('#generate').click();
  await expect(page.getByText('测试任务正在生成')).toBeVisible();
  await page.reload(); await expect(page.getByText('测试任务正在生成')).toBeVisible();
  completed = true;
  await expect(page.locator('#partner-retry')).toBeVisible({timeout:10000});
  await page.screenshot({path:'test-results/partner-retry.png',fullPage:true});
  await page.locator('#partner-retry').click();
  await expect(page.locator('#partner-return')).toBeVisible();
  await page.screenshot({path:'test-results/partner-submitted.png',fullPage:true});
  await page.route('https://platform.example/**', route => route.fulfill({contentType:'text/html',body:'<h1>我的游戏</h1>'}));
  await page.locator('#partner-return').click(); await expect(page).toHaveURL(/platform.example\/my-games.*work_id=platform-browser/);
});

test('published work loads its exact theme, remains playable after reload, and blocks offline entry', async ({ page }) => {
  let offline = false;
  await page.route('**/v1/partner/works/*', route => route.fulfill(offline?{status:410,json:{error:'作品已下架'}}:{json:{title:'水墨作品',theme:themes.ink,deal_number:617}}));
  await page.goto('/?apiPort=4274&work=freecell-browser#game');
  await expect(page.locator('#new-deal')).toBeVisible();
  await expect(page.getByText('正在游玩：水墨作品')).toBeVisible();
  await page.locator('#new-deal').click();
  await page.locator('#reset-deal').click();
  await page.screenshot({path:'test-results/partner-work.png',fullPage:true});
  await page.reload(); await expect(page.locator('#new-deal')).toBeVisible();
  offline = true; await page.reload();
  await expect(page.getByRole('heading',{name:'作品暂不可用'})).toBeVisible();
  await page.screenshot({path:'test-results/partner-offline.png',fullPage:true});
});
