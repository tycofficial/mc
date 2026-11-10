import './touch.css';

const ICONS = {
  jump: '<path d="M5 15 12 7l7 8M12 7v14"/>',
  sneak: '<path d="m5 9 7 8 7-8M12 3v14"/>',
  mine: '<path d="m5 21 12-12M7 4c5-2 11 0 14 5l-3 2c-3-4-7-5-11-4ZM14 5l5 5"/>',
  place: '<path d="m12 3 9 5v10l-9 5-9-5V8Zm0 10v10M3 8l9 5 9-5M12 3v10"/>',
  inventory: '<path d="M3 4h7v7H3Zm11 0h7v7h-7ZM3 15h7v7H3Zm11 0h7v7h-7Z"/>',
  pause: '<path d="M7 4v17M17 4v17"/>',
};
const LABELS = { jump: '跳跃', sneak: '潜行', mine: '挖掘', place: '放置', inventory: '背包', pause: '菜单' };

/** Independent pointer ownership keeps a joystick, camera drag and action held together. */
export class TouchControls {
  static isSupported() {
    const coarse = !!globalThis.matchMedia?.('(pointer: coarse)').matches;
    const fine = !!globalThis.matchMedia?.('(pointer: fine)').matches;
    return coarse || ((globalThis.navigator?.maxTouchPoints || 0) > 0 && !fine);
  }

  constructor(canvas, callbacks = {}) {
    this.canvas = canvas; this.callbacks = callbacks;
    this.active = false; this.flying = false;
    this.stickPointer = null; this.lookPointer = null;
    this.buttonsHeld = new Map(); this.actionPointers = new Map(); this.keysHeld = new Set();
    this.removers = []; this.oldTouchAction = canvas.style.touchAction;
    this.root = document.createElement('div');
    this.root.id = 'mobile-touch-controls'; this.root.hidden = true;
    this.root.setAttribute('aria-label', '移动设备游戏控制');
    const button = action => `<button type="button" class="touch-action touch-${action}" data-touch="${action}" aria-label="${LABELS[action]}" aria-pressed="false"><svg viewBox="0 0 26 26" aria-hidden="true">${ICONS[action]}</svg><span>${LABELS[action]}</span></button>`;
    this.root.innerHTML = `<div class="touch-utility">${button('inventory')}${button('pause')}</div><div class="touch-camera-hint">拖动空白区域转动视角</div><div class="touch-stick" data-touch="joystick" role="slider" aria-label="移动摇杆" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" tabindex="-1"><span class="touch-stick-ring"></span><i class="touch-stick-mark forward"></i><i class="touch-stick-mark back"></i><i class="touch-stick-mark left"></i><i class="touch-stick-mark right"></i><span class="touch-stick-knob"></span><span class="touch-sprint-indicator">疾跑</span></div><div class="touch-actions">${button('mine')}${button('place')}${button('sneak')}${button('jump')}</div>`;
    document.body.append(this.root);
    this.stick = this.root.querySelector('[data-touch="joystick"]');
    this.knob = this.root.querySelector('.touch-stick-knob');
    this.hint = this.root.querySelector('.touch-camera-hint');
    this.listen(this.root, 'contextmenu', event => event.preventDefault());
    this.listen(this.stick, 'pointerdown', event => this.startStick(event));
    this.listen(this.stick, 'pointermove', event => this.moveStick(event));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.listen(this.stick, type, event => this.endStick(event.pointerId));
    for (const element of this.root.querySelectorAll('button[data-touch]')) {
      this.listen(element, 'pointerdown', event => this.startButton(event, element));
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.listen(element, type, event => this.endButton(event.pointerId));
      this.listen(element, 'click', event => event.preventDefault());
    }
    this.listen(canvas, 'pointerdown', event => this.startLook(event));
    this.listen(canvas, 'pointermove', event => this.moveLook(event));
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) this.listen(canvas, type, event => this.endLook(event.pointerId));
    this.listen(window, 'blur', () => this.reset());
    this.listen(window, 'resize', () => this.reset());
    this.listen(document, 'visibilitychange', () => { if (document.hidden) this.reset(); });
  }

  listen(element, type, handler) {
    const options = { passive: false };
    element.addEventListener(type, handler, options);
    this.removers.push(() => element.removeEventListener(type, handler, options));
  }

  capture(element, pointerId) {
    try { element.setPointerCapture(pointerId); } catch { /* Synthetic and already-ended pointers have no capture. */ }
  }
  release(element, pointerId) {
    if (pointerId == null) return;
    try { if (element.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId); } catch { /* Capture may already have ended. */ }
  }
  consume(event) { event.preventDefault(); event.stopPropagation(); }
  accepts(event) { return this.active && (event.pointerType !== 'mouse' || event.button === 0); }

  setKey(code, pressed) {
    const wasPressed = this.keysHeld.has(code);
    if (wasPressed === pressed) return;
    if (pressed) this.keysHeld.add(code); else this.keysHeld.delete(code);
    this.callbacks.key?.(code, pressed);
  }

  startStick(event) {
    if (!this.accepts(event) || this.stickPointer != null) return;
    this.consume(event); this.stickPointer = event.pointerId;
    this.capture(this.stick, event.pointerId); this.stick.classList.add('held');
    this.moveStick(event);
  }
  moveStick(event) {
    if (!this.active || this.stickPointer !== event.pointerId) return;
    this.consume(event);
    const rect = this.stick.getBoundingClientRect();
    const radius = Math.max(1, rect.width * .32);
    const dx = event.clientX - (rect.left + rect.width / 2), dy = event.clientY - (rect.top + rect.height / 2);
    const distance = Math.hypot(dx, dy), magnitude = Math.min(1, distance / radius);
    const scale = distance > radius ? radius / distance : 1;
    this.knob.style.transform = `translate(${dx * scale}px, ${dy * scale}px)`;
    const deadzone = .13, strength = magnitude <= deadzone ? 0 : (magnitude - deadzone) / (1 - deadzone);
    const x = distance ? dx / distance * strength : 0;
    const y = distance ? -dy / distance * strength : 0;
    this.callbacks.move?.(x, y);
    const sprint = magnitude >= .94 && y > .76 && !this.flying;
    this.setKey('ControlLeft', sprint); this.stick.classList.toggle('sprinting', sprint);
    this.stick.setAttribute('aria-valuenow', String(Math.round(strength * 100)));
  }
  endStick(pointerId) {
    if (this.stickPointer !== pointerId || pointerId == null) return;
    this.stickPointer = null; this.release(this.stick, pointerId);
    this.knob.style.transform = 'translate(0px, 0px)';
    this.stick.classList.remove('held', 'sprinting'); this.stick.setAttribute('aria-valuenow', '0');
    this.callbacks.move?.(0, 0); this.setKey('ControlLeft', false);
  }

  startButton(event, element) {
    if (!this.accepts(event) || this.buttonsHeld.has(event.pointerId)) return;
    this.consume(event); this.capture(element, event.pointerId);
    const action = element.dataset.touch;
    this.buttonsHeld.set(event.pointerId, { element, action });
    if (!this.actionPointers.has(action)) this.actionPointers.set(action, new Set());
    const pointers = this.actionPointers.get(action), first = pointers.size === 0;
    pointers.add(event.pointerId); element.classList.add('held'); element.setAttribute('aria-pressed', 'true');
    if (action === 'jump') { this.setKey('Space', true); this.callbacks.jump?.(); }
    else if (action === 'sneak') this.setKey('ShiftLeft', true);
    else if ((action === 'mine' || action === 'place') && first) this.callbacks[action]?.(true);
    else if (action === 'inventory' || action === 'pause') this.callbacks[action]?.();
  }
  endButton(pointerId) {
    const held = this.buttonsHeld.get(pointerId); if (!held) return;
    this.buttonsHeld.delete(pointerId);
    const pointers = this.actionPointers.get(held.action); pointers?.delete(pointerId);
    this.release(held.element, pointerId);
    if (pointers?.size) return;
    this.actionPointers.delete(held.action);
    held.element.classList.remove('held'); held.element.setAttribute('aria-pressed', 'false');
    if (held.action === 'jump') this.setKey('Space', false);
    else if (held.action === 'sneak') this.setKey('ShiftLeft', false);
    else if (held.action === 'mine' || held.action === 'place') this.callbacks[held.action]?.(false);
  }

  startLook(event) {
    if (!this.accepts(event) || this.lookPointer != null) return;
    this.consume(event); this.lookPointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    this.capture(this.canvas, event.pointerId);
  }
  moveLook(event) {
    const pointer = this.lookPointer;
    if (!this.active || !pointer || pointer.id !== event.pointerId) return;
    this.consume(event);
    const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
    pointer.x = event.clientX; pointer.y = event.clientY;
    if (dx || dy) this.callbacks.look?.(dx, dy);
  }
  endLook(pointerId) {
    if (!this.lookPointer || this.lookPointer.id !== pointerId) return;
    this.lookPointer = null; this.release(this.canvas, pointerId);
  }

  setActive(active) {
    active = !!active;
    if (active === this.active) return;
    this.active = active; this.root.hidden = !active;
    document.documentElement.classList.toggle('touch-playing', active);
    this.canvas.style.touchAction = active ? 'none' : this.oldTouchAction;
    if (!active) this.reset();
    else if (!this.shownHint) {
      this.shownHint = true; this.hint.classList.add('show');
      this.hintTimer = setTimeout(() => this.hint.classList.remove('show'), 5000);
    }
  }
  setFlying(flying) {
    flying = !!flying; if (flying === this.flying) return;
    this.flying = flying; this.root.classList.toggle('is-flying', flying);
    for (const [action, label] of [['jump', flying ? '上升' : '跳跃'], ['sneak', flying ? '下降' : '潜行']]) {
      const button = this.root.querySelector(`[data-touch="${action}"]`);
      button.querySelector('span').textContent = label; button.setAttribute('aria-label', label);
    }
    if (flying) { this.setKey('ControlLeft', false); this.stick.classList.remove('sprinting'); }
  }
  reset() {
    if (this.stickPointer != null) this.endStick(this.stickPointer);
    if (this.lookPointer) this.endLook(this.lookPointer.id);
    for (const id of [...this.buttonsHeld.keys()]) this.endButton(id);
    for (const code of [...this.keysHeld]) this.setKey(code, false);
    this.callbacks.move?.(0, 0);
  }
  dispose() {
    this.setActive(false); this.reset(); clearTimeout(this.hintTimer);
    this.removers.forEach(remove => remove()); this.removers.length = 0;
    this.root.remove(); this.canvas.style.touchAction = this.oldTouchAction;
    document.documentElement.classList.remove('touch-playing');
  }
}
