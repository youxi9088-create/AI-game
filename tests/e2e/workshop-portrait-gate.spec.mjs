import { test, expect } from '@playwright/test';
import { createPalResourcePlan, DEFAULT_DANCE_REFERENCE_VIDEO_URL } from '../../packages/pal-generation-core/index.mjs';

test('牌友工坊先生成并确认主立绘，再解锁剩余资源', async ({ page }) => {
  const referenceVideoUrl = 'https://cdn.example.test/custom-dance.mp4';
  const plan = { ...createPalResourcePlan({ prompt: '一位复古优雅的成年虚构舞台魔术师，喜欢蓝紫色灯光', version: 19, packageTier: 'launch' }), planId: 'e2e-portrait-review-plan', createdAt: '2026-09-16T00:00:00.000Z', danceReferenceVideoUrl: referenceVideoUrl };
  let portraitGate = { status: 'NOT_STARTED', taskId: null, publicUrl: null, sha256: null, bytes: null, confirmedAt: null };
  let confirmed = false;
  let productionStarted = false;
  const submittedResourceIds = [];
  const confirmRequests = [];
  const planRequests = [];
  const portraitTask = { taskId: 'e2e-portrait-task', planId: plan.planId, resourceId: 'master-portrait', label: '主立绘 / 基础层（3:4 透明）', kind: 'image', status: 'SUCCEEDED', publicUrl: '/assets/pals/yinlan-v1.png', sha256: 'a'.repeat(64), bytes: 1024, active: false };

  await page.route('**/api/pals', async (route) => {
    const method = route.request().method();
    if (method !== 'GET') return route.fallback();
    const planView = { ...plan, portraitGate, resources: plan.resources.map((resource) => {
      if (resource.id === 'master-portrait') return { ...resource, task: portraitGate.status === 'NOT_STARTED' ? null : portraitTask };
      if (!productionStarted) return { ...resource, task: null };
      return { ...resource, task: { taskId: `e2e-${resource.id}`, planId: plan.planId, resourceId: resource.id, label: resource.label, kind: resource.kind, status: resource.kind === 'video' ? 'WAITING_REFERENCE' : 'QUEUED', active: resource.kind === 'video' } };
    }) };
    await route.fulfill({ json: {
      official: [], pals: [], defaultSeats: null,
      workshop: { versions: [], confirmed: [], versionSeq: 19, plans: portraitGate.status === 'NOT_STARTED' ? [] : [planView], jobs: portraitGate.status === 'NOT_STARTED' ? [] : [portraitTask], generation: { routes: { image: { configured: true }, video: { configured: true, defaultReferenceUrl: DEFAULT_DANCE_REFERENCE_VIDEO_URL } } } }
    } });
  });

  await page.route('**/api/pals/plan', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    planRequests.push(route.request().postDataJSON());
    await route.fulfill({ status: 201, json: plan });
  });

  await page.route('**/api/pals/resources/submit', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON();
    submittedResourceIds.push(body.resourceIds || null);
    if (!confirmed) {
      portraitGate = { status: 'AWAITING_CONFIRMATION', taskId: portraitTask.taskId, publicUrl: portraitTask.publicUrl, sha256: portraitTask.sha256, bytes: portraitTask.bytes, confirmedAt: null };
      await route.fulfill({ status: 202, json: { status: 'PORTRAIT_SUBMITTED', planId: plan.planId, portraitGate, tasks: [portraitTask] } });
      return;
    }
    productionStarted = true;
    const downstream = plan.resources.filter((resource) => resource.id !== 'master-portrait').map((resource) => ({ taskId: `e2e-${resource.id}`, planId: plan.planId, resourceId: resource.id, status: resource.kind === 'video' ? 'WAITING_REFERENCE' : 'QUEUED' }));
    await route.fulfill({ status: 202, json: { status: 'SUBMITTED', planId: plan.planId, portraitGate, tasks: downstream } });
  });

  await page.route('**/api/pals/resources/portrait/confirm', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    confirmRequests.push(route.request().postDataJSON());
    confirmed = true;
    portraitGate = { ...portraitGate, status: 'CONFIRMED', confirmedAt: '2026-09-16T00:01:00.000Z' };
    await route.fulfill({ status: 202, json: { status: 'CONFIRMED', portraitGate, production: { status: 'AWAITING_CONTINUE', planId: plan.planId } } });
  });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/#/workshop');
  await page.getByLabel('描述你的成年虚构牌友').fill('一位复古优雅的成年虚构舞台魔术师，喜欢蓝紫色灯光');
  await expect(page.getByLabel('参考舞蹈视频 URL（可选）')).toHaveValue(DEFAULT_DANCE_REFERENCE_VIDEO_URL);
  await page.getByLabel('参考舞蹈视频 URL（可选）').fill(referenceVideoUrl);
  await page.screenshot({ path: 'test-results/workshop-reference-video-input.png' });
  await page.locator('#generator button[type="submit"]').click();

  await page.getByRole('button', { name: '查看详情' }).first().click();
  await expect(page.getByRole('heading', { name: '先确认这张角色资料卡' })).toBeVisible();
  expect(await page.locator('.portrait-review-image img').evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);
  await page.getByRole('button', { name: /角色资料卡大图/ }).click();
  await expect(page.locator('.image-preview-dialog img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.image-preview-modal')).toHaveCount(0);
  await expect(page.getByText('确认角色资料卡后解锁').first()).toBeVisible();
  expect(submittedResourceIds).toEqual([null]);
  expect(planRequests).toEqual([{ prompt: '一位复古优雅的成年虚构舞台魔术师，喜欢蓝紫色灯光', packageTier: 'launch', videoReferenceUrl: referenceVideoUrl, clothingStyle: 'described', accessory: 'none' }]);
  await page.locator('.portrait-review').scrollIntoViewIfNeeded();
  await page.waitForTimeout(3400);
  await page.screenshot({ path: 'test-results/workshop-portrait-review.png' });

  await page.getByRole('button', { name: '确认这张资料卡' }).click();
  await expect(page.getByText('角色资料卡已由你确认')).toBeVisible();
  await page.getByRole('button', { name: '继续生产未完成资源' }).click();
  await expect(page.locator('.resource-row.locked')).toHaveCount(0);
  expect(submittedResourceIds).toEqual([null, null]);
  expect(confirmRequests).toEqual([{ planId: plan.planId }]);

  await page.reload();
  await page.getByRole('button', { name: '查看详情' }).first().click();
  await expect(page.getByText('角色资料卡已由你确认')).toBeVisible();
  const outfitFilmWaiting = page.getByText('等待角色资料卡公网引用').first();
  await expect(outfitFilmWaiting).toBeVisible();
  await outfitFilmWaiting.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/workshop-outfit-film-waiting.png' });
  await page.waitForTimeout(3400);
  await page.screenshot({ path: 'test-results/workshop-portrait-approved.png' });
});
