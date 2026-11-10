import { B } from './data.js';

export const WORLD_HEIGHT = 96;
export const SEA_LEVEL = 27;
export const CHUNK_SIZE = 16;
export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;
export const indexOf = (x, y, z) => x + CHUNK_SIZE * (z + CHUNK_SIZE * y);

export function seedHash(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function hash3(x, y, z, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = t => t * t * (3 - 2 * t);
const mix = (a, b, t) => a + (b - a) * t;
export function noise2(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = smooth(x - ix), fz = smooth(z - iz);
  return mix(mix(hash3(ix, 0, iz, seed), hash3(ix + 1, 0, iz, seed), fx), mix(hash3(ix, 0, iz + 1, seed), hash3(ix + 1, 0, iz + 1, seed), fx), fz);
}
export function noise3(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = smooth(x - ix), fy = smooth(y - iy), fz = smooth(z - iz);
  const layer = dy => mix(mix(hash3(ix, iy + dy, iz, seed), hash3(ix + 1, iy + dy, iz, seed), fx), mix(hash3(ix, iy + dy, iz + 1, seed), hash3(ix + 1, iy + dy, iz + 1, seed), fx), fz);
  return mix(layer(0), layer(1), fy);
}

/** Deterministic, renderer-independent terrain. All structures are sampled in world coordinates. */
export function createTerrain(seedValue = '方块世界') {
  const seed = seedHash(seedValue);
  const fbm = (x, z, scale) => noise2(x * scale, z * scale, seed) * .58 + noise2(x * scale * 2, z * scale * 2, seed + 11) * .28 + noise2(x * scale * 4, z * scale * 4, seed + 51) * .14;
  function column(x, z) {
    const continental = fbm(x + 123, z - 87, .008);
    const mountain = Math.max(0, noise2(x * .005, z * .005, seed + 301) - .49) * 2.9;
    const detail = fbm(x, z, .035);
    let height = 20 + continental * 21 + mountain * mountain * 23 + (detail - .5) * 9;
    // A gentle, dry spawn meadow, blended into the surrounding seeded landscape.
    const spawnBlend = Math.max(0, 1 - Math.hypot(x, z) / 34);
    height = mix(height, 33 + noise2(x * .035, z * .035, seed + 9) * 3, smooth(spawnBlend));
    height = Math.max(7, Math.min(WORLD_HEIGHT - 14, Math.floor(height)));
    const temperature = noise2(x * .0038 + 41, z * .0038 - 93, seed + 913);
    const moisture = noise2(x * .009 - 23, z * .009 + 18, seed + 217);
    let biome = '草原';
    if (height <= SEA_LEVEL - 2) biome = '海洋';
    else if (height <= SEA_LEVEL + 1) biome = '沙滩';
    else if (temperature > .64 && spawnBlend === 0) biome = '沙漠';
    else if ((temperature < .27 || height >= 53) && spawnBlend === 0) biome = '雪山';
    else if (moisture > .47) biome = '森林';
    if (spawnBlend > .4) biome = '草原';
    const surface = biome === '沙漠' || biome === '沙滩' || biome === '海洋' ? B.SAND : biome === '雪山' ? B.SNOW : B.GRASS;
    return { height, biome, surface, moisture, temperature };
  }
  function baseBlock(x, y, z, c = column(x, z)) {
    if (y < 0) return B.BEDROCK;
    if (y >= WORLD_HEIGHT) return B.AIR;
    if (y === 0 || (y < 3 && hash3(x, y, z, seed) > y * .33)) return B.BEDROCK;
    if (y > c.height) return y <= SEA_LEVEL ? B.WATER : B.AIR;
    if (y === c.height) return c.surface;
    if (y >= c.height - 3) return c.surface === B.SAND ? B.SAND : B.DIRT;
    const cave = y > 4 && y < c.height - 5 && noise3(x * .055, y * .08, z * .055, seed + 71) > .64 && noise3(x * .075 + 23, y * .09, z * .075, seed + 173) > .42;
    if (cave) return B.AIR;
    const ore = hash3(x, y, z, seed + 771);
    const vein = hash3(Math.floor(x / 3), Math.floor(y / 3), Math.floor(z / 3), seed + 891);
    if (y < 17 && vein > .8 && ore > .72) return B.DIAMOND_ORE;
    if (y < 26 && vein < .16 && ore > .73) return B.GOLD_ORE;
    if (y < 48 && vein > .42 && vein < .62 && ore > .65) return B.IRON_ORE;
    if (ore > .965 || (vein > .66 && vein < .77 && ore > .62)) return B.COAL_ORE;
    if (vein < .05 && ore > .25) return B.GRAVEL;
    return B.STONE;
  }
  function treeAt(gx, gz) {
    const v = hash3(gx, 0, gz, seed + 481);
    const x = gx * 7 + 1 + Math.floor(hash3(gx, 3, gz, seed) * 5);
    const z = gz * 7 + 1 + Math.floor(hash3(gx, 7, gz, seed) * 5);
    const c = column(x, z);
    if (c.surface !== B.GRASS || c.height <= SEA_LEVEL + 1 || Math.hypot(x, z) < 5) return null;
    if (v > (c.biome === '森林' ? .76 : .23)) return null;
    return { x, z, y: c.height + 1, height: 4 + Math.floor(hash3(gx, 9, gz, seed) * 3), birch: v < .18 };
  }
  function fillChunk(cx, cz) {
    const data = new Uint8Array(CHUNK_VOLUME);
    const heights = new Int16Array(256);
    const ox = cx * CHUNK_SIZE, oz = cz * CHUNK_SIZE;
    const put = (x,y,z,id,replace = true) => {
      if (x < ox || x >= ox + 16 || z < oz || z >= oz + 16 || y < 0 || y >= WORLD_HEIGHT) return;
      const i = indexOf(x - ox,y,z - oz);
      if (replace || data[i] === B.AIR || data[i] === B.TALL_GRASS || data[i] === B.FLOWER) data[i] = id;
    };
    for (let z=0; z<16; z++) for (let x=0; x<16; x++) {
      const wx=ox+x, wz=oz+z, c=column(wx,wz);
      heights[x+16*z] = c.height;
      for (let y=0; y<=Math.max(c.height,SEA_LEVEL); y++) data[indexOf(x,y,z)] = baseBlock(wx,y,wz,c);
      const plant = hash3(wx, c.height, wz, seed + 157);
      if (c.surface === B.GRASS && c.height > SEA_LEVEL) {
        if (plant < .023) put(wx,c.height+1,wz,B.FLOWER);
        else if (plant < .16) put(wx,c.height+1,wz,B.TALL_GRASS);
        else if (plant > .998) put(wx,c.height+1,wz,B.MELON);
      } else if (c.biome === '沙漠' && plant < .009) {
        for(let y=1; y<=2+Math.floor(plant*800)%2; y++) put(wx,c.height+y,wz,B.CACTUS);
      } else if (c.biome === '雪山' && c.height < SEA_LEVEL && c.temperature < .19) put(wx,SEA_LEVEL,wz,B.ICE);
    }
    // Neighboring structure candidates are included, so a canopy never ends at a chunk seam.
    for (let gz=Math.floor((oz-3)/7); gz<=Math.floor((oz+18)/7); gz++) for (let gx=Math.floor((ox-3)/7); gx<=Math.floor((ox+18)/7); gx++) {
      const t=treeAt(gx,gz); if (!t) continue;
      const crown=t.y+t.height;
      for (let dy=-2;dy<=1;dy++) {
        const radius=dy===1?1:2;
        for (let dz=-radius;dz<=radius;dz++) for (let dx=-radius;dx<=radius;dx++) {
          if (Math.abs(dx)===radius && Math.abs(dz)===radius && (dy===1 || hash3(t.x+dx,dy,t.z+dz,seed)>.65)) continue;
          put(t.x+dx,crown+dy,t.z+dz,t.birch?B.BIRCH_LEAVES:B.LEAVES,false);
        }
      }
      for (let dy=0;dy<t.height;dy++) put(t.x,t.y+dy,t.z,t.birch?B.BIRCH_LOG:B.LOG);
    }
    return { data, heights };
  }
  return { seed, column, baseBlock, treeAt, fillChunk, getHeight:(x,z)=>column(Math.floor(x),Math.floor(z)).height, getBiome:(x,z)=>column(Math.floor(x),Math.floor(z)).biome };
}

/** Amanatides-Woo traversal. Does not skip thin blocks or produce diagonal placement errors. */
export function voxelRaycast(getBlock, origin, direction, maxDistance = 6, predicate = id => id !== B.AIR && id !== B.WATER) {
  const length = Math.hypot(direction.x,direction.y,direction.z);
  if (!Number.isFinite(length) || length < 1e-12 || !(maxDistance >= 0)) return null;
  const d = {x:direction.x/length,y:direction.y/length,z:direction.z/length};
  let x=Math.floor(origin.x), y=Math.floor(origin.y), z=Math.floor(origin.z), distance=0;
  const sx=Math.sign(d.x), sy=Math.sign(d.y), sz=Math.sign(d.z);
  const dx=d.x?Math.abs(1/d.x):Infinity, dy=d.y?Math.abs(1/d.y):Infinity, dz=d.z?Math.abs(1/d.z):Infinity;
  let tx=d.x?((sx>0?x+1:x)-origin.x)/d.x:Infinity;
  let ty=d.y?((sy>0?y+1:y)-origin.y)/d.y:Infinity;
  let tz=d.z?((sz>0?z+1:z)-origin.z)/d.z:Infinity;
  let normal={x:0,y:0,z:0}, previous={x,y,z};
  for (let step=0;step<2048 && distance<=maxDistance;step++) {
    const id=getBlock(x,y,z);
    if (predicate(id)) return {x,y,z,id,normal,previous,distance:Math.max(0,distance)};
    previous={x,y,z};
    if (tx<=ty && tx<=tz) { x+=sx;distance=tx;tx+=dx;normal={x:-sx,y:0,z:0}; }
    else if(ty<=tz) { y+=sy;distance=ty;ty+=dy;normal={x:0,y:-sy,z:0}; }
    else { z+=sz;distance=tz;tz+=dz;normal={x:0,y:0,z:-sz}; }
  }
  return null;
}
