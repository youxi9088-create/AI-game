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
 const before=await page.evaluate(async()=>(await import('/table-3d.js')).table3DStatus());expect(before.drawCalls).toBeGreaterThan(0);
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
test('a real ten-card straight stays readable across desktop and portrait layouts',async({browser,request})=>{
 test.setTimeout(45000);await mkdir(output,{recursive:true});
 const context=await browser.newContext({baseURL:'http://127.0.0.1:4176',viewport:{width:1440,height:900},...(process.env.DRESS_CAPTURE_VIDEO==='1'?{recordVideo:{dir:join(output,'raw-video'),size:{width:1440,height:900}}}:{})});
 const page=await context.newPage();page.setDefaultTimeout(8000);
 try{
 await page.addInitScript(()=>{window.__DRESSBATTLE_NPC_DELAY=600000;localStorage.setItem('dressbattle.runtime.v1',JSON.stringify({renderer:'3d',effects:'full'}));});
 let game=await(await request.post('/api/game/new',{data:{seed:2}})).json();
 game=await(await request.post('/api/game/bid',{data:{gameId:game.id,score:3,commandId:crypto.randomUUID()}})).json();
 const straight=['3','4','5','6','7','8','9','10','J','Q'].map(rank=>game.playerHand.find(card=>card.replace(/[♠♥♦♣]/g,'')===rank));expect(straight.every(Boolean)).toBe(true);
 await page.goto('/#/table');await expect(page.locator('.table-three')).toBeVisible();
 for(const card of straight)await page.locator(`.hand .card[data-card="${card}"]`).click({position:{x:8,y:25}});
 await expect(page.locator('.hand .card[aria-pressed="true"]')).toHaveCount(10);
 await page.getByRole('button',{name:'出牌',exact:true}).click();
 await expect(page.locator('.hand .card')).toHaveCount(10);
 await expect.poll(()=>page.evaluate(async()=>(await import('/table-3d.js')).table3DStatus())).toMatchObject({cards:10,cardRows:2,sourceSeat:'player'});
 await page.waitForTimeout(1100);await expectSeatsClear(page);await page.screenshot({path:join(output,'12-straight-desktop.png'),fullPage:true});
 for(const viewport of [{width:1440,height:900},{width:1280,height:720},{width:1920,height:1080}]){
  await page.setViewportSize(viewport);await page.waitForTimeout(250);await expectSeatsClear(page);
  const geometry=await page.evaluate(async()=>{const status=(await import('/table-3d.js')).table3DStatus();return {readable:status.readableRanks,span:status.cardBounds.right-status.cardBounds.left,ratios:status.cardFaceRatios,bottom:status.cardBounds.bottom,controls:document.querySelector('.hand-header').getBoundingClientRect().top};});
  for(const ratio of geometry.ratios){expect(ratio).toBeGreaterThan(.69);expect(ratio,'natural shallow tilt must not flatten ranks').toBeLessThan(.79);}
  expect(geometry.readable.every(Boolean),'each rank corner must remain visible through the pile').toBe(true);expect(geometry.span).toBeLessThan(viewport.width*.4);
  expect(geometry.bottom,'played cards must clear hand controls').toBeLessThan(geometry.controls-5);
 }
 await page.setViewportSize({width:390,height:844});
 await expect.poll(()=>page.evaluate(async()=>(await import('/table-3d.js')).table3DStatus())).toMatchObject({cards:10,cardRows:2});
 await page.waitForTimeout(500);await expectSeatsClear(page);await page.screenshot({path:join(output,'13-straight-mobile.png'),fullPage:true});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 // Once the cards land, the renderer must sleep instead of burning frames while idle.
 const first=await page.evaluate(async()=>(await import('/table-3d.js')).table3DStatus().frames);
 await page.waitForTimeout(350);const second=await page.evaluate(async()=>(await import('/table-3d.js')).table3DStatus().frames);expect(second-first).toBeLessThanOrEqual(1);
 }finally{const video=page.video();await context.close();if(video)await video.saveAs(join(output,'14-card-play.webm'));}
});

async function expectSeatsClear(page){
 const overlaps=await page.evaluate(async()=>{const c=(await import('/table-3d.js')).table3DStatus().cardBounds;return [...document.querySelectorAll('.opponent>div:not([class])')].map(n=>n.getBoundingClientRect()).some(r=>c.left<r.right&&c.right>r.left&&c.top<r.bottom&&c.bottom>r.top);});expect(overlaps,'played cards must clear opponent role badges').toBe(false);
}
