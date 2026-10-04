import {test,expect} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const output=process.env.DRESS_PREVIEW_DIR || 'test-results';
test.use({launchOptions:{...(process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}});
test('3D cards follow the game, renderer resources are reused, and Tone plays actual samples',async({page,request})=>{
 test.setTimeout(45000);await mkdir(output,{recursive:true});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{window.__DRESSBATTLE_NPC_DELAY=600000;localStorage.setItem('dressbattle.runtime.v1',JSON.stringify({renderer:'3d',effects:'full'}));});
 let game=await(await request.post('/api/game/new',{data:{seed:2}})).json();
 game=await(await request.post('/api/game/bid',{data:{gameId:game.id,score:3,commandId:crypto.randomUUID()}})).json();
 game=await(await request.post('/api/game/play',{data:{gameId:game.id,cards:['4♠','4♥'],commandId:crypto.randomUUID()}})).json();
 await page.goto('/#/table');await expect(page.locator('.table-three')).toBeVisible();
 await expect.poll(()=>page.evaluate(async()=>(await import('/table-3d.js')).table3DStatus())).toMatchObject({ready:true,attached:true,cards:2});
 await page.getByRole('button',{name:'音量',exact:true}).click();
 await expect.poll(()=>page.evaluate(async()=>(await import('/sfx.js')).audioStatus())).toMatchObject({mode:'tone-sampled',error:null,diagnostics:{sampleCount:70,zone:'Table',transport:'started'}});
 await page.getByRole('button',{name:'关闭',exact:true}).click();await page.mouse.move(750,380);await page.waitForTimeout(600);
 await page.screenshot({path:join(output,'05-3d-table.png'),fullPage:true});
 const before=await page.evaluate(async()=>(await import('/table-3d.js')).table3DStatus());expect(before.drawCalls).toBeGreaterThan(20);
 await page.getByRole('button',{name:'音量',exact:true}).click();
 for(const theme of ['moon','velvet','jade'])await page.locator('[data-display-pref="tableSkin"]').selectOption(theme);
 const after=await page.evaluate(async()=>(await import('/table-3d.js')).table3DStatus());expect(after.geometries).toBe(before.geometries);expect(after.textures).toBe(before.textures);
 if(process.env.DRESS_CAPTURE_AUDIO==='1'){
  const bytes=await page.evaluate(async()=>{const recorder=new Tone.Recorder();Tone.getDestination().connect(recorder);await recorder.start();const {sfx}=await import('/sfx.js');for(const [i,n] of ['deal','play','pair','straight','bomb','rocket','cloth','unlock','shutter'].entries())setTimeout(()=>sfx(n),500+i*950);await new Promise(r=>setTimeout(r,12000));const blob=await recorder.stop();Tone.getDestination().disconnect(recorder);recorder.dispose();return Array.from(new Uint8Array(await blob.arrayBuffer()));});
  await writeFile(join(output,'06-live-audio.webm'),Buffer.from(bytes));
 }
 console.log('WEBGL',JSON.stringify(after));expect(errors).toEqual([]);
 await page.locator('[data-display-pref="renderer"]').selectOption('2d');await expect(page.locator('.table-three')).toHaveCount(0);
});
test('drag selection preserves ordinary clicks and selects a contiguous range',async({page,request})=>{
 await page.addInitScript(()=>{window.__DRESSBATTLE_NPC_DELAY=600000;});let game=await(await request.post('/api/game/new',{data:{seed:2}})).json();
 game=await(await request.post('/api/game/bid',{data:{gameId:game.id,score:3,commandId:crypto.randomUUID()}})).json();expect(game.turn).toBe('player');await page.goto('/#/table');
 const cards=page.locator('.hand .card');await expect(cards.first()).toBeEnabled();
 const a=await cards.nth(0).boundingBox(),b=await cards.nth(2).boundingBox();await page.mouse.move(a.x+8,a.y+35);await page.mouse.down();await page.mouse.move(b.x+8,b.y+35,{steps:8});await page.mouse.up();
 await expect(page.locator('.hand .card[aria-pressed="true"]')).toHaveCount(3);await cards.first().click({position:{x:8,y:35}});await expect(cards.first()).toHaveAttribute('aria-pressed','false');
});
test('salon keeps a full hand actionable on desktop and mobile',async({page,request})=>{
 test.setTimeout(45000);await mkdir(output,{recursive:true});
 await page.addInitScript(()=>{window.__DRESSBATTLE_NPC_DELAY=600000;localStorage.setItem('dressbattle.runtime.v1',JSON.stringify({renderer:'3d',effects:'full'}));});
 const game=await(await request.post('/api/game/new',{data:{seed:2}})).json();
 await request.post('/api/game/bid',{data:{gameId:game.id,score:3,commandId:crypto.randomUUID()}});
 await page.goto('/#/table');await expect(page.locator('.table-three')).toBeVisible();await expect(page.locator('.hand .card')).toHaveCount(20);
 await page.getByRole('button',{name:'提示',exact:true}).click();await expect(page.locator('.hand .card[aria-pressed="true"]').first()).toBeVisible();
 await expect(page.locator('#toast')).not.toHaveClass(/show/);await page.screenshot({path:join(output,'09-salon-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);
 await page.screenshot({path:join(output,'10-salon-mobile.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'出牌',exact:true}).click();await expect.poll(async()=>page.locator('.hand .card').count()).toBeLessThan(20);
 await page.waitForTimeout(400);await page.screenshot({path:join(output,'11-salon-mobile-play.png'),fullPage:true});
 await page.locator('.event-feed summary').click();await expect(page.locator('.event-feed .event').first()).toBeVisible();
});
