import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

// Full Chromium keeps native input behaviour consistent with desktop browsers.
const baseURL = process.env.MC_BASE_URL || 'http://127.0.0.1:5191/';
const passed = [], errors = [];
let server, browser, currentPage, currentContext, stage = 'startup', serverLog = '';
await mkdir('.qa', { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, value) => { assert.ok(value, name); passed.push(name); console.log(`PASS ${name}`); };
const wait = (page, predicate, arg) => page.waitForFunction(predicate, arg, { timeout: 45000, polling: 'raf' });

async function instrument(context) {
  await context.addInitScript(() => {
    // These are ordinary supported settings, keeping software WebGL inexpensive.
    localStorage.setItem('mc.voxel.settings', JSON.stringify({ volume: 0, renderDistance: 2, bob: false, sensitivity: 1, fov: 75 }));
    window.__inputEvents = [];
    for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'pointercancel', 'keydown', 'keyup', 'pointerlockchange', 'pointerlockerror']) document.addEventListener(type, event => {
      window.__inputEvents.push({ type, time: Math.round(performance.now()), target: event.target?.id || event.target?.tagName, x: event.clientX, y: event.clientY, button: event.button, code: event.code, pointerType: event.pointerType, locked: document.pointerLockElement?.id, yaw: window.__MC__?.player?.yaw, pitch: window.__MC__?.player?.pitch });
      if (window.__inputEvents.length > 70) window.__inputEvents.shift();
    }, true);
  });
  // Continuous screenshots force costly GPU readbacks for software WebGL. Keep
  // action/DOM traces; explicit state PNGs and the failure PNG cover visuals.
  await context.tracing.start({ screenshots: false, snapshots: true, sources: false });
}
function track(page, label) {
  page.setDefaultTimeout(30000);
  page.on('pageerror', error => errors.push({ page: label, type: 'runtime', message: error.stack }));
  page.on('console', message => { if (message.type() === 'error') errors.push({ page: label, type: 'console', message: message.text() }); });
  return page;
}
async function createWorld(page, name, creative = false, touch = false) {
  const activate = locator => touch ? locator.tap() : locator.click();
  await page.goto(baseURL, { waitUntil: 'networkidle', timeout: 60000 });
  await activate(page.getByRole('button', { name: '单人游戏', exact: true }));
  await activate(page.getByRole('button', { name: '创建新的世界', exact: true }));
  await page.locator('#world-name').fill(name); await page.locator('#world-seed').fill('2026');
  if (creative) await activate(page.locator('[data-mode=creative]'));
  await activate(page.getByRole('button', { name: '创建世界', exact: true }));
  await wait(page, () => window.__MC__?.active && !__MC__.ui.isOpen);
}
async function loadWorld(page) {
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '单人游戏', exact: true }).click();
  await page.getByRole('button', { name: '进入世界', exact: true }).click();
  await wait(page, () => window.__MC__?.active);
}
async function aimAtTestBlock(page, id = 2) {
  // Move before the camera fixture so lock recenter cannot corrupt the test aim.
  const { width, height } = page.viewportSize();
  await page.mouse.move(width / 2, height / 2);
  await page.evaluate(async id => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const { world, player } = __MC__;
    for (let x = -2; x < 5; x++) for (let z = -5; z < 5; z++) {
      world.setBlock(x, 70, z, 3); for (let y = 71; y < 76; y++) world.setBlock(x, y, z, 0);
    }
    world.setBlock(1, 72, -2, id); player.position.set(1.5, 71, 1.5);
    player.velocity.set(0, 0, 0); player.fallStart = 71; player.yaw = player.pitch = 0; player.syncCamera();
  }, id);
  await wait(page, id => __MC__.hit?.id === id && __MC__.hit.x === 1 && __MC__.hit.z === -2 && __MC__.player.grounded && !__MC__.world.queue.length && !__MC__.world.dirty.size, id);
}

try {
  if (!process.env.MC_BASE_URL) {
    server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5191', '--strictPort'], { stdio: 'pipe', windowsHide: true });
    server.stdout.on('data', data => { serverLog += data; }); server.stderr.on('data', data => { serverLog += data; });
    let ready = false;
    for (let attempt = 0; attempt < 150; attempt++) {
      if (server.exitCode !== null) break;
      try { if ((await fetch(baseURL)).ok) { ready = true; break; } } catch { /* Starting Vite. */ }
      await sleep(200);
    }
    assert.ok(ready, `Vite failed to start: ${serverLog}`);
  }
  process.on('exit', () => server?.kill());
  browser = await chromium.launch({ headless: true, ...(process.env.MC_BROWSER_PATH ? { executablePath: process.env.MC_BROWSER_PATH } : { channel: process.env.MC_BROWSER_CHANNEL || 'chromium' }), args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  // Scope is only for focused local diagnosis; CI runs both paths by default.
  if (process.env.MC_SMOKE_SCOPE !== 'mobile') {
  const desktop = currentContext = await browser.newContext({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
  await instrument(desktop);
  const page = currentPage = track(await desktop.newPage(), 'desktop');

  stage = 'desktop: create and mine';
  await createWorld(page, '联调存档');
  check('survival starts empty', await page.evaluate(() => __MC__.inventory.slots.every(stack => stack === null)));
  await aimAtTestBlock(page); await page.mouse.down({ button: 'left' });
  await wait(page, () => __MC__.world.getBlock(1, 72, -2) === 0); await page.mouse.up({ button: 'left' });
  check('actual left mouse mines dirt bare handed', await page.evaluate(() => __MC__.world.getBlock(1, 72, -2) === 0));
  check('mining creates a persistent drop', await page.evaluate(() => __MC__.visuals.drops.some(drop => drop.id === 2)));
  await page.evaluate(() => { __MC__.world.setBlock(1, 72, -2, 3); __MC__.inventory.add(2, 2); __MC__.inventory.select(0); });
  await wait(page, () => __MC__.hit?.id === 3); await page.mouse.down({ button: 'right' }); await page.mouse.up({ button: 'right' });
  await wait(page, () => __MC__.world.getBlock(1, 72, -1) === 2);
  check('actual right mouse places adjacent block', true);
  check('survival placement consumes exactly one', await page.evaluate(() => __MC__.inventory.count(2) === 1));

  stage = 'desktop: crafting and cursor save';
  await page.keyboard.press('e'); await page.waitForSelector('[data-source=craft]');
  await page.evaluate(() => { __MC__.inventory.add(6, 2); __MC__.ui.renderInventory(); });
  await page.locator('[data-source=inventory][data-item-name="橡木原木"]').click();
  await page.locator('[data-source=craft][data-index="0"]').click({ button: 'right' });
  await page.locator('[data-source=inventory][data-index="10"]').click();
  check('2x2 crafting yields four planks', await page.locator('[data-source=result]').getAttribute('data-item-name') === '橡木木板');
  await page.locator('[data-source=result]').click({ modifiers: ['Shift'] });
  check('crafting output transfers without duplication', await page.evaluate(() => __MC__.inventory.count(8) === 4 && __MC__.inventory.count(6) === 1));
  await page.locator('[data-action=recipes]').click(); await page.locator('[data-recipe="crafting"]').click();
  await page.locator('[data-source=result]').click({ modifiers: ['Shift'] });
  check('recipe book produces workbench from planks', await page.evaluate(() => __MC__.inventory.count(17) === 1 && __MC__.inventory.count(8) === 0));
  await page.screenshot({ path: '.qa/survival-inventory.png' });
  await page.locator('[data-source=inventory][data-item-name="橡木原木"]').click(); await page.evaluate(() => __MC__.saveGame());
  check('cursor contents included in snapshot', await page.evaluate(() => __MC__.store.read(__MC__.store.list()[0].id).pendingItems[0]?.id === 6));
  await loadWorld(page);
  check('load restores cursor stack without loss', await page.evaluate(() => __MC__.inventory.count(6) === 1));
  check('load restores placed block', await page.evaluate(() => __MC__.world.getBlock(1, 72, -1) === 2));
  check('load restores ground drops', await page.evaluate(() => __MC__.visuals.drops.some(drop => drop.id === 2)));

  stage = 'desktop: creative inventory and settings';
  await page.keyboard.press('F4'); check('F4 switches creative mode', await page.evaluate(() => __MC__.player.mode === 'creative'));
  await wait(page, () => !__MC__.world.queue.length && !__MC__.world.dirty.size);
  const keyboard = await desktop.newCDPSession(page);
  // Queue genuine browser inputs together: four driver round trips can exceed
  // the game's 280ms double-tap window when a software-rendered frame is slow.
  await Promise.all(['rawKeyDown', 'keyUp', 'rawKeyDown', 'keyUp'].map(type => keyboard.send('Input.dispatchKeyEvent', { type, key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 })));
  check('double space enables flight', await page.evaluate(() => __MC__.player.flying));
  await page.keyboard.press('e'); await page.locator('#creative-search').fill('钻石镐'); await page.locator('[data-source=creative]').click({ modifiers: ['Shift'] });
  check('searchable creative catalog gives tool', await page.evaluate(() => __MC__.inventory.count(150) === 1));
  await page.screenshot({ path: '.qa/creative-inventory.png' }); await page.locator('#creative-search').focus(); await page.keyboard.press('Escape');
  await wait(page, () => !__MC__.ui.isOpen); check('Esc closes search focused inventory', true);
  await page.keyboard.press('Escape'); await page.locator('[data-action=settings]').click();
  check('sensitivity slider is normalized multiplier', Number(await page.locator('[data-setting=sensitivity]').inputValue()) === 1);
  await page.screenshot({ path: '.qa/settings.png' }); await page.locator('[data-action=done]').click(); await page.locator('[data-action=resume]').click();
  await page.evaluate(() => { __MC__.executeCommand('/time night'); __MC__.executeCommand('/weather rain'); });
  await wait(page, () => __MC__.environment.weather === 'rain' && __MC__.environment.time > .7);
  check('weather and time commands work', true); await page.screenshot({ path: '.qa/night-rain.png' });

  stage = 'desktop: death save and respawn';
  await page.evaluate(() => { __MC__.executeCommand('/gamemode survival'); __MC__.player.damageCooldown = 0; __MC__.player.damage(100, '测试'); });
  await page.waitForSelector('[data-action=respawn]'); await loadWorld(page); await page.waitForSelector('[data-action=respawn]');
  check('dead save loads into respawn screen', true); await page.locator('[data-action=respawn]').click();
  await wait(page, () => __MC__.player.health === 20); check('respawn restores full health', true);

  stage = 'desktop: embedded direct drag fallback';
  await page.addInitScript(() => { HTMLCanvasElement.prototype.requestPointerLock = async () => { throw new DOMException('Embedded preview denies pointer lock', 'NotAllowedError'); }; });
  await loadWorld(page); await page.waitForSelector('#fallback-controls:not([hidden])');
  check('embedded pointer-lock rejection enters playable fallback', await page.evaluate(() => __MC__.active && !__MC__.ui.isOpen));
  await page.keyboard.press('Escape'); await page.locator('[data-action=resume]').click(); await page.waitForSelector('#fallback-controls:not([hidden])');
  check('resume succeeds after pointer lock is rejected', await page.evaluate(() => !__MC__.ui.isOpen));
  await aimAtTestBlock(page); const oldYaw = await page.evaluate(() => __MC__.player.yaw);
  await page.mouse.down(); await page.mouse.move(650, 350, { steps: 8 }); await page.mouse.up();
  check('plain drag controls fallback camera without modifier keys', await page.evaluate(old => Math.abs(__MC__.player.yaw - old) > .1, oldYaw));
  check('camera drag does not mine the target block', await page.evaluate(() => __MC__.world.getBlock(1, 72, -2) === 2));
  await aimAtTestBlock(page); await page.mouse.down(); await wait(page, () => __MC__.world.getBlock(1, 72, -2) === 0); await page.mouse.up();
  check('stationary hold mines in fallback mode', true); await page.screenshot({ path: '.qa/embedded-fallback.png' });
  await desktop.tracing.stop({ path: '.qa/desktop-trace.zip' }); await desktop.close();
  }

  if (process.env.MC_SMOKE_SCOPE !== 'desktop') {
  stage = 'mobile: touch joystick and camera';
  const mobileContext = currentContext = await browser.newContext({ viewport: { width: 844, height: 480 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await instrument(mobileContext);
  const phone = currentPage = track(await mobileContext.newPage(), 'mobile');
  await createWorld(phone, '触屏联调', true, true); await phone.waitForSelector('#mobile-touch-controls:not([hidden])');
  check('mobile touch controls appear without pointer lock', await phone.evaluate(() => !document.pointerLockElement && !__MC__.ui.isOpen));
  await phone.evaluate(() => {
    const { world, player } = __MC__;
    for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) {
      world.setBlock(x, 70, z, 3); for (let y = 71; y <= 75; y++) world.setBlock(x, y, z, 0);
    }
    player.position.set(.5, 71, .5); player.velocity.set(0, 0, 0); player.fallStart = 71;
    player.yaw = player.pitch = 0; player.flying = false; player.syncCamera();
  });
  await wait(phone, () => __MC__.player.grounded && !__MC__.world.queue.length && !__MC__.world.dirty.size);
  const cdp = await mobileContext.newCDPSession(phone);
  const joystick = await phone.locator('[data-touch=joystick]').boundingBox(); assert(joystick, 'joystick is visible');
  const stick = { id: 1, x: joystick.x + joystick.width / 2, y: joystick.y + joystick.height / 2 };
  const contact = point => ({ ...point, radiusX: 3, radiusY: 3, force: 1 });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [contact(stick)] });
  stick.y -= joystick.height * .30; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [contact(stick)] });
  await wait(phone, () => __MC__.player.position.z < .15); check('dragging mobile joystick moves the player', true);
  const mobileYaw = await phone.evaluate(() => __MC__.player.yaw), look = { id: 2, x: 530, y: 170 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [contact(stick), contact(look)] });
  look.x += 85; await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [contact(stick), contact(look)] });
  await wait(phone, old => Math.abs(__MC__.player.yaw - old) > .08, mobileYaw); check('second touch rotates camera while joystick stays held', true);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await wait(phone, () => Math.hypot(__MC__.player.velocity.x, __MC__.player.velocity.z) < .03); check('releasing touches stops joystick movement', true);
  const beforeJump = await phone.evaluate(() => __MC__.player.position.y), jump = await phone.locator('[data-touch=jump]').boundingBox();
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [contact({ id: 3, x: jump.x + jump.width / 2, y: jump.y + jump.height / 2 })] });
  await wait(phone, y => __MC__.player.position.y > y + .1, beforeJump);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); check('mobile jump button jumps', true);
  await phone.locator('[data-touch=inventory]').tap(); await phone.waitForSelector('#creative-search'); check('mobile inventory button opens creative inventory', true);
  await phone.locator('#creative-search').fill('钻石镐');
  await phone.locator('[data-source=creative]').tap();
  await phone.locator('[data-source=inventory][data-index="9"]').tap();
  check('touch taps transfer a catalog tool into one inventory slot', await phone.evaluate(() => __MC__.inventory.count(150) === 1 && __MC__.ui.cursor === null));
  await phone.locator('[data-action=close]').tap(); await phone.waitForSelector('#mobile-touch-controls:not([hidden])');
  await phone.screenshot({ path: '.qa/mobile-controls.png' });
  await phone.locator('[data-touch=pause]').tap(); await phone.waitForSelector('[data-action=resume]'); check('mobile pause button pauses the world', true);
  await phone.locator('[data-action=resume]').tap(); await phone.waitForSelector('#mobile-touch-controls:not([hidden])');
  await mobileContext.tracing.stop({ path: '.qa/mobile-trace.zip' });
  }
  check('no browser runtime errors', errors.length === 0);
  await writeFile('.qa/browser-result.json', JSON.stringify({ passed, errors }, null, 2)); console.log(JSON.stringify({ passed: passed.length, errors }));
} catch (error) {
  const diagnostic = { stage, failed: error.stack, errors, passed, serverLog };
  if (currentPage && !currentPage.isClosed()) {
    diagnostic.state = await currentPage.evaluate(() => ({ body: document.body.innerText, events: window.__inputEvents, pointerLock: document.pointerLockElement?.id, game: window.__MC__ && { active: __MC__.active, menu: __MC__.ui.menu, hit: __MC__.hit, player: __MC__.player?.serialize(), grounded: __MC__.player?.grounded, queue: __MC__.world?.queue.length, dirty: __MC__.world?.dirty.size, mining: document.querySelector('.mining-progress')?.outerHTML, render: __MC__.renderer?.info?.render } })).catch(cause => ({ diagnosticError: cause.message }));
    await currentPage.screenshot({ path: '.qa/failure.png', timeout: 15000 }).catch(() => {});
  }
  await currentContext?.tracing.stop({ path: '.qa/failure-trace.zip' }).catch(() => {});
  await writeFile('.qa/failure.json', JSON.stringify(diagnostic, null, 2)); console.error(JSON.stringify(diagnostic)); throw error;
} finally { await browser?.close(); server?.kill(); }
