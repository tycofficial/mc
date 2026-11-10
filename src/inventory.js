import { ITEMS, B } from './data.js';
import { SMELTING, FUELS } from './recipes.js';

export function validStack(stack) {
  const item = ITEMS[stack?.id];
  if (!item || !Number.isInteger(stack.id) || !stack.id || !Number.isFinite(stack.count) || stack.count < 1) return null;
  const copy = { id: stack.id, count: Math.min(item.stack || 64, Math.floor(stack.count)) };
  if (item.durability) copy.durability = Math.max(1, Math.min(item.durability, Math.floor(Number.isFinite(stack.durability) ? stack.durability : item.durability)));
  return copy;
}
export const sameStack = (a, b) => !!a && !!b && a.id === b.id && (a.durability ?? null) === (b.durability ?? null);
export function addToSlots(slots, id, count = 1, durability) {
  const item = ITEMS[id];
  if (!item || !id || !Number.isFinite(count) || count <= 0) return count;
  let left = Math.floor(count);
  const incoming = { id, count: 1, ...(item.durability ? { durability: durability ?? item.durability } : {}) };
  for (const stack of slots) if (sameStack(stack, incoming)) {
    const move = Math.min(left, (item.stack || 64) - stack.count);
    stack.count += move; left -= move;
    if (!left) return 0;
  }
  for (let i = 0; i < slots.length && left; i++) if (!slots[i]) {
    const move = Math.min(left, item.stack || 64);
    slots[i] = { ...incoming, count: move }; left -= move;
  }
  return left;
}

export class Inventory {
  constructor(mode = 'survival', data = null) {
    this.mode = mode;
    this.slots = Array.from({ length: 36 }, (_, i) => validStack(data?.slots?.[i]));
    this.selected = Math.max(0, Math.min(8, Math.floor(Number.isFinite(data?.selected) ? data.selected : 0)));
    if (!data && mode === 'creative') [B.GRASS, B.STONE, B.LOG, B.PLANKS, B.GLASS, B.CRAFTING, B.GLOWSTONE, B.BRICKS, B.WATER].forEach((id, i) => this.slots[i] = { id, count: 64 });
  }
  get selectedItem() { return this.slots[this.selected]; }
  select(index) { this.selected = ((Math.floor(index) % 9) + 9) % 9; }
  add(id, count = 1, durability) { return addToSlots(this.slots, id, count, durability); }
  count(id) { return this.slots.reduce((n, s) => n + (s?.id === id ? s.count : 0), 0); }
  canAdd(id, count = 1, durability) { const copy = this.slots.map(s => s ? { ...s } : null); return addToSlots(copy, id, count, durability) === 0; }
  remove(id, count = 1) {
    if (!Number.isInteger(count) || count < 1 || this.count(id) < count) return false;
    let left = count;
    for (let i = 0; i < this.slots.length && left; i++) if (this.slots[i]?.id === id) {
      const take = Math.min(left, this.slots[i].count);
      this.slots[i].count -= take; left -= take;
      if (!this.slots[i].count) this.slots[i] = null;
    }
    return true;
  }
  takeSelected(count = 1) {
    const stack = this.selectedItem;
    if (!stack || count < 1) return null;
    const taken = { ...stack, count: Math.min(stack.count, Math.floor(count)) };
    stack.count -= taken.count;
    if (!stack.count) this.slots[this.selected] = null;
    return taken;
  }
  damageSelected(amount = 1) {
    const stack = this.selectedItem;
    if (!stack || !ITEMS[stack.id]?.durability || this.mode === 'creative') return false;
    stack.durability = (stack.durability ?? ITEMS[stack.id].durability) - amount;
    if (stack.durability > 0) return false;
    this.slots[this.selected] = null;
    return true;
  }
  serialize() { return { selected: this.selected, slots: this.slots.map(s => s ? { ...s } : null) }; }
}

export class Chest {
  constructor(data = null) { this.slots = Array.from({ length: 27 }, (_, i) => validStack(data?.slots?.[i])); }
  serialize() { return { slots: this.slots.map(s => s ? { ...s } : null) }; }
}

export class Furnace {
  constructor(data = null) {
    this.slots = Array.from({ length: 3 }, (_, i) => validStack(data?.slots?.[i]));
    this.burnRemaining = Math.max(0, Number(data?.burnRemaining) || 0);
    this.burnTotal = Math.max(0, Number(data?.burnTotal) || 0);
    this.cookTime = Math.max(0, Math.min(10, Number(data?.cookTime) || 0));
    this.cookingId = data?.cookingId ?? this.slots[0]?.id ?? null;
  }
  get progress() { return this.cookTime / 10; }
  canSmelt() {
    const output = SMELTING[this.slots[0]?.id], current = this.slots[2];
    return !!output && (!current || current.id === output && current.count < ITEMS[output].stack);
  }
  tick(dt) {
    if (!(dt > 0)) return false;
    let changed = false, remaining = Math.min(dt, 120);
    const inputId = this.slots[0]?.id ?? null;
    if (this.cookingId !== inputId) { this.cookTime = 0; this.cookingId = inputId; changed = true; }
    while (remaining > 0) {
      const step = Math.min(remaining, .25); remaining -= step;
      if (this.burnRemaining <= 0 && this.canSmelt() && FUELS[this.slots[1]?.id]) {
        this.burnTotal = this.burnRemaining = FUELS[this.slots[1].id];
        if (--this.slots[1].count <= 0) this.slots[1] = null;
        changed = true;
      }
      const burningTime = Math.min(step, this.burnRemaining);
      const burning = burningTime > 0;
      this.burnRemaining = Math.max(0, this.burnRemaining - step);
      if (burning && this.canSmelt()) {
        this.cookTime += burningTime; changed = true;
        if (this.cookTime >= 10) {
          const id = SMELTING[this.slots[0].id];
          if (!this.slots[2]) this.slots[2] = { id, count: 0 };
          this.slots[2].count++;
          if (--this.slots[0].count <= 0) { this.slots[0] = null; this.cookingId = null; }
          this.cookTime -= 10;
        }
      } else if (this.cookTime > 0) { this.cookTime = Math.max(0, this.cookTime - step * 2); changed = true; }
    }
    return changed;
  }
  serialize() { return { slots: this.slots.map(s => s ? { ...s } : null), burnRemaining: this.burnRemaining, burnTotal: this.burnTotal, cookTime: this.cookTime, cookingId: this.cookingId }; }
}
