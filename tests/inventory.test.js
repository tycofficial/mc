import test from 'node:test';
import assert from 'node:assert/strict';
import { Inventory, Furnace, Chest, validStack } from '../src/inventory.js';
import { RECIPES, matchRecipe, craft } from '../src/recipes.js';
import { B } from '../src/data.js';
import { UI } from '../src/ui.js';

function menuModel(inv = new Inventory()) {
  const ui = Object.create(UI.prototype);
  Object.assign(ui, { inventory: inv, inventoryKind: 'inventory', craftSize: 2, craftGrid: Array(4).fill(null), cursor: null, extra: {}, renderInventory() {}, updateCursor() {}, hideMenus() {}, toast() {} });
  return ui;
}

test('survival begins empty; creative hotbar contains nine useful blocks', () => {
  assert.ok(new Inventory('survival').slots.every(s => s === null));
  const inv = new Inventory('creative');
  assert.deepEqual(inv.slots.slice(0, 9).map(s => s.id), [1, 3, 6, 8, 15, 17, 21, 16, 9]);
  assert.ok(inv.slots.slice(0, 9).every(s => s.count === 64));
});
test('stacking conserves counts and returns full-inventory overflow', () => {
  const inv = new Inventory();
  assert.equal(inv.add(B.DIRT, 100), 0);
  assert.equal(inv.slots[0].count, 64); assert.equal(inv.slots[1].count, 36);
  assert.equal(inv.add(B.DIRT, 2300), 96);
  assert.equal(inv.count(B.DIRT), 2304);
  assert.equal(inv.add(B.STONE, 1), 1);
});
test('failed removal is atomic and selection wraps in both directions', () => {
  const inv = new Inventory(); inv.add(B.LOG, 4);
  const original = inv.serialize();
  assert.equal(inv.remove(B.LOG, 5), false); assert.deepEqual(inv.serialize(), original);
  assert.equal(inv.remove(B.LOG, 0), false);
  assert.equal(inv.remove(B.LOG, 3), true); assert.equal(inv.count(B.LOG), 1);
  inv.select(-1); assert.equal(inv.selected, 8); inv.select(9); assert.equal(inv.selected, 0);
  assert.deepEqual(inv.takeSelected(), { id: B.LOG, count: 1 }); assert.equal(inv.selectedItem, null);
});
test('tools do not stack, preserve durability and break at zero', () => {
  const inv = new Inventory(); inv.add(120, 2, 2);
  assert.equal(inv.slots[0].count, 1); assert.equal(inv.slots[1].durability, 2);
  assert.equal(inv.damageSelected(), false); assert.equal(inv.selectedItem.durability, 1);
  assert.equal(inv.damageSelected(), true); assert.equal(inv.selectedItem, null);
  const restored = new Inventory('survival', inv.serialize()); assert.deepEqual(restored.serialize(), inv.serialize());
});
test('untrusted serialized slots are clamped and unknown IDs rejected', () => {
  assert.equal(validStack({ id: 99999, count: 1 }), null);
  assert.equal(validStack({ id: B.LOG, count: -2 }), null);
  assert.equal(validStack({ id: B.LOG, count: Infinity }), null);
  assert.deepEqual(validStack({ id: B.LOG, count: 999 }), { id: B.LOG, count: 64 });
  assert.equal(new Chest({ slots: [{ id: B.LOG, count: 5 }] }).slots.length, 27);
});
test('crafting supports offset patterns and consumes one ingredient per cell', () => {
  const grid = Array(9).fill(null); grid[8] = { id: B.BIRCH_LOG, count: 3 };
  assert.equal(matchRecipe(grid, 3).recipe.id, 'planks');
  assert.deepEqual(craft(grid, 3), { id: B.PLANKS, count: 4 });
  assert.equal(grid[8].count, 2);
  const sticks = Array(9).fill(null); sticks[5] = { id: B.PLANKS, count: 1 }; sticks[8] = { id: B.PLANKS, count: 1 };
  assert.equal(matchRecipe(sticks, 3).recipe.id, 'sticks');
  assert.deepEqual(craft(sticks, 3), { id: 100, count: 4 }); assert.ok(sticks.every(s => !s));
});
test('axe recipe mirrors correctly; surplus unrelated ingredient invalidates recipe', () => {
  const grid = [B.PLANKS, B.PLANKS, 0, 100, B.PLANKS, 0, 100, 0, 0].map(id => id ? { id, count: 1 } : null);
  assert.equal(matchRecipe(grid, 3).recipe.id, '120-axe');
  const result = craft(grid, 3); assert.equal(result.id, 121); assert.equal(result.durability, 59);
  const wrong = [{ id: B.LOG, count: 1 }, { id: B.DIRT, count: 1 }, null, null];
  assert.equal(matchRecipe(wrong, 2), null); assert.equal(craft(wrong, 2), null);
});
test('all advertised recipes match their own canonical shape', () => {
  for (const recipe of RECIPES) {
    const grid = Array(9).fill(null);
    recipe.pattern.forEach((line, y) => [...line].forEach((char, x) => {
      if (char !== ' ') grid[y * 3 + x] = { id: Array.isArray(recipe.ingredients[char]) ? recipe.ingredients[char][0] : recipe.ingredients[char], count: 1 };
    }));
    assert.equal(matchRecipe(grid, 3)?.recipe.id, recipe.id);
  }
});
test('furnace requires fuel, consumes input once and preserves state through save', () => {
  const furnace = new Furnace(); furnace.slots[0] = { id: 102, count: 2 };
  furnace.tick(20); assert.equal(furnace.slots[2], null);
  furnace.slots[1] = { id: 101, count: 1 }; furnace.tick(10);
  assert.deepEqual(furnace.slots[2], { id: 105, count: 1 }); assert.equal(furnace.slots[0].count, 1); assert.equal(furnace.slots[1], null);
  assert.equal(furnace.burnRemaining, 70);
  const restored = new Furnace(furnace.serialize()); restored.tick(10);
  assert.deepEqual(restored.slots[2], { id: 105, count: 2 }); assert.equal(restored.slots[0], null);
});
test('blocked furnace cannot duplicate, overwrite or consume fresh fuel', () => {
  const furnace = new Furnace({ slots: [{ id: 102, count: 3 }, { id: 101, count: 1 }, { id: 105, count: 64 }] });
  furnace.tick(30); assert.equal(furnace.slots[0].count, 3); assert.equal(furnace.slots[1].count, 1); assert.equal(furnace.slots[2].count, 64);
  furnace.slots[2] = { id: B.GLASS, count: 1 }; furnace.tick(30); assert.equal(furnace.slots[2].id, B.GLASS); assert.equal(furnace.slots[1].count, 1);
});
test('inventory click/split/place/shift interactions conserve every item', () => {
  const inv = new Inventory(); inv.add(B.LOG, 17);
  const ui = menuModel(inv);
  ui.slotClick('inventory', 0, true);
  assert.equal(ui.cursor.count, 9); assert.equal(inv.slots[0].count, 8);
  ui.slotClick('craft', 0, true);
  assert.equal(ui.cursor.count, 8); assert.equal(ui.craftGrid[0].count, 1);
  ui.slotClick('inventory', 1);
  assert.equal(ui.cursor, null); assert.equal(inv.slots[1].count, 8);
  ui.slotClick('inventory', 1, false, true);
  assert.equal(inv.slots[1], null); assert.equal(inv.slots[9].count, 8);
  assert.deepEqual(ui.closeInventory(), []); assert.equal(inv.count(B.LOG), 17);
});
test('crafting output is atomic when cursor has no space', () => {
  const ui = menuModel(); ui.craftGrid[0] = { id: B.LOG, count: 2 };
  ui.cursor = { id: B.PLANKS, count: 63 }; ui.slotClick('result', 0);
  assert.equal(ui.craftGrid[0].count, 2); assert.equal(ui.cursor.count, 63);
  ui.cursor.count = 60; ui.slotClick('result', 0);
  assert.equal(ui.cursor.count, 64); assert.equal(ui.craftGrid[0].count, 1);
});
test('recipe autofill fails without modifying backpack or crafting grid', () => {
  const inv = new Inventory(); inv.add(B.LOG, 2);
  const ui = menuModel(inv); ui.craftSize = 3; ui.craftGrid = Array(9).fill(null);
  ui.craftGrid[0] = { id: B.PLANKS, count: 1 };
  const before = JSON.stringify([inv.serialize(), ui.craftGrid]);
  ui.fillRecipe('120-pick'); assert.equal(JSON.stringify([inv.serialize(), ui.craftGrid]), before);
});
test('full-backpack close returns exact overflow instead of deleting items', () => {
  const inv = new Inventory(); inv.add(B.DIRT, 2304);
  const ui = menuModel(inv); ui.craftGrid[0] = { id: B.LOG, count: 2 }; ui.cursor = { id: 101, count: 3 };
  assert.deepEqual(ui.closeInventory(), [{ id: B.LOG, count: 2 }, { id: 101, count: 3 }]);
  assert.equal(inv.count(B.DIRT), 2304); assert.equal(ui.cursor, null); assert.deepEqual(ui.craftGrid, []);
});
test('furnace output accepts collection into a matching cursor but rejects insertion', () => {
  const ui = menuModel(); ui.extra.furnace = new Furnace(); ui.extra.furnace.slots[2] = { id: 105, count: 4 };
  ui.cursor = { id: 105, count: 62 }; ui.slotClick('furnace', 2);
  assert.equal(ui.cursor.count, 64); assert.equal(ui.extra.furnace.slots[2].count, 2);
  ui.cursor = { id: B.DIRT, count: 1 }; ui.slotClick('furnace', 2);
  assert.equal(ui.extra.furnace.slots[2].id, 105); assert.equal(ui.cursor.id, B.DIRT);
});
test('changing furnace input resets progress and partial fuel burns are respected', () => {
  const f = new Furnace(); f.slots[0] = { id: B.SAND, count: 1 }; f.slots[1] = { id: 101, count: 1 }; f.tick(9);
  assert.equal(f.cookTime, 9); f.slots[0] = { id: 102, count: 1 }; f.tick(1);
  assert.equal(f.slots[2], null); assert.equal(f.cookTime, 1);
  f.burnRemaining = .1; f.tick(.25);
  assert.equal(f.cookTime, 1.1); assert.equal(f.burnRemaining, 0);
});
