import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
await mkdir('.qa',{recursive:true});
const baseURL=process.env.MC_BASE_URL||'http://127.0.0.1:5191/';
let server;
if(!process.env.MC_BASE_URL){
 server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5191','--strictPort'],{stdio:'pipe',windowsHide:true});
 let startup='';server.stdout.on('data',d=>startup+=d);server.stderr.on('data',d=>startup+=d);
 let ready=false;for(let i=0;i<150;i++){try{const r=await fetch(baseURL);if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,200));}
 if(!ready){server.kill();throw new Error('Vite failed to start: '+startup);}
}
process.on('exit',()=>server?.kill());
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true,...(process.env.MC_BROWSER_PATH?{executablePath:process.env.MC_BROWSER_PATH}:{}),args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const errors=[];page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const passed=[];const check=(name,v)=>{assert.ok(v,name);passed.push(name);console.log('PASS '+name);};
try{
 await page.goto(baseURL,{waitUntil:'networkidle',timeout:60000});
 await page.getByRole('button',{name:'单人游戏',exact:true}).click();await page.getByRole('button',{name:'创建新的世界',exact:true}).click();
 await page.locator('#world-name').fill('联调存档');await page.locator('#world-seed').fill('2026');await page.getByRole('button',{name:'创建世界',exact:true}).click();
 await page.waitForFunction(()=>window.__MC__?.active&&__MC__.ui.menu===null,{timeout:60000});
 await page.waitForTimeout(4000);check('survival starts empty',await page.evaluate(()=>__MC__.inventory.slots.every(s=>s===null)));
 await page.evaluate(()=>{const {world,player}=__MC__;for(let x=-2;x<5;x++)for(let z=-5;z<5;z++){world.setBlock(x,70,z,3);for(let y=71;y<76;y++)world.setBlock(x,y,z,0);}world.setBlock(1,72,-2,2);player.position.set(1.5,71,1.5);player.velocity.set(0,0,0);player.fallStart=71;player.yaw=player.pitch=0;player.syncCamera();});
 await page.waitForFunction(()=>__MC__.hit?.id===2,{timeout:10000});
 await page.mouse.down({button:'left'});await page.waitForFunction(()=>__MC__.world.getBlock(1,72,-2)===0,{},{timeout:20000});await page.mouse.up({button:'left'});
 check('actual left mouse mines dirt bare handed',await page.evaluate(()=>__MC__.world.getBlock(1,72,-2)===0));
 check('mining creates a persistent drop',await page.evaluate(()=>__MC__.visuals.drops.some(d=>d.id===2)));
 await page.evaluate(()=>{__MC__.world.setBlock(1,72,-2,3);__MC__.inventory.add(2,2);__MC__.inventory.select(0);});await page.waitForFunction(()=>__MC__.hit?.id===3);
 await page.mouse.click(720,450,{button:'right'});await page.waitForTimeout(300);
 check('actual right mouse places adjacent block',await page.evaluate(()=>__MC__.world.getBlock(1,72,-1)===2));
 check('survival placement consumes exactly one',await page.evaluate(()=>__MC__.inventory.count(2)===1));
 await page.keyboard.press('e');await page.waitForSelector('[data-source=craft]');
 await page.evaluate(()=>{__MC__.inventory.add(6,2);__MC__.ui.renderInventory();});
 const log=page.locator('[data-source=inventory][data-item-name="橡木原木"]');await log.click();await page.locator('[data-source=craft][data-index="0"]').click({button:'right'});
 await page.locator('[data-source=inventory][data-index="10"]').click();
 check('2x2 crafting yields four planks',await page.locator('[data-source=result]').getAttribute('data-item-name')==='橡木木板');
 await page.locator('[data-source=result]').click({modifiers:['Shift']});check('crafting output transfers without duplication',await page.evaluate(()=>__MC__.inventory.count(8)===4&&__MC__.inventory.count(6)===1));
 await page.locator('[data-action=recipes]').click();await page.locator('[data-recipe="crafting"]').click();
 await page.locator('[data-source=result]').click({modifiers:['Shift']});check('recipe book produces workbench from planks',await page.evaluate(()=>__MC__.inventory.count(17)===1&&__MC__.inventory.count(8)===0));
 await page.screenshot({path:'.qa/survival-inventory.png'});
 // Save while one item sits on the cursor; reloading must return it exactly once.
 await page.locator('[data-source=inventory][data-item-name="橡木原木"]').click();
 await page.evaluate(()=>__MC__.saveGame());check('cursor contents included in snapshot',await page.evaluate(()=>__MC__.store.read(__MC__.store.list()[0].id).pendingItems[0]?.id===6));
 await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'单人游戏',exact:true}).click();await page.getByRole('button',{name:'进入世界',exact:true}).click();await page.waitForFunction(()=>__MC__?.active,{timeout:60000});
 check('load restores cursor stack without loss',await page.evaluate(()=>__MC__.inventory.count(6)===1));check('load restores placed block',await page.evaluate(()=>__MC__.world.getBlock(1,72,-1)===2));check('load restores ground drops',await page.evaluate(()=>__MC__.visuals.drops.some(d=>d.id===2)));
 await page.keyboard.press('F4');check('F4 switches creative mode',await page.evaluate(()=>__MC__.player.mode==='creative'));
 await page.keyboard.press('Space');await page.waitForTimeout(80);await page.keyboard.press('Space');check('double space enables flight',await page.evaluate(()=>__MC__.player.flying));
 await page.keyboard.press('e');await page.locator('#creative-search').fill('钻石镐');await page.locator('[data-source=creative]').click({modifiers:['Shift']});check('searchable creative catalog gives tool',await page.evaluate(()=>__MC__.inventory.count(150)===1));
 await page.screenshot({path:'.qa/creative-inventory.png'});await page.locator('#creative-search').focus();await page.keyboard.press('Escape');await page.waitForTimeout(250);check('Esc closes search focused inventory',await page.evaluate(()=>!__MC__.ui.isOpen));
 await page.keyboard.press('Escape');await page.waitForSelector('[data-action=settings]');await page.locator('[data-action=settings]').click();
 const sensitivity=await page.locator('[data-setting=sensitivity]').inputValue();check('sensitivity slider is normalized multiplier',Number(sensitivity)===1);
 await page.screenshot({path:'.qa/settings.png'});await page.locator('[data-action=done]').click();await page.locator('[data-action=resume]').click();
 await page.evaluate(()=>{__MC__.executeCommand('/time night');__MC__.executeCommand('/weather rain');});await page.waitForTimeout(1000);check('weather and time commands work',await page.evaluate(()=>__MC__.environment.weather==='rain'&&__MC__.environment.time>.7));
 await page.screenshot({path:'.qa/night-rain.png'});
 await page.evaluate(()=>{__MC__.executeCommand('/gamemode survival');__MC__.player.damageCooldown=0;__MC__.player.damage(100,'测试');});await page.waitForSelector('[data-action=respawn]');
 await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'单人游戏',exact:true}).click();await page.getByRole('button',{name:'进入世界',exact:true}).click();await page.waitForSelector('[data-action=respawn]',{timeout:60000});check('dead save loads into respawn screen',true);
 await page.locator('[data-action=respawn]').click();await page.waitForFunction(()=>__MC__.player.health===20);check('respawn restores full health',true);
 // Emulate an embedded webview rejecting Pointer Lock. Gameplay and resume must remain usable.
 await page.addInitScript(()=>{HTMLCanvasElement.prototype.requestPointerLock=async()=>{throw new DOMException('Embedded preview denies pointer lock','NotAllowedError');};});
 await page.reload({waitUntil:'networkidle'});await page.getByRole('button',{name:'单人游戏',exact:true}).click();await page.getByRole('button',{name:'进入世界',exact:true}).click();
 await page.waitForSelector('#fallback-controls:not([hidden])',{timeout:60000});
 check('embedded pointer-lock rejection enters playable fallback',await page.evaluate(()=>__MC__.active&&!__MC__.ui.isOpen));
 await page.keyboard.press('Escape');await page.locator('[data-action=resume]').click();await page.waitForSelector('#fallback-controls:not([hidden])');
 check('resume succeeds after pointer lock is rejected',await page.evaluate(()=>!__MC__.ui.isOpen));
 const oldYaw=await page.evaluate(()=>__MC__.player.yaw);await page.keyboard.down('Alt');await page.mouse.move(500,350);await page.mouse.down();await page.mouse.move(630,350,{steps:5});await page.mouse.up();await page.keyboard.up('Alt');
 check('Alt drag controls fallback camera',await page.evaluate(old=>Math.abs(__MC__.player.yaw-old)>.1,oldYaw));
 await page.screenshot({path:'.qa/embedded-fallback.png'});
 check('no browser runtime errors',errors.length===0);console.log(JSON.stringify({passed:passed.length,errors}));
}catch(error){await page.screenshot({path:'.qa/failure.png'});console.error(JSON.stringify({failed:error.message,body:await page.locator('body').innerText(),errors}));throw error;}finally{await browser.close();server?.kill();}
