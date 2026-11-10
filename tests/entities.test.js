import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Environment } from '../src/environment.js';
import { Entities, Particles } from '../src/entities.js';
import { B } from '../src/data.js';

function fixture() {
  const scene = new THREE.Scene();
  const world = {
    getHeight: () => 29,
    getBlock: (_x, y, _z) => y <= 29 ? B.GRASS : B.AIR,
    raycast: () => null,
  };
  const damage = [], drops = [];
  const entities = new Entities(scene, world, { seed: 'repeatable-animals', onDamage: (...args) => damage.push(args), onDrop: (...args) => drops.push(args) });
  entities.initialized = true;
  entities.spawnTimer = 999;
  return { scene, world, entities, damage, drops };
}

test('deterministic animal spawns stay above terrain and refuse walls/water', () => {
  const a = fixture(), b = fixture();
  const player = new THREE.Vector3(0, 30, 0);
  const first = a.entities.spawnNear(player, 'sheep');
  const second = b.entities.spawnNear(player, 'sheep');
  assert(first && second);
  assert.deepEqual(first.position.toArray(), second.position.toArray());
  for (let i = 0; i < 200; i++) a.entities.update(.05, player);
  assert.equal(first.position.y, 30);
  first.position.set(0, 30, 0);
  a.world.getBlock = (x, y) => y <= 29 ? B.STONE : x >= 2 && y <= 32 ? B.STONE : B.AIR;
  assert.equal(a.entities.canMove(first, 2.5, 0), null);
  a.world.getBlock = (x, y) => y <= 28 ? B.STONE : x >= 2 && y <= 30 ? B.WATER : y <= 29 ? B.GRASS : B.AIR;
  assert.equal(a.entities.canMove(first, 2.5, 0), null);
  a.entities.dispose(); b.entities.dispose();
});

test('combat respects reach and solid occlusion, then drops correct food once', () => {
  const { world, entities, drops, scene } = fixture();
  const pig = entities.makeAnimal('pig', 0, 30, 3);
  pig.yaw = 0; pig.group.rotation.y = 0;
  const origin = new THREE.Vector3(0, 30.75, 0), direction = new THREE.Vector3(0, 0, 1);
  assert.equal(entities.hit(origin, direction, 1, 20), false);
  world.raycast = () => ({ distance: 1 });
  assert.equal(entities.hit(origin, direction, 4, 20), false);
  assert.equal(pig.health, 10);
  world.raycast = () => null;
  assert.equal(entities.hit(origin, direction, 4, 20), true);
  assert.equal(entities.list.length, 0);
  assert.equal(drops.length, 1);
  assert.equal(drops[0][0], 111);
  assert(drops[0][1] >= 1 && drops[0][1] <= 3);
  assert.equal(entities.hit(origin, direction, 4, 20), false);
  entities.dispose(); assert.equal(scene.children.length, 0);
});

test('zombies attack survival players with cooldown but cannot hit through walls or creative mode', () => {
  const { world, entities, damage } = fixture();
  const player = new THREE.Vector3(0, 30, 0);
  const zombie = entities.makeAnimal('zombie', 0, 30, .95);
  world.raycast = () => ({ distance: .1 });
  entities.update(.05, player, { daylight: 0 });
  assert.equal(damage.length, 0);
  world.raycast = () => null;
  entities.update(.05, player, { daylight: 0 });
  assert.deepEqual(damage, [[3, '僵尸']]);
  entities.update(.05, player, { daylight: 0 });
  assert.equal(damage.length, 1);
  zombie.attackCooldown = 0;
  entities.update(.05, player, { daylight: 0, mode: 'creative' });
  assert.equal(damage.length, 1);
  entities.dispose();
});

test('zombies burn in daylight while overhead blocks provide shelter', () => {
  const { world, entities } = fixture();
  const player = new THREE.Vector3(20, 30, 20);
  const zombie = entities.makeAnimal('zombie', 0, 30, 0);
  zombie.moving = false; zombie.decision = 999;
  for (let i = 0; i < 25; i++) entities.update(.05, player, { daylight: 1, mode: 'creative' });
  assert.equal(zombie.health, 18);
  world.getBlock = (_x, y) => y <= 29 || y === 34 ? B.STONE : B.AIR;
  zombie.skyCheck = 0;
  for (let i = 0; i < 50; i++) entities.update(.05, player, { daylight: 1, mode: 'creative' });
  assert.equal(zombie.health, 18);
  entities.dispose();
});

test('day/night, rain, underwater fog and save time restore coherently', () => {
  const scene = new THREE.Scene();
  const environment = new Environment(scene, { seed: 'atmosphere', time: .25 });
  const player = new THREE.Vector3(10, 32, -5);
  environment.update(.05, player); assert(environment.daylight > .99);
  environment.time = .75; environment.update(.05, player); assert(environment.daylight < .01);
  environment.setWeather('rain'); environment.update(.05, player); assert(environment.rain.visible);
  environment.update(.05, { x: 1, y: 28, z: 2 }, { underwater: true });
  assert.equal(environment.rain.visible, false); assert.equal(scene.fog.far, 21);
  assert(Number.isFinite(environment.sun.quaternion.w));
  environment.time = .99999; environment.update(.1, player); assert.equal(environment.day, 2);
  const saved = environment.serialize();
  const restored = new Environment(new THREE.Scene(), saved);
  assert.deepEqual(restored.serialize(), saved);
  restored.dispose(); environment.dispose(); assert.equal(scene.children.length, 0);
});

test('particle pool remains bounded and expires', () => {
  const scene = new THREE.Scene();
  const particles = new Particles(scene, 32);
  for (let i = 0; i < 10; i++) particles.spawnBreak(new THREE.Vector3(), B.DIRT);
  assert.equal(particles.particles.length, 32);
  assert(particles.particles.some(p => p.active));
  for (let i = 0; i < 30; i++) particles.update(.05);
  assert(particles.particles.every(p => !p.active));
  particles.dispose(); assert.equal(scene.children.length, 0);
});

test('animal health and positions survive a save round trip', () => {
  const { scene, world, entities } = fixture();
  const sheep = entities.makeAnimal('sheep', 4.5, 30, -3);
  sheep.health = 4; sheep.yaw = 1.25;
  const data = entities.serialize();
  const restored = new Entities(scene, world, { data });
  assert.deepEqual(restored.serialize(), data);
  assert.equal(restored.initialized, true);
  restored.dispose(); entities.dispose();
});

test('spawn clearance rejects trunks and malformed saved creatures are ignored', () => {
  const { scene, world, entities } = fixture();
  world.getBlock = (_x, y) => y <= 29 ? B.GRASS : y <= 34 ? B.LOG : B.AIR;
  assert.equal(entities.spawnNear(new THREE.Vector3(0, 30, 0), 'cow'), null);
  const restored = new Entities(scene, world, { data: [
    { type: 'sheep', position: [0, -1000, 0], health: 8 },
    { type: 'sheep', position: [0, Infinity, 0], health: 8 },
    { type: 'dragon', position: [0, 30, 0], health: 8 },
    { type: 'pig', position: [0, 30, 0], health: 0 },
  ] });
  assert.equal(restored.list.length, 0);
  restored.dispose(); entities.dispose();
});
