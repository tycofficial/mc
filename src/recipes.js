import { B, ITEMS } from './data.js';

const shaped = (id, name, pattern, ingredients, result, count = 1) => ({ id, name, pattern, ingredients, result: { id: result, count }, size: Math.max(pattern.length, ...pattern.map(r => r.length)) });
export const RECIPES = [
  shaped('planks', '橡木木板', ['L'], { L: [B.LOG, B.BIRCH_LOG] }, B.PLANKS, 4),
  shaped('sticks', '木棍', ['P', 'P'], { P: B.PLANKS }, 100, 4),
  shaped('crafting', '工作台', ['PP', 'PP'], { P: B.PLANKS }, B.CRAFTING),
  shaped('torch', '火把', ['C', 'S'], { C: 101, S: 100 }, B.TORCH, 4),
  shaped('furnace', '熔炉', ['CCC', 'C C', 'CCC'], { C: B.COBBLE }, B.FURNACE),
  shaped('chest', '箱子', ['PPP', 'P P', 'PPP'], { P: B.PLANKS }, B.CHEST),
  shaped('bricks', '红砖', ['BB', 'BB'], { B: 109 }, B.BRICKS),
  shaped('clay', '黏土块', ['CC', 'CC'], { C: 108 }, B.CLAY),
  shaped('bread', '面包', ['WWW'], { W: 113 }, 114),
  shaped('tnt', 'TNT', ['GSG', 'SGS', 'GSG'], { G: 115, S: B.SAND }, B.TNT),
  shaped('melon', '西瓜', ['MMM', 'MMM', 'MMM'], { M: 107 }, B.MELON),
];
for (const [base, material, ingredient] of [[120, '木', B.PLANKS], [130, '石', B.COBBLE], [140, '铁', 105], [150, '钻石', 104]]) {
  RECIPES.push(
    shaped(`${base}-pick`, `${material}镐`, ['MMM', ' S ', ' S '], { M: ingredient, S: 100 }, base),
    shaped(`${base}-axe`, `${material}斧`, ['MM', 'MS', ' S'], { M: ingredient, S: 100 }, base + 1),
    shaped(`${base}-shovel`, `${material}锹`, ['M', 'S', 'S'], { M: ingredient, S: 100 }, base + 2),
    shaped(`${base}-sword`, `${material}剑`, ['M', 'M', 'S'], { M: ingredient, S: 100 }, base + 3),
  );
}

/** Shape matching trims empty margins and supports horizontal mirroring. */
export function matchRecipe(grid, size = Math.round(Math.sqrt(grid.length))) {
  const occupied = [];
  grid.forEach((stack, index) => { if (stack?.id && stack.count > 0) occupied.push(index); });
  if (!occupied.length) return null;
  const minX = Math.min(...occupied.map(i => i % size));
  const maxX = Math.max(...occupied.map(i => i % size));
  const minY = Math.min(...occupied.map(i => Math.floor(i / size)));
  const maxY = Math.max(...occupied.map(i => Math.floor(i / size)));
  for (const recipe of RECIPES) {
    const width = recipe.pattern[0].length, height = recipe.pattern.length;
    if (width !== maxX - minX + 1 || height !== maxY - minY + 1) continue;
    for (const mirrored of [false, true]) {
      let matches = true;
      for (let y = 0; y < height && matches; y++) for (let x = 0; x < width; x++) {
        const char = recipe.pattern[y][mirrored ? width - x - 1 : x] || ' ';
        const actual = grid[(y + minY) * size + x + minX];
        if (char === ' ') { if (actual?.id) matches = false; }
        else {
          const allowed = recipe.ingredients[char];
          if (!(Array.isArray(allowed) ? allowed.includes(actual?.id) : allowed === actual?.id)) matches = false;
        }
      }
      if (matches) return { recipe, slots: occupied };
    }
  }
  return null;
}

export function craft(grid, size) {
  const match = matchRecipe(grid, size);
  if (!match) return null;
  for (const index of match.slots) { if (--grid[index].count <= 0) grid[index] = null; }
  const result = { ...match.recipe.result };
  if (ITEMS[result.id].durability) result.durability = ITEMS[result.id].durability;
  return result;
}

export const SMELTING = Object.freeze({ [B.SAND]: B.GLASS, [B.COBBLE]: B.STONE, 102: 105, 103: 106, 108: 109, 111: 112, 116: 117, 118: 119, [B.LOG]: 101, [B.BIRCH_LOG]: 101 });
export const FUELS = Object.freeze({ 101: 80, [B.PLANKS]: 15, [B.LOG]: 15, [B.BIRCH_LOG]: 15, 100: 5, [B.CRAFTING]: 15, [B.CHEST]: 15, 120: 10, 121: 10, 122: 10, 123: 10 });
