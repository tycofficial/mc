import { ITEMS, CREATIVE_ITEMS, B } from './data.js';
import { RECIPES, craft, matchRecipe, FUELS } from './recipes.js';
import { addToSlots, sameStack } from './inventory.js';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = stack => stack ? { ...stack } : null;
const DEFAULT_SETTINGS = { volume: .35, sensitivity: 1, renderDistance: 4, fov: 75, bob: true, debug: false };

export class UI {
  constructor({ callbacks = {}, getIcon = () => '', settings = {}, touch = false } = {}) {
    this.callbacks = callbacks; this.getIcon = getIcon;
    this.touch = touch;
    this.settings = { ...DEFAULT_SETTINGS, ...settings };
    this.root = document.querySelector('#ui');
    this.root.innerHTML = '<div id="hud" hidden></div><div id="menu-layer"></div><div id="toast-stack" aria-live="polite"></div><div id="item-tooltip"></div><div id="cursor-item"></div>';
    this.layer = this.root.querySelector('#menu-layer'); this.hud = this.root.querySelector('#hud');
    this.toasts = this.root.querySelector('#toast-stack'); this.tooltip = this.root.querySelector('#item-tooltip'); this.cursorEl = this.root.querySelector('#cursor-item');
    this.menu = null; this.worlds = []; this.lastState = {}; this.iconCache = new Map();
    this.cursor = null; this.craftGrid = []; this.filter = ''; this.category = '全部'; this.recipeOpen = false;
    this.root.addEventListener('contextmenu', event => event.preventDefault());
    this.root.addEventListener('pointermove', event => {
      this.cursorEl.style.left = `${event.clientX + 10}px`; this.cursorEl.style.top = `${event.clientY + 10}px`;
      this.tooltip.style.left = `${Math.min(event.clientX + 16, innerWidth - 210)}px`;
      this.tooltip.style.top = `${Math.min(event.clientY + 18, innerHeight - 70)}px`;
      const slot = event.target.closest('[data-item-name]');
      this.tooltip.textContent = slot?.dataset.itemName || ''; this.tooltip.classList.toggle('visible', !!slot?.dataset.itemName && !this.cursor);
    });
    this.root.addEventListener('pointerleave', () => this.tooltip.classList.remove('visible'));
  }
  get isOpen() { return !!this.menu; }
  icon(id) {
    if (this.iconCache.has(id)) return this.iconCache.get(id);
    let url = this.getIcon(id);
    if (!url) {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 32;
      const ctx = canvas.getContext('2d'), item = ITEMS[id];
      if (!item) return '';
      const pixel = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };
      if (item.tool) {
        pixel(7, 23, 5, 5, '#3d2b20'); pixel(10, 18, 5, 7, '#9b6a39'); pixel(14, 13, 5, 7, '#bb8b49'); pixel(18, 9, 5, 7, '#6e4a2b');
        if (item.tool === 'pickaxe') { pixel(8, 5, 18, 5, '#25292a'); pixel(9, 4, 16, 4, item.color); pixel(23, 8, 5, 9, item.color); }
        else if (item.tool === 'axe') { pixel(10, 3, 13, 13, '#32322c'); pixel(11, 3, 10, 10, item.color); pixel(9, 6, 5, 9, item.color); }
        else if (item.tool === 'shovel') { pixel(18, 3, 10, 10, '#333'); pixel(18, 3, 8, 8, item.color); }
        else { pixel(15, 12, 7, 7, '#796246'); pixel(19, 2, 7, 14, item.color); pixel(23, 1, 6, 9, item.color); pixel(12, 13, 13, 4, item.color); }
      } else if (id === 100) { for (let n = 0; n < 7; n++) pixel(7 + n * 2, 23 - n * 3, 4, 6, n % 2 ? '#b98c51' : '#7d5734'); }
      else if (id === 110) { pixel(8, 9, 16, 16, '#b32427'); pixel(5, 12, 22, 10, '#d83a32'); pixel(9, 8, 6, 5, '#f7735d'); pixel(15, 4, 3, 6, '#64472e'); pixel(18, 4, 6, 3, '#6b9840'); }
      else if (id >= 100) { pixel(7, 10, 19, 13, '#303033'); pixel(4, 13, 20, 11, item.color); pixel(8, 8, 16, 13, item.color); pixel(10, 9, 9, 4, '#ffffff55'); pixel(7, 22, 17, 3, '#00000044'); }
      else {
        pixel(4, 7, 23, 22, item.color); pixel(4, 7, 23, 5, '#ffffff44'); pixel(21, 12, 6, 17, '#00000033');
        for (let n = 0; n < 15; n++) pixel(6 + (n * 13) % 18, 13 + (n * 7) % 14, 3, 2, n % 2 ? '#ffffff22' : '#00000022');
      }
      url = canvas.toDataURL();
    }
    this.iconCache.set(id, url); return url;
  }
  itemHTML(stack, number = '') {
    if (!stack) return number !== '' ? `<span class="slot-key">${number}</span>` : '';
    const item = ITEMS[stack.id]; if (!item) return '';
    const durability = item.durability && (stack.durability ?? item.durability) < item.durability ? `<span class="durability"><i style="width:${Math.max(0, (stack.durability ?? item.durability) / item.durability * 100)}%;background:hsl(${Math.max(0, stack.durability / item.durability * 115)},80%,45%)"></i></span>` : '';
    return `<img src="${this.icon(stack.id)}" alt="" draggable="false">${stack.count > 1 ? `<span class="count">${stack.count}</span>` : ''}${durability}${number !== '' ? `<span class="slot-key">${number}</span>` : ''}`;
  }
  button(text, id, cls = '') { return `<button class="mc-button ${cls}" data-action="${id}">${text}</button>`; }
  setMenu(name, content, cls = '') {
    this.activeSlotTouch = null;
    this.menu = name; this.layer.className = `menu-layer ${cls}`; this.layer.innerHTML = content;
    this.layer.hidden = false; this.root.classList.add('has-menu');
    this.tooltip.classList.remove('visible');
  }
  bind(actions) { this.layer.querySelectorAll('[data-action]').forEach(button => { button.addEventListener('click', event => actions[button.dataset.action]?.(event)); }); }
  showTitle(worlds = this.worlds) {
    this.worlds = worlds; this.hud.hidden = true;
    this.setMenu('title', `<div class="title-shade"></div><main class="title-screen"><div class="game-logo" aria-label="MC 我的方块世界"><span class="logo-big">MC</span><span class="logo-sub">我的方块世界</span><span class="splash">方块之间，无限可能！</span></div><div class="title-buttons">${this.button('单人游戏', 'worlds')}${this.button('操作指南', 'help')}<div class="button-row">${this.button('选项…', 'settings')}${this.button('全屏', 'fullscreen')}</div></div><p class="title-tagline">探索 · 生存 · 创造</p></main><footer class="title-footer"><span>MC · 中文体素沙盒 1.0</span><span>独立实现 · 非官方 Minecraft 产品</span></footer>`);
    this.bind({ worlds: () => this.showWorlds(), help: () => this.showHelp('title'), settings: () => this.showSettings('title'), fullscreen: () => this.fullscreen() });
  }
  showWorlds(worlds = this.worlds) {
    this.worlds = worlds;
    this.setMenu('worlds', `<main class="screen-panel world-screen"><h1>选择世界</h1><p class="panel-subtitle">每一个世界，都从第一块方块开始。</p><div class="world-list">${worlds.length ? worlds.map(w => `<article class="world-card"><div class="world-thumbnail"><i></i></div><div class="world-details"><h2>${escape(w.name || '新的世界')}</h2><p>${w.mode === 'creative' ? '创造模式' : '生存模式'} · 种子 ${escape(w.seed ?? '随机')}</p><small>${w.updated || w.updatedAt ? new Date(w.updated || w.updatedAt).toLocaleString('zh-CN') : '已保存的世界'}</small></div><button class="mc-button world-play" data-load="${escape(w.id)}">进入世界</button><button class="icon-button" title="删除世界" data-delete="${escape(w.id)}">×</button></article>`).join('') : '<div class="empty-worlds"><span class="grass-cube"></span><h2>一片尚未探索的天地</h2><p>创建你的第一个世界，开始这场冒险。</p></div>'}</div><div class="world-actions">${this.button('创建新的世界', 'create', 'primary')}${this.button('导入世界', 'import')}${this.button('返回', 'back')}</div><input type="file" id="save-import" accept=".json,application/json" hidden></main>`, 'dirt-backdrop');
    this.bind({ create: () => this.showCreate(), back: () => this.showTitle(), import: () => this.layer.querySelector('#save-import').click() });
    this.layer.querySelector('#save-import').onchange = event => { const file = event.target.files[0]; if (file) this.callbacks.onSaveImport?.(file); };
    this.layer.querySelectorAll('[data-load]').forEach(b => b.onclick = () => this.callbacks.onLoad?.(b.dataset.load));
    this.layer.querySelectorAll('[data-delete]').forEach(b => b.onclick = () => this.showDelete(b.dataset.delete));
  }
  showDelete(id) {
    const world = this.worlds.find(w => w.id === id);
    this.setMenu('delete', `<main class="screen-panel compact"><h1>删除这个世界？</h1><p>「${escape(world?.name || '世界')}」将从此浏览器中移除。</p><p class="muted">此操作无法撤销。可以先进入世界，在暂停菜单中导出备份。</p><div class="button-row">${this.button('删除世界', 'delete', 'danger')}${this.button('取消', 'cancel')}</div></main>`, 'dirt-backdrop');
    this.bind({ delete: () => this.callbacks.onDelete?.(id), cancel: () => this.showWorlds() });
  }
  showCreate() {
    this.setMenu('create', `<main class="screen-panel create-screen"><h1>创建新的世界</h1><label class="field-label" for="world-name">世界名称</label><input id="world-name" class="mc-input" maxlength="48" value="新的世界" autocomplete="off"><label class="field-label" for="world-seed">世界种子 <span>留空以随机生成</span></label><input id="world-seed" class="mc-input" maxlength="80" placeholder="输入数字或文字" autocomplete="off"><div class="mode-switch"><button type="button" class="mode-card selected" data-mode="survival"><span class="mode-icon">♥</span><strong>生存模式</strong><small>采集资源，合成工具。<br>留意生命与饥饿，探索未知世界。</small></button><button type="button" class="mode-card" data-mode="creative"><span class="mode-icon">▦</span><strong>创造模式</strong><small>无限方块，自由飞行。<br>让想象力成为这个世界的边界。</small></button></div><p class="muted seed-note">程序生成的森林、平原、沙漠与雪地，等待你的足迹。</p><div class="button-row">${this.button('创建世界', 'create', 'primary')}${this.button('取消', 'cancel')}</div></main>`, 'dirt-backdrop');
    let mode = 'survival';
    this.layer.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { mode = b.dataset.mode; this.layer.querySelectorAll('[data-mode]').forEach(el => el.classList.toggle('selected', el === b)); });
    this.bind({ cancel: () => this.showWorlds(), create: () => {
      const name = this.layer.querySelector('#world-name').value.trim() || '新的世界';
      const seed = this.layer.querySelector('#world-seed').value.trim() || `${Math.floor(Math.random() * 2147483647)}`;
      this.callbacks.onCreate?.({ name, seed, mode });
    } });
  }
  showLoading(text = '正在生成世界…') { this.setMenu('loading', `<main class="loading-screen"><div class="grass-cube"></div><h1>${escape(text)}</h1><div class="loading-bar"><i></i></div><p>正在为你准备一片新的天地</p></main>`, 'dirt-backdrop'); }
  showPause() {
    this.setMenu('pause', `<main class="pause-panel"><h1>游戏菜单</h1>${this.button('回到游戏', 'resume', 'primary')}<div class="button-row">${this.button('选项…', 'settings')}${this.button('操作指南', 'help')}</div><div class="button-row">${this.button('导出世界', 'export')}${this.button(this.lastState.mode === 'creative' ? '切换至生存模式' : '切换至创造模式', 'mode')}</div>${this.button('保存并退出到标题画面', 'quit')}<p class="pause-note">世界会自动保存在此浏览器中</p></main>`, 'paused');
    this.bind({ resume: () => this.callbacks.onResume?.(), settings: () => this.showSettings('pause'), help: () => this.showHelp('pause'), export: () => this.callbacks.onSaveExport?.(), mode: () => { this.callbacks.onModeChange?.(this.lastState.mode === 'creative' ? 'survival' : 'creative'); this.showPause(); }, quit: () => this.callbacks.onQuit?.() });
  }
  showSettings(back = this.menu === 'title' ? 'title' : 'pause') {
    const s = this.settings;
    this.setMenu('settings', `<main class="screen-panel settings-screen"><h1>选项</h1><div class="settings-grid"><label>音量 <output id="volume-val">${Math.round(s.volume * 100)}%</output><input type="range" data-setting="volume" min="0" max="1" step="0.05" value="${s.volume}"></label><label>鼠标灵敏度 <output id="sensitivity-val">${Math.round(s.sensitivity * 100)}%</output><input type="range" data-setting="sensitivity" min="0.2" max="3" step="0.05" value="${s.sensitivity}"></label><label>视野 <output id="fov-val">${s.fov}°</output><input type="range" data-setting="fov" min="50" max="110" step="1" value="${s.fov}"></label><label>渲染距离 <output id="renderDistance-val">${s.renderDistance} 区块</output><input type="range" data-setting="renderDistance" min="2" max="7" step="1" value="${s.renderDistance}"></label><label class="toggle-setting"><span>视角摇晃</span><input type="checkbox" data-setting="bob" ${s.bob ? 'checked' : ''}></label><label class="toggle-setting"><span>调试信息 (F3)</span><input type="checkbox" data-setting="debug" ${s.debug ? 'checked' : ''}></label></div><p class="muted">较大的渲染距离需要更高的显卡与处理器性能。</p><div class="button-row">${this.button('恢复默认', 'reset')}${this.button('完成', 'done', 'primary')}</div></main>`, back === 'title' ? 'dirt-backdrop' : 'paused');
    this.layer.querySelectorAll('[data-setting]').forEach(el => el.oninput = () => {
      const key = el.dataset.setting; this.settings[key] = el.type === 'checkbox' ? el.checked : Number(el.value);
      const output = this.layer.querySelector(`#${key}-val`);
      if (output) output.textContent = key === 'volume' ? `${Math.round(el.value * 100)}%` : key === 'sensitivity' ? `${Math.round(el.value * 100)}%` : key === 'fov' ? `${el.value}°` : `${el.value} 区块`;
      this.callbacks.onSettings?.({ ...this.settings });
    });
    this.bind({ done: () => back === 'title' ? this.showTitle() : this.showPause(), reset: () => { this.settings = { ...DEFAULT_SETTINGS }; this.callbacks.onSettings?.({ ...this.settings }); this.showSettings(back); } });
  }
  showHelp(back = 'title') {
    const rows = [['W A S D', '移动'], ['鼠标', '转动视角'], ['左键拖动', '内嵌预览转动视角'], ['空格', '跳跃 / 水中上浮'], ['Shift', '潜行 / 飞行下降'], ['Ctrl', '疾跑'], ['鼠标左键（按住）', '挖掘方块 / 攻击生物'], ['鼠标右键', '放置 / 使用 / 打开工作台'], ['E', '背包、合成与创造物品栏'], ['1 – 9 / 滚轮', '切换快捷栏'], ['Q', '丢出一个物品'], ['F', '食用手持食物'], ['空格 × 2', '创造模式飞行开关'], ['F3', '坐标与性能信息'], ['F4', '切换游戏模式'], ['T / /', '聊天与指令'], ['Esc', '暂停 / 返回']];
    this.setMenu('help', `<main class="screen-panel help-screen"><h1>操作指南</h1><div class="help-columns"><div><h2>键盘与鼠标</h2><dl>${rows.map(([key, label]) => `<div><dt><kbd>${key}</kbd></dt><dd>${label}</dd></div>`).join('')}</dl></div><div class="help-tips"><h2>第一天的冒险</h2><ol><li>按住左键收集树木。</li><li>按 E，把原木合成为木板。</li><li>用四块木板合成工作台。</li><li>放置工作台，右键打开 3 × 3 合成。</li><li>制作木镐，开采石头与煤炭。</li><li>建造庇护所，制作火把，迎接夜晚。</li></ol><h2>背包操作</h2><p>左键拿取或放置整组；右键拿取一半或放置一个。Shift + 点击快速转移物品。点击配方可自动放入材料。</p><p>熔炉上格放入矿石或食物，下格放入煤炭或木材，等待烧炼。创造模式背包可以直接获取所有物品。</p><h2>内嵌预览兼容模式</h2><p>如果预览窗口不允许锁定鼠标，游戏会自动启用兼容模式，仍可正常移动、挖掘和建造。按住左键直接拖动视角。短按攻击，长按不动挖掘，右键放置。按 Esc 打开菜单，再点击“回到游戏”继续。</p><h2>触屏操作</h2><p>推动左下摇杆移动，在场景空白处滑动视角。右侧按钮用于跳跃、潜行、挖掘和放置。点按背包格拿取或放下整组，长按拆分或放入一个。</p></div></div>${this.button('返回', 'back')}</main>`, back === 'title' ? 'dirt-backdrop' : 'paused');
    this.bind({ back: () => back === 'title' ? this.showTitle() : this.showPause() });
  }
  showDeath() { this.setMenu('death', `<main class="death-panel"><h1>你失败了！</h1><p>一次新的冒险，正等待着你。</p>${this.button('重生', 'respawn', 'primary')}${this.button('标题画面', 'quit')}</main>`, 'death-backdrop'); this.bind({ respawn: () => this.callbacks.onRespawn?.(), quit: () => this.callbacks.onQuit?.() }); }
  hideMenus() { this.menu = null; this.layer.innerHTML = ''; this.layer.hidden = true; this.root.classList.remove('has-menu'); this.hud.hidden = false; this.tooltip.classList.remove('visible'); }
  async fullscreen() { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { this.toast('当前浏览器不支持全屏，请使用浏览器的全屏按钮。'); } }
  toast(text) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = text; this.toasts.append(el); setTimeout(() => el.remove(), 4200); }
  updateHUD(state = {}) {
    this.lastState = { ...this.lastState, ...state };
    const s = this.lastState, inv = s.inventory;
    if (!inv) return;
    const key = JSON.stringify([inv.slots.slice(0, 9), inv.selected, s.mode, Math.ceil(s.health ?? 20), Math.ceil(s.hunger ?? 20), Math.ceil(s.oxygen ?? 20), s.xp, s.target?.id ?? s.target, Math.round((s.mining || 0) * 20), s.flying, s.debug, s.debug ? [s.position?.x?.toFixed(1), s.position?.y?.toFixed(1), s.position?.z?.toFixed(1), Math.round(s.fps), s.biome] : null]);
    if (key === this.hudKey) return; this.hudKey = key;
    const hearts = Array.from({ length: 10 }, (_, i) => `<i class="heart ${(s.health ?? 20) > i * 2 ? (s.health ?? 20) < i * 2 + 2 ? 'half' : 'full' : ''}">♥</i>`).join('');
    const food = Array.from({ length: 10 }, (_, i) => `<i class="food ${(s.hunger ?? 20) > i * 2 ? 'full' : ''}">◆</i>`).join('');
    const oxygen = (s.oxygen ?? 20) < 20 ? `<div class="oxygen-meter" aria-label="剩余氧气 ${Math.ceil(s.oxygen)}">${Array.from({ length: 10 }, (_, i) => `<i class="${s.oxygen > i * 2 ? 'full' : ''}">○</i>`).join('')}</div>` : '';
    const item = inv.selectedItem && ITEMS[inv.selectedItem.id];
    const targetId = typeof s.target === 'number' ? s.target : s.target?.id;
    const targetName = typeof s.target === 'string' ? s.target : ITEMS[targetId]?.name;
    const pos = s.position || {};
    this.hud.innerHTML = `<div class="crosshair"><i></i><b></b></div>${targetName ? `<div class="target-label">${escape(targetName)}</div>` : ''}<div class="mining-progress ${(s.mining || 0) > 0 ? 'active' : ''}"><i style="width:${Math.max(0, Math.min(100, (s.mining || 0) * 100))}%"></i></div><div class="game-hint">${s.mode === 'creative' ? `创造模式${s.flying ? ' · 飞行中' : ''}` : '生存模式'}<span>${this.touch ? '摇杆移动　滑动视角' : 'E 背包　Esc 菜单'}</span></div>${s.debug ? `<div class="debug-info">MC · 方块世界<br>${Math.round(s.fps || 0)} FPS<br>XYZ: ${Number(pos.x || 0).toFixed(2)} / ${Number(pos.y || 0).toFixed(2)} / ${Number(pos.z || 0).toFixed(2)}<br>生物群系：${escape(s.biome || '平原')}<br>${escape(s.time || '')}</div>` : ''}<div class="hotbar-area"><div class="held-name">${item ? escape(item.name) : ''}</div>${s.mode !== 'creative' ? `${oxygen}<div class="vitals"><div class="hearts">${hearts}</div><div class="hunger">${food}</div></div><div class="xp-track"><i style="width:${((s.xp || 0) % 10) * 10}%"></i><span>${Math.floor((s.xp || 0) / 10) || ''}</span></div>` : ''}<div class="hotbar">${inv.slots.slice(0, 9).map((stack, i) => `<button class="slot hotbar-slot ${inv.selected === i ? 'selected' : ''}" data-hotbar="${i}" aria-label="快捷栏 ${i + 1}${stack ? ` ${escape(ITEMS[stack.id]?.name)}` : ''}">${this.itemHTML(stack, i + 1)}</button>`).join('')}</div></div>`;
    this.hud.querySelectorAll('[data-hotbar]').forEach(b => b.onclick = () => { inv.select(Number(b.dataset.hotbar)); this.callbacks.onSelectSlot?.(inv.selected); this.updateHUD(); });
  }
  showInventory(inventory, kind = 'inventory', extra = {}) {
    this.inventory = inventory; this.inventoryKind = kind; this.extra = extra;
    this.craftSize = kind === 'crafting' ? 3 : 2;
    this.craftGrid = Array(this.craftSize ** 2).fill(null);
    this.cursor = null; this.recipeOpen = kind === 'crafting'; this.filter = ''; this.category = '全部';
    this.renderInventory();
  }
  slotHTML(stack, source, index, cls = '') { return `<button class="slot ${cls}" data-source="${source}" data-index="${index}" data-item-name="${escape(ITEMS[stack?.id]?.name || '')}" aria-label="${escape(ITEMS[stack?.id]?.name || '空格子')}${stack ? ` ${stack.count}` : ''}">${this.itemHTML(stack)}</button>`; }
  renderInventory() {
    if (!this.inventory || this.activeSlotTouch) return;
    const scrollTop = this.layer.querySelector('.creative-catalog')?.scrollTop || 0;
    const inv = this.inventory, kind = this.inventoryKind;
    const creative = inv.mode === 'creative' && kind === 'inventory';
    const title = creative ? '创造模式物品栏' : { inventory: '物品栏', crafting: '工作台', furnace: '熔炉', chest: '箱子' }[kind] || '物品栏';
    let top = '';
    if (creative) {
      const cats = ['全部', '自然方块', '建筑方块', '功能方块', '工具', '材料'];
      const items = CREATIVE_ITEMS.filter(i => (this.category === '全部' || i.category === this.category) && (!this.filter || i.name.includes(this.filter) || String(i.id).includes(this.filter)));
      top = `<div class="creative-tools"><input class="mc-input" id="creative-search" placeholder="搜索物品…" value="${escape(this.filter)}" aria-label="搜索物品"><div class="creative-tabs">${cats.map(c => `<button data-category="${c}" class="${this.category === c ? 'active' : ''}">${c}</button>`).join('')}</div></div><div class="creative-catalog slot-grid">${items.map(item => this.slotHTML({ id: item.id, count: item.stack }, 'creative', item.id)).join('')}${!items.length ? '<p class="empty-search">没有找到这个物品</p>' : ''}</div>`;
    } else if (kind === 'furnace') {
      const f = this.extra.furnace;
      top = f ? `<div class="furnace-area"><div class="furnace-input"><span>原料</span>${this.slotHTML(f.slots[0], 'furnace', 0)}<div class="furnace-fire ${f.burnRemaining > 0 ? 'burning' : ''}" title="燃烧时间 ${Math.ceil(f.burnRemaining)} 秒">♨</div>${this.slotHTML(f.slots[1], 'furnace', 1)}<span>燃料</span></div><div class="smelt-arrow"><span>➜</span><i style="width:${f.progress * 100}%">➜</i></div><div class="furnace-output">${this.slotHTML(f.slots[2], 'furnace', 2, 'result-slot')}<span>产物</span></div></div>` : '';
    } else if (kind === 'chest') { top = `<div class="slot-grid chest-grid">${this.extra.chest?.slots.map((s, i) => this.slotHTML(s, 'chest', i)).join('') || ''}</div>`; }
    else {
      const result = matchRecipe(this.craftGrid, this.craftSize)?.recipe.result;
      top = `<div class="crafting-area">${kind === 'inventory' ? '<div class="player-preview"><div class="pixel-player"><i class="head"></i><i class="body"></i><i class="arm left"></i><i class="arm right"></i><i class="leg left"></i><i class="leg right"></i></div></div>' : ''}<div class="craft-input"><span class="inventory-label">合成</span><div class="craft-grid" style="--craft-size:${this.craftSize}">${this.craftGrid.map((s, i) => this.slotHTML(s, 'craft', i)).join('')}</div></div><span class="craft-arrow">➜</span>${this.slotHTML(result, 'result', 0, 'result-slot')}<button class="recipe-toggle ${this.recipeOpen ? 'active' : ''}" data-action="recipes" title="配方书">▤</button></div>`;
    }
    const recipes = this.recipeOpen && !creative && !['furnace', 'chest'].includes(kind) ? `<aside class="recipe-book"><h3>配方书</h3><p>点击配方自动放入材料</p><div class="recipe-list">${RECIPES.filter(r => r.size <= this.craftSize).map(r => `<button class="recipe-entry" data-recipe="${r.id}"><img src="${this.icon(r.result.id)}" alt=""><span>${r.name}</span><small>×${r.result.count}</small></button>`).join('')}</div></aside>` : '';
    this.setMenu(kind, `<div class="inventory-layout">${recipes}<main class="inventory-panel ${creative ? 'creative-panel' : ''}"><div class="inventory-heading"><h2>${title}</h2><button class="close-button" data-action="close" aria-label="关闭物品栏">×</button></div>${top}<div class="inventory-label backpack-label">物品栏</div><div class="slot-grid backpack-grid">${inv.slots.slice(9).map((s, i) => this.slotHTML(s, 'inventory', i + 9)).join('')}</div><div class="slot-grid inventory-hotbar">${inv.slots.slice(0, 9).map((s, i) => this.slotHTML(s, 'inventory', i, inv.selected === i ? 'chosen' : '')).join('')}</div><p class="inventory-tip">${this.touch ? '点按拿取或放置整组　长按拆分或放一个' : '左键：拿取 / 放置　右键：拆分 / 单个放置　Shift：快速转移'}</p></main></div>`, 'inventory-backdrop');
    this.bind({ close: () => this.callbacks.onInventoryClose?.(), recipes: () => { this.recipeOpen = !this.recipeOpen; this.renderInventory(); } });
    const catalog = this.layer.querySelector('.creative-catalog');
    if (catalog) catalog.scrollTop = scrollTop;
    this.layer.querySelectorAll('[data-source]').forEach(el => {
      const useSlot = (right, shift) => this.slotClick(el.dataset.source, Number(el.dataset.index), right, shift);
      el.onpointerdown = event => {
        if (event.pointerType === 'touch') {
          this.activeSlotTouch = { id: event.pointerId, x: event.clientX, y: event.clientY, time: event.timeStamp };
          return;
        }
        event.preventDefault();
        if (event.button === 0 || event.button === 2) useSlot(event.button === 2, event.shiftKey);
      };
      el.onpointerup = event => {
        const start = this.activeSlotTouch;
        if (start?.id !== event.pointerId) return;
        this.activeSlotTouch = null;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return;
        this.cursorEl.style.left = `${Math.min(event.clientX + 12, innerWidth - 40)}px`;
        this.cursorEl.style.top = `${Math.min(event.clientY + 12, innerHeight - 40)}px`;
        useSlot(event.timeStamp - start.time >= 420, false);
      };
      el.onpointercancel = event => { if (this.activeSlotTouch?.id === event.pointerId) this.activeSlotTouch = null; };
    });
    this.layer.querySelectorAll('[data-recipe]').forEach(el => el.onclick = () => this.fillRecipe(el.dataset.recipe));
    this.layer.querySelectorAll('[data-category]').forEach(el => el.onclick = () => { this.category = el.dataset.category; this.renderInventory(); });
    const search = this.layer.querySelector('#creative-search');
    if (search) {
      search.oninput = () => { const cursor = search.selectionStart; this.filter = search.value; this.renderInventory(); const next = this.layer.querySelector('#creative-search'); next.focus(); next.setSelectionRange(cursor, cursor); };
      search.onkeydown = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); search.blur(); this.callbacks.onInventoryClose?.(); } };
    }
    this.updateCursor(); this.updateHUD();
  }
  updateCursor() { this.cursorEl.innerHTML = this.cursor ? this.itemHTML(this.cursor) : ''; this.cursorEl.classList.toggle('visible', !!this.cursor); }
  arrayFor(source) { return source === 'inventory' ? this.inventory.slots : source === 'craft' ? this.craftGrid : source === 'chest' ? this.extra.chest?.slots : source === 'furnace' ? this.extra.furnace?.slots : null; }
  slotClick(source, index, right = false, shift = false) {
    const inv = this.inventory;
    if (source === 'creative') {
      const item = ITEMS[index];
      if (shift) { inv.add(index, item.stack); }
      else this.cursor = { id: index, count: right ? 1 : item.stack, ...(item.durability ? { durability: item.durability } : {}) };
      this.renderInventory(); return;
    }
    if (source === 'result') {
      const match = matchRecipe(this.craftGrid, this.craftSize); if (!match) return;
      const result = match.recipe.result, item = ITEMS[result.id];
      if (shift) {
        let made = 0;
        while (matchRecipe(this.craftGrid, this.craftSize)?.recipe.id === match.recipe.id && inv.canAdd(result.id, result.count)) {
          const stack = craft(this.craftGrid, this.craftSize); inv.add(stack.id, stack.count, stack.durability); if (++made > 64) break;
        }
        if (!made) this.toast('物品栏空间不足。');
      } else if (!this.cursor || this.cursor.id === result.id && !item.durability && this.cursor.count + result.count <= item.stack) {
        const stack = craft(this.craftGrid, this.craftSize);
        if (this.cursor) this.cursor.count += stack.count; else this.cursor = stack;
      }
      this.renderInventory(); return;
    }
    const slots = this.arrayFor(source); if (!slots) return;
    const stack = slots[index];
    if (shift && stack) {
      let destinations;
      if (source !== 'inventory') destinations = inv.slots;
      else if (this.inventoryKind === 'chest') destinations = this.extra.chest.slots;
      else if (this.inventoryKind === 'furnace') {
        const target = FUELS[stack.id] ? 1 : 0;
        const temp = [this.extra.furnace.slots[target]]; const left = addToSlots(temp, stack.id, stack.count, stack.durability);
        this.extra.furnace.slots[target] = temp[0]; slots[index] = left ? { ...stack, count: left } : null; this.renderInventory(); return;
      } else {
        const start = index < 9 ? 9 : 0, end = index < 9 ? 36 : 9;
        const temp = inv.slots.slice(start, end); const left = addToSlots(temp, stack.id, stack.count, stack.durability);
        temp.forEach((s, i) => inv.slots[start + i] = s); slots[index] = left ? { ...stack, count: left } : null; this.renderInventory(); return;
      }
      const left = addToSlots(destinations, stack.id, stack.count, stack.durability); slots[index] = left ? { ...stack, count: left } : null;
    } else if (!this.cursor) {
      if (!stack) return;
      const count = right ? Math.ceil(stack.count / 2) : stack.count;
      this.cursor = { ...stack, count }; stack.count -= count; if (!stack.count) slots[index] = null;
    } else {
      if (source === 'furnace' && index === 2) {
        if (sameStack(this.cursor, stack)) {
          const count = Math.min(right ? 1 : stack.count, ITEMS[stack.id].stack - this.cursor.count);
          this.cursor.count += count; stack.count -= count;
          if (!stack.count) slots[index] = null;
          this.renderInventory();
        }
        return;
      }
      if (source === 'furnace' && index === 1 && !FUELS[this.cursor.id]) return;
      if (!stack) {
        const count = right ? 1 : this.cursor.count;
        slots[index] = { ...this.cursor, count }; this.cursor.count -= count;
      } else if (sameStack(stack, this.cursor)) {
        const count = Math.min(right ? 1 : this.cursor.count, ITEMS[stack.id].stack - stack.count);
        stack.count += count; this.cursor.count -= count;
      } else if (!right) { slots[index] = this.cursor; this.cursor = stack; }
      if (this.cursor?.count <= 0) this.cursor = null;
    }
    this.renderInventory();
  }
  fillRecipe(id) {
    const recipe = RECIPES.find(r => r.id === id); if (!recipe || recipe.size > this.craftSize) return;
    const slots = this.inventory.slots.map(clone);
    for (const stack of this.craftGrid) if (stack && addToSlots(slots, stack.id, stack.count, stack.durability)) { this.toast('请先腾出背包空间。'); return; }
    const grid = Array(this.craftSize ** 2).fill(null);
    for (let y = 0; y < recipe.pattern.length; y++) for (let x = 0; x < recipe.pattern[y].length; x++) {
      const char = recipe.pattern[y][x]; if (char === ' ') continue;
      const allowed = recipe.ingredients[char];
      const index = slots.findIndex(s => s && (Array.isArray(allowed) ? allowed.includes(s.id) : s.id === allowed));
      if (index < 0) { this.toast(`材料不足，无法合成${recipe.name}。`); return; }
      grid[y * this.craftSize + x] = { id: slots[index].id, count: 1 };
      if (--slots[index].count <= 0) slots[index] = null;
    }
    this.inventory.slots = slots; this.craftGrid = grid; this.renderInventory();
  }
  closeInventory() {
    const overflow = [];
    if (this.inventory) for (const stack of [...this.craftGrid, this.cursor]) if (stack) {
      const left = this.inventory.add(stack.id, stack.count, stack.durability);
      if (left) overflow.push({ ...stack, count: left });
    }
    this.craftGrid = []; this.cursor = null; this.updateCursor(); this.inventory = null;
    this.hideMenus(); return overflow;
  }
}
