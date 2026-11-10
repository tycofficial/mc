import * as THREE from 'three';
import { B, BLOCKS, isSolid } from './data.js';

const TAU = Math.PI * 2;
const animalTypes = ['sheep', 'pig', 'cow'];
const animalHealth = { sheep: 8, pig: 10, cow: 10, zombie: 20 };
const animalNames = { sheep: '绵羊', pig: '猪', cow: '牛', zombie: '僵尸' };

function seededRandom(seed) {
  let state = 0x811c9dc5;
  for (const c of String(seed)) state = Math.imul(state ^ c.charCodeAt(0), 16777619);
  return () => { state += 0x6D2B79F5; let n = state; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61); return ((n ^ n >>> 14) >>> 0) / 4294967296; };
}

/** Small, living voxel animals with terrain-aware wandering and night-time enemies. */
export class Entities {
  constructor(scene, world, { seed = 'mc', onDamage = () => {}, onDrop = () => {}, data = null } = {}) {
    this.scene = scene;
    this.world = world;
    this.onDamage = onDamage;
    this.onDrop = onDrop;
    this.random = seededRandom(seed);
    this.list = [];
    this.elapsed = 0;
    this.spawnTimer = 0;
    this.initialized = false;
    this.boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    this.shadowGeometry = new THREE.PlaneGeometry(1, 1);
    this.shadowMaterial = new THREE.MeshBasicMaterial({ color: 0x1c2718, transparent: true, opacity: .23, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.ray = new THREE.Ray();
    this.localRay = new THREE.Ray();
    this.inverseMatrix = new THREE.Matrix4();
    this.hitBox = new THREE.Box3();
    this.hitPoint = new THREE.Vector3();
    this._player = new THREE.Vector3();
    if (Array.isArray(data)) {
      this.initialized = true;
      this.spawnTimer = 7;
      for (const saved of data.slice(0, 32)) {
        if (!saved || !animalHealth[saved.type] || !Array.isArray(saved.position) || saved.position.length !== 3 || !saved.position.every(Number.isFinite)) continue;
        if (saved.position.some(n => Math.abs(n) > 1000000) || saved.position[1] < 0 || saved.position[1] > 128 || saved.health <= 0) continue;
        const entity = this.makeAnimal(saved.type, ...saved.position);
        entity.health = THREE.MathUtils.clamp(Number(saved.health) || animalHealth[saved.type], 1, animalHealth[saved.type]);
        entity.yaw = Number.isFinite(saved.yaw) ? saved.yaw : 0;
        entity.targetYaw = entity.yaw;
        entity.group.rotation.y = entity.yaw;
      }
    }
  }

  makeAnimal(type, x, y, z) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.name = animalNames[type];
    const materials = new Map();
    const material = color => {
      if (!materials.has(color)) materials.set(color, new THREE.MeshLambertMaterial({ color }));
      return materials.get(color);
    };
    const cube = (parent, size, position, color) => {
      const mesh = new THREE.Mesh(this.boxGeometry, material(color));
      mesh.scale.set(...size);
      mesh.position.set(...position);
      parent.add(mesh);
      return mesh;
    };
    const legs = [], arms = [];
    const limb = (x, y, z, width, length, color, hoofColor) => {
      const pivot = new THREE.Group(); pivot.position.set(x, y, z); group.add(pivot);
      cube(pivot, [width, length, width], [0, -length / 2, 0], color);
      if (hoofColor) cube(pivot, [width + .005, .12, width + .005], [0, -length + .06, 0], hoofColor);
      return pivot;
    };
    const eyes = (head, width, y, z, white = '#e9e7d9') => {
      for (const sign of [-1, 1]) {
        cube(head, [.105, .105, .018], [sign * width, y, z], white);
        cube(head, [.048, .066, .025], [sign * (width - .019), y - .006, z + .01], '#24272a');
      }
    };
    let head, height = 1.4, width = .5;
    if (type === 'sheep') {
      cube(group, [.85, .7, 1.12], [0, .87, 0], '#e8e7dc');
      cube(group, [.8, .12, 1.08], [0, 1.27, 0], '#f4f1e5');
      for (const xx of [-.28, .28]) for (const zz of [-.38, .38]) legs.push(limb(xx, .57, zz, .17, .57, '#b0a18b', '#696055'));
      head = new THREE.Group(); head.position.set(0, 1.08, .67); group.add(head);
      cube(head, [.43, .46, .5], [0, 0, 0], '#b9ac92');
      cube(head, [.46, .14, .42], [0, .22, -.03], '#e8e7dc');
      eyes(head, .14, .055, .259);
      cube(head, [.15, .065, .02], [0, -.12, .26], '#786c5d');
    } else if (type === 'pig') {
      height = 1.22; width = .48;
      cube(group, [.79, .62, 1.03], [0, .69, 0], '#e4a2a0');
      cube(group, [.76, .1, .97], [0, 1.01, 0], '#ecb2ab');
      for (const xx of [-.26, .26]) for (const zz of [-.34, .34]) legs.push(limb(xx, .44, zz, .2, .44, '#d38f8c', '#a16c69'));
      head = new THREE.Group(); head.position.set(0, .88, .64); group.add(head);
      cube(head, [.56, .48, .47], [0, 0, 0], '#e7aaa5');
      for (const s of [-1, 1]) cube(head, [.16, .18, .1], [s * .22, .24, -.05], '#d18e90');
      eyes(head, .18, .075, .243);
      cube(head, [.29, .19, .1], [0, -.075, .28], '#d08b8b');
      for (const s of [-1, 1]) cube(head, [.05, .065, .015], [s * .075, -.075, .337], '#9b6564');
      cube(group, [.12, .14, .1], [.05, .8, -.56], '#c88081');
    } else if (type === 'cow') {
      height = 1.72; width = .52;
      cube(group, [.86, .79, 1.23], [0, .94, 0], '#e1ddd0');
      for (const side of [-1, 1]) {
        cube(group, [.012, .49, .49], [side * .435, 1.07, -.24], '#50443a');
        cube(group, [.015, .32, .35], [side * .436, .78, .37], '#51483f');
      }
      cube(group, [.59, .02, .38], [-.06, 1.345, -.22], '#625244');
      for (const xx of [-.29, .29]) for (const zz of [-.43, .43]) legs.push(limb(xx, .64, zz, .19, .64, '#b4a899', '#4e463f'));
      head = new THREE.Group(); head.position.set(0, 1.25, .76); group.add(head);
      cube(head, [.5, .57, .5], [0, 0, 0], '#64564a');
      cube(head, [.29, .24, .02], [-.04, .1, .26], '#e1ddd1');
      eyes(head, .165, .08, .28);
      cube(head, [.45, .22, .12], [0, -.19, .28], '#b5a196');
      for (const s of [-1, 1]) {
        cube(head, [.065, .04, .018], [s * .12, -.19, .35], '#554b46');
        cube(head, [.1, .22, .1], [s * .22, .34, -.06], '#d6c7a4');
        cube(head, [.2, .1, .15], [s * .32, .12, -.07], '#857366');
      }
      cube(group, [.34, .12, .33], [0, .5, -.3], '#be9992');
      cube(group, [.06, .5, .07], [0, .82, -.66], '#69594b');
    } else {
      height = 1.92; width = .36;
      cube(group, [.56, .68, .3], [0, 1.08, 0], '#39928d');
      cube(group, [.53, .12, .31], [0, .8, 0], '#326f7e');
      head = new THREE.Group(); head.position.set(0, 1.66, 0); group.add(head);
      cube(head, [.49, .49, .49], [0, 0, 0], '#72925b');
      cube(head, [.2, .16, .014], [-.1, .12, .253], '#627c4d');
      for (const s of [-1, 1]) cube(head, [.115, .07, .025], [s * .135, .02, .26], '#2d3a2c');
      cube(head, [.19, .055, .02], [0, -.13, .26], '#415337');
      for (const s of [-1, 1]) {
        legs.push(limb(s * .15, .78, 0, .25, .78, '#494f8a', '#3e424e'));
        const arm = limb(s * .4, 1.34, 0, .22, .65, '#608855');
        cube(arm, [.23, .28, .23], [0, -.14, 0], '#39928d');
        arm.rotation.x = -Math.PI / 2;
        arms.push(arm);
      }
    }
    const shadow = new THREE.Mesh(this.shadowGeometry, this.shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.set(type === 'zombie' ? .8 : 1, type === 'zombie' ? .7 : 1.4, 1);
    shadow.position.y = .018;
    group.add(shadow);
    this.scene.add(group);
    const entity = {
      type, name: animalNames[type], group, head, legs, arms, materials, shadow, width, height,
      position: group.position, health: animalHealth[type], yaw: this.random() * TAU,
      targetYaw: this.random() * TAU, decision: this.random() * 3, moving: true,
      age: this.random() * 20, attackCooldown: 0, flash: 0, panic: 0, vy: 0, burning: 0,
      knockback: new THREE.Vector3(), grounded: true, skyCheck: 0, exposed: true,
    };
    group.rotation.y = entity.yaw;
    this.list.push(entity);
    return entity;
  }

  groundAt(x, z, referenceY = null) {
    const xi = Math.floor(x), zi = Math.floor(z);
    let top = referenceY == null ? this.world.getHeight(xi, zi) + 3 : Math.floor(referenceY) + 2;
    top = Math.min(94, top);
    const bottom = referenceY == null ? Math.max(0, top - 12) : Math.max(0, top - 10);
    for (let y = top; y >= bottom; y--) {
      const id = this.world.getBlock(xi, y, zi);
      if (id === B.WATER) return null;
      if (isSolid(id) && ![B.LEAVES, B.BIRCH_LEAVES, B.LOG, B.BIRCH_LOG, B.CACTUS].includes(id)) return y + 1;
    }
    return null;
  }

  findSpawn(player, minimum, maximum, type = 'cow') {
    for (let attempt = 0; attempt < 18; attempt++) {
      const angle = this.random() * TAU;
      const radius = minimum + this.random() * (maximum - minimum);
      const x = player.x + Math.cos(angle) * radius;
      const z = player.z + Math.sin(angle) * radius;
      const y = this.groundAt(x, z);
      if (y == null || y < 28 || y > 82) continue;
      // Check the whole body footprint, including heads; a clear centre alone can put a cow in a trunk.
      const halfWidth = type === 'zombie' ? .4 : .55;
      const halfLength = type === 'zombie' ? .45 : 1.05;
      let obstructed = false;
      for (let xx = Math.floor(x - halfWidth); xx <= Math.floor(x + halfWidth) && !obstructed; xx++) {
        for (let zz = Math.floor(z - halfLength); zz <= Math.floor(z + halfLength) && !obstructed; zz++) {
          for (let yy = Math.floor(y); yy <= Math.floor(y + 1.92); yy++) {
            const id = this.world.getBlock(xx, yy, zz);
            if (isSolid(id) || id === B.WATER) { obstructed = true; break; }
          }
        }
      }
      if (obstructed) continue;
      return { x, y, z };
    }
    return null;
  }

  spawnNear(player, type, minimum = 8, maximum = 28) {
    const spawn = this.findSpawn(player, minimum, maximum, type);
    if (spawn) return this.makeAnimal(type, spawn.x, spawn.y, spawn.z);
    return null;
  }

  canMove(entity, x, z) {
    const y = this.groundAt(x, z, entity.position.y);
    if (y == null || y - entity.position.y > 1.05 || entity.position.y - y > 2.5) return null;
    const radius = entity.width * .74;
    for (const dx of [-radius, radius]) for (const dz of [-radius, radius]) {
      const xi = Math.floor(x + dx), zi = Math.floor(z + dz);
      if (this.world.getBlock(xi, Math.floor(y), zi) === B.WATER) return null;
      for (let yy = Math.floor(y + .08); yy <= Math.floor(y + entity.height - .05); yy++) {
        if (isSolid(this.world.getBlock(xi, yy, zi))) return null;
      }
    }
    return y;
  }

  exposedToSky(entity, delta) {
    entity.skyCheck -= delta;
    if (entity.skyCheck > 0) return entity.exposed;
    entity.skyCheck = .5;
    entity.exposed = true;
    const x = Math.floor(entity.position.x), z = Math.floor(entity.position.z);
    for (let y = Math.floor(entity.position.y + entity.height); y < 96; y++) {
      if (isSolid(this.world.getBlock(x, y, z))) { entity.exposed = false; break; }
    }
    return entity.exposed;
  }

  update(dt, playerPosition, { mode = 'survival', daylight = 1, paused = false } = {}) {
    if (paused) return;
    const delta = Math.min(.05, Math.max(0, dt || 0));
    if (!delta || !playerPosition) return;
    this._player.copy(playerPosition);
    this.elapsed += delta;
    if (!this.initialized) {
      for (let i = 0; i < 9; i++) this.spawnNear(playerPosition, animalTypes[i % 3], i < 3 ? 5 : 12, i < 3 ? 13 : 35);
      this.initialized = true;
    }
    this.spawnTimer -= delta;
    if (this.spawnTimer <= 0) {
      this.spawnTimer = 7;
      const passive = this.list.filter(e => e.type !== 'zombie').length;
      const enemies = this.list.length - passive;
      if (passive < 9) this.spawnNear(playerPosition, animalTypes[Math.floor(this.random() * 3)], 18, 38);
      if (daylight < .18 && enemies < 4 && mode !== 'creative') this.spawnNear(playerPosition, 'zombie', 19, 32);
    }
    for (let i = this.list.length - 1; i >= 0; i--) {
      const entity = this.list[i];
      const position = entity.position;
      const dx = playerPosition.x - position.x, dz = playerPosition.z - position.z;
      const distance = Math.hypot(dx, dz);
      if (distance > 100 || position.y < -15) { this.remove(entity); continue; }
      entity.age += delta;
      entity.attackCooldown -= delta;
      entity.decision -= delta;
      entity.flash = Math.max(0, entity.flash - delta);
      entity.panic = Math.max(0, entity.panic - delta);
      const hostile = entity.type === 'zombie';
      if (hostile && daylight > .7 && this.exposedToSky(entity, delta)) {
        entity.burning += delta;
        if (entity.burning > 1) { entity.burning = 0; entity.health -= 2; entity.flash = .25; }
        if (entity.health <= 0) { this.remove(entity); continue; }
      } else entity.burning = 0;
      const chasing = hostile && mode !== 'creative' && distance < 30;
      if (chasing) {
        entity.targetYaw = Math.atan2(dx, dz);
        entity.moving = distance > 1.05;
        if (distance < 1.35 && Math.abs(playerPosition.y - (position.y + 1)) < 2 && entity.attackCooldown <= 0) {
          const eye = position.clone().add(new THREE.Vector3(0, 1.4, 0));
          const direction = playerPosition.clone ? playerPosition.clone().sub(eye) : new THREE.Vector3(playerPosition.x, playerPosition.y, playerPosition.z).sub(eye);
          const separation = direction.length();
          const wall = separation > 0 ? this.world.raycast(eye, direction.normalize(), separation) : null;
          if (!wall) { this.onDamage(3, '僵尸'); entity.attackCooldown = 1.3; }
        }
      } else if (entity.decision <= 0) {
        entity.decision = 2 + this.random() * 4;
        entity.targetYaw += (this.random() - .5) * 2.6;
        entity.moving = this.random() > .26;
      }
      if (entity.panic > 0) {
        entity.targetYaw = Math.atan2(-dx, -dz);
        entity.moving = true;
      }
      let angleDifference = ((entity.targetYaw - entity.yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
      entity.yaw += THREE.MathUtils.clamp(angleDifference, -delta * 3, delta * 3);
      entity.group.rotation.y = entity.yaw;
      const speed = entity.panic > 0 ? 3 : chasing ? 1.7 : hostile ? .65 : .65;
      let walking = false;
      if (entity.moving && distance < 72) {
        const nextX = position.x + Math.sin(entity.yaw) * speed * delta + entity.knockback.x * delta;
        const nextZ = position.z + Math.cos(entity.yaw) * speed * delta + entity.knockback.z * delta;
        const floor = this.canMove(entity, nextX, nextZ);
        if (floor != null) {
          position.x = nextX; position.z = nextZ;
          if (floor > position.y && floor - position.y < 1.1) position.y = floor;
          walking = true;
        } else {
          entity.targetYaw += Math.PI * (.65 + this.random() * .4);
          entity.decision = 1;
        }
      }
      entity.knockback.multiplyScalar(Math.exp(-delta * 9));
      // Gravity also applies when the player digs the supporting block away.
      const floor = this.groundAt(position.x, position.z, position.y);
      if (floor != null && floor <= position.y + .1) {
        if (position.y > floor + .03) {
          entity.vy -= delta * 20;
          position.y = Math.max(floor, position.y + entity.vy * delta);
          entity.grounded = false;
        } else { position.y = floor; entity.vy = 0; entity.grounded = true; }
      } else if (floor == null) {
        entity.vy -= delta * 20;
        position.y += entity.vy * delta;
        entity.grounded = false;
      }
      entity.shadow.visible = entity.grounded;
      const stride = walking ? Math.sin(entity.age * (entity.panic > 0 ? 15 : chasing ? 10 : 7)) * .48 : 0;
      entity.legs.forEach((leg, index) => { leg.rotation.x = stride * (index % 3 === 0 ? 1 : -1); });
      entity.arms.forEach((arm, index) => { arm.rotation.x = -Math.PI / 2 + Math.sin(entity.age * 3 + index) * .08; });
      if (!hostile) {
        entity.head.rotation.x = !walking ? .08 + Math.sin(entity.age * 1.7) * .08 : 0;
        entity.head.rotation.y = distance < 7 ? THREE.MathUtils.clamp(Math.atan2(dx, dz) - entity.yaw, -.4, .4) : Math.sin(entity.age * .7) * .08;
      }
      for (const material of entity.materials.values()) material.emissive.setRGB(entity.flash > 0 ? .65 : 0, entity.burning > .3 ? .08 : 0, 0);
    }
  }

  hit(origin, direction, reach = 4.5, damage = 1) {
    this.ray.set(origin, direction);
    let target = null, closest = reach;
    const wall = this.world.raycast(origin, direction, reach);
    if (wall) closest = Math.min(closest, wall.distance);
    for (const entity of this.list) {
      entity.group.updateMatrixWorld(true);
      this.inverseMatrix.copy(entity.group.matrixWorld).invert();
      this.localRay.copy(this.ray).applyMatrix4(this.inverseMatrix);
      this.hitBox.min.set(-entity.width, 0, entity.type === 'zombie' ? -.3 : -.67);
      this.hitBox.max.set(entity.width, entity.height, entity.type === 'zombie' ? .8 : 1.03);
      if (this.localRay.intersectBox(this.hitBox, this.hitPoint)) {
        this.hitPoint.applyMatrix4(entity.group.matrixWorld);
        const distance = this.hitPoint.distanceTo(origin);
        if (distance < closest) { closest = distance; target = entity; }
      }
    }
    if (!target) return false;
    target.health -= Math.max(1, Number(damage) || 1);
    target.flash = .22;
    target.panic = target.type === 'zombie' ? 0 : 3;
    target.knockback.copy(direction).multiplyScalar(4);
    target.knockback.y = 0;
    if (target.health <= 0) {
      const position = target.position.clone().add(new THREE.Vector3(0, .5, 0));
      if (target.type === 'sheep') { this.onDrop(B.WOOL, 1 + Math.floor(this.random() * 2), position); this.onDrop(118, 1, position); }
      if (target.type === 'pig') this.onDrop(111, 1 + Math.floor(this.random() * 3), position);
      if (target.type === 'cow') this.onDrop(116, 1 + Math.floor(this.random() * 3), position);
      if (target.type === 'zombie') this.onDrop(160, 1, position);
      this.remove(target);
    }
    return true;
  }

  remove(entity) {
    this.scene.remove(entity.group);
    for (const material of entity.materials.values()) material.dispose();
    const index = this.list.indexOf(entity);
    if (index >= 0) this.list.splice(index, 1);
  }
  serialize() { return this.list.map(entity => ({ type: entity.type, position: entity.position.toArray(), health: entity.health, yaw: entity.yaw })); }
  dispose() {
    for (const entity of [...this.list]) this.remove(entity);
    this.boxGeometry.dispose(); this.shadowGeometry.dispose(); this.shadowMaterial.dispose();
  }
}

/** A bounded pool of small textured-colour chips; it never adds per-particle draw calls. */
export class Particles {
  constructor(scene, capacity = 320) {
    this.scene = scene;
    this.capacity = capacity;
    this.cursor = 0;
    this.particles = Array.from({ length: capacity }, () => ({ active: false, position: new THREE.Vector3(), velocity: new THREE.Vector3(), life: 0, maxLife: 1, size: .1 }));
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff }), capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'block-debris';
    this.dummy = new THREE.Object3D();
    this.color = new THREE.Color();
    this.dummy.scale.setScalar(0);
    this.dummy.updateMatrix();
    for (let i = 0; i < capacity; i++) { this.mesh.setMatrixAt(i, this.dummy.matrix); this.mesh.setColorAt(i, this.color); }
    scene.add(this.mesh);
  }
  spawn(position, color, count, force = 1) {
    for (let i = 0; i < count; i++) {
      const index = this.cursor++ % this.capacity;
      const particle = this.particles[index];
      particle.active = true;
      particle.position.set(position.x + (Math.random() - .5) * .75, position.y + (Math.random() - .5) * .75, position.z + (Math.random() - .5) * .75);
      particle.velocity.set((Math.random() - .5) * 4 * force, Math.random() * 3 * force + .5, (Math.random() - .5) * 4 * force);
      particle.maxLife = particle.life = .45 + Math.random() * .55;
      particle.size = .06 + Math.random() * .10;
      this.color.set(color).multiplyScalar(.65 + Math.random() * .55);
      this.mesh.setColorAt(index, this.color);
    }
    this.mesh.instanceColor.needsUpdate = true;
  }
  spawnBreak(position, id) { this.spawn(position, BLOCKS[id]?.color || '#888888', 20); }
  spawnHit(position) { this.spawn(position, '#bd543d', 12, .7); }
  spawnExplosion(position) { this.spawn(position, '#8c8072', 80, 2.5); }
  update(dt) {
    const delta = Math.min(.05, Math.max(0, dt || 0));
    for (let i = 0; i < this.capacity; i++) {
      const p = this.particles[i];
      if (p.active) {
        p.life -= delta;
        if (p.life <= 0) p.active = false;
        p.velocity.y -= delta * 12;
        p.position.addScaledVector(p.velocity, delta);
        this.dummy.position.copy(p.position);
        this.dummy.rotation.set(p.life * 3, p.life * 2, p.life);
        this.dummy.scale.setScalar(p.active ? p.size * Math.min(1, p.life * 4) : 0);
      } else this.dummy.scale.setScalar(0);
      this.dummy.updateMatrix(); this.mesh.setMatrixAt(i, this.dummy.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  dispose() { this.scene.remove(this.mesh); this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
