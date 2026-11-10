import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp = THREE.MathUtils.clamp;
function randomFactory(seed) {
  let n = 2166136261;
  for (const c of String(seed)) n = Math.imul(n ^ c.charCodeAt(0), 16777619);
  return () => { n += 0x6D2B79F5; let t = n; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}

/** A camera-centred, fully procedural atmosphere. Time is a fraction of a 20-minute day. */
export class Environment {
  constructor(scene, { seed = 'mc', time = .28, day = 1, weather = 'clear' } = {}) {
    this.scene = scene;
    this.time = Number.isFinite(time) ? ((time % 1) + 1) % 1 : .28;
    this.day = Math.max(1, Math.floor(day || 1));
    this.weather = weather === 'rain' ? 'rain' : 'clear';
    this.daylight = 1;
    this.elapsed = 0;
    this.viewDistance = 120;
    this.group = new THREE.Group();
    this.group.name = 'procedural-atmosphere';
    scene.add(this.group);
    this.hemi = new THREE.HemisphereLight(0xc9e3ff, 0x66714a, 1.15);
    this.sunLight = new THREE.DirectionalLight(0xfff3da, 1.65);
    this.sunLight.position.set(70, 100, 40);
    this.group.add(this.hemi, this.sunLight, this.sunLight.target);

    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, depthTest: false,
      uniforms: {
        zenith: { value: new THREE.Color('#65a4e4') },
        horizon: { value: new THREE.Color('#c1dced') },
        sunset: { value: new THREE.Color('#ffab66') },
        sunDirection: { value: new THREE.Vector3(0, 1, 0) },
        dusk: { value: 0 },
      },
      vertexShader: 'varying vec3 vDirection; void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
      fragmentShader: `varying vec3 vDirection;
        uniform vec3 zenith; uniform vec3 horizon; uniform vec3 sunset;
        uniform vec3 sunDirection; uniform float dusk;
        void main(){
          vec3 direction=normalize(vDirection);
          float height=pow(max(direction.y,0.0),.48);
          vec3 color=mix(horizon,zenith,height);
          float glow=pow(max(dot(direction,normalize(vec3(sunDirection.x,.02,sunDirection.z))),0.0),8.0);
          color=mix(color,sunset,glow*dusk*pow(1.0-max(direction.y,0.0),5.0)*.7);
          gl_FragColor=vec4(color,1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(360, 24, 12), this.skyMaterial);
    this.sky.renderOrder = -100;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    const makeCelestial = (color, size) => {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, fog: false, depthWrite: false, toneMapped: false }));
      mesh.renderOrder = -80;
      this.group.add(mesh);
      return mesh;
    };
    this.sun = makeCelestial(0xfff5cf, 16);
    this.sunHalo = makeCelestial(0xffedb2, 23);
    this.sunHalo.material.transparent = true;
    this.sunHalo.material.opacity = .14;
    this.moon = makeCelestial(0xd9e5ed, 12);
    const craterMaterial = new THREE.MeshBasicMaterial({ color: 0xaabac6, fog: false, depthWrite: false, side: THREE.DoubleSide });
    for (const [x, y, size] of [[-2, 2, 3], [3, -2, 2], [-2, -3, 2], [3, 3, 1]]) {
      const crater = new THREE.Mesh(new THREE.PlaneGeometry(size, size), craterMaterial);
      crater.position.set(x, y, .03);
      this.moon.add(crater);
    }

    const random = randomFactory(seed);
    const stars = [];
    for (let i = 0; i < 550; i++) {
      const azimuth = random() * TAU;
      const y = random() * 2 - 1;
      const r = Math.sqrt(1 - y * y);
      stars.push(Math.cos(azimuth) * r * 260, y * 260, Math.sin(azimuth) * r * 260);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(stars, 3));
    this.stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ color: 0xf2f4ff, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false, toneMapped: false }));
    this.stars.renderOrder = -90;
    this.group.add(this.stars);

    this.cloudMaterial = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: .91, depthWrite: false });
    this.clouds = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.cloudMaterial, 100);
    this.clouds.name = 'block-clouds';
    this.clouds.frustumCulled = false;
    this.cloudData = [];
    this.dummy = new THREE.Object3D();
    for (let i = 0; i < 100; i++) this.cloudData.push({ x: (random() - .5) * 380, z: (random() - .5) * 380, w: 12 + Math.floor(random() * 5) * 4, d: 8 + Math.floor(random() * 4) * 4, y: 95 + (i % 3) * 4 });
    scene.add(this.clouds);

    this.rainPositions = new Float32Array(420 * 6);
    this.rainData = Array.from({ length: 420 }, () => ({ x: random() * 38 - 19, y: random() * 25, z: random() * 38 - 19, speed: 16 + random() * 8 }));
    const rainGeometry = new THREE.BufferGeometry();
    rainGeometry.setAttribute('position', new THREE.BufferAttribute(this.rainPositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.rain = new THREE.LineSegments(rainGeometry, new THREE.LineBasicMaterial({ color: 0xa5bccc, transparent: true, opacity: .5, depthWrite: false }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    scene.add(this.rain);
    scene.background = new THREE.Color(0xa6cee9);
    scene.fog = new THREE.Fog(0xa6cee9, 38, this.viewDistance);
    this._dayTop = new THREE.Color('#68a7e4');
    this._nightTop = new THREE.Color('#080f24');
    this._dayHorizon = new THREE.Color('#c0d8e7');
    this._nightHorizon = new THREE.Color('#19253b');
    this._rainColor = new THREE.Color('#6c7d87');
    this._waterColor = new THREE.Color('#285b89');
    this._direction = new THREE.Vector3();
    this.update(0, new THREE.Vector3());
  }

  setWeather(weather) { this.weather = weather === 'rain' ? 'rain' : 'clear'; }
  setViewDistance(distance) { this.viewDistance = Math.max(48, Number(distance) || 120); }

  update(dt, playerPosition, { underwater = false, paused = false } = {}) {
    const delta = Math.min(Math.max(0, dt || 0), .1);
    if (!paused) {
      this.elapsed += delta;
      this.time += delta / 1200;
      if (this.time >= 1) { this.day += Math.floor(this.time); this.time %= 1; }
    }
    const position = playerPosition || { x: 0, y: 40, z: 0 };
    this.group.position.copy(position);
    const angle = this.time * TAU;
    this._direction.set(Math.cos(angle), Math.sin(angle), .35 * Math.cos(angle)).normalize();
    const altitude = this._direction.y;
    this.daylight = THREE.MathUtils.smoothstep(altitude, -.14, .22);
    const rain = this.weather === 'rain';
    const daylight = this.daylight;
    const dusk = (1 - clamp(Math.abs(altitude) * 3.5, 0, 1)) * daylight;
    this.skyMaterial.uniforms.zenith.value.copy(this._nightTop).lerp(this._dayTop, daylight);
    this.skyMaterial.uniforms.horizon.value.copy(this._nightHorizon).lerp(this._dayHorizon, daylight);
    if (rain) {
      this.skyMaterial.uniforms.zenith.value.lerp(this._rainColor, .7);
      this.skyMaterial.uniforms.horizon.value.lerp(this._rainColor, .65);
    }
    this.skyMaterial.uniforms.dusk.value = dusk;
    this.skyMaterial.uniforms.sunDirection.value.copy(this._direction);
    this.sun.position.copy(this._direction).multiplyScalar(220);
    this.sun.lookAt(position.x, position.y, position.z);
    // lookAt takes world coordinates; force matrices current after moving the sky group.
    this.group.updateMatrixWorld(true);
    this.sun.lookAt(position.x, position.y, position.z);
    this.sunHalo.position.copy(this.sun.position);
    this.sunHalo.quaternion.copy(this.sun.quaternion);
    this.sun.visible = altitude > -.08;
    this.sunHalo.visible = this.sun.visible;
    this.sun.material.color.setHex(dusk > .55 ? 0xffb36c : 0xfff6d8);
    this.sun.material.opacity = rain ? .5 : 1;
    this.sun.material.transparent = rain;
    this.sunHalo.material.opacity = rain ? .03 : .13;
    this.moon.position.copy(this._direction).multiplyScalar(-220);
    this.moon.lookAt(position.x, position.y, position.z);
    this.moon.visible = altitude < .1;
    this.stars.material.opacity = (1 - daylight) * (rain ? .2 : .8);
    this.stars.rotation.z = this.time * TAU * .15;
    this.hemi.intensity = (.22 + daylight * 1.05) * (rain ? .8 : 1);
    this.hemi.color.setHex(daylight > .5 ? 0xc8e3ff : 0x7d91bb);
    this.hemi.groundColor.setHex(daylight > .5 ? 0x69734b : 0x333c54);
    this.sunLight.position.copy(this._direction).multiplyScalar(100);
    if (altitude < 0) this.sunLight.position.negate();
    this.sunLight.color.setHex(daylight < .2 ? 0x8faddb : dusk > .5 ? 0xffc18b : 0xfff5e2);
    this.sunLight.intensity = (.12 + daylight * 1.15) * (rain ? .5 : 1);
    const fog = this.scene.fog;
    if (fog) {
      fog.color.copy(underwater ? this._waterColor : this.skyMaterial.uniforms.horizon.value);
      fog.near = underwater ? 1 : this.viewDistance * (rain ? .12 : .38);
      fog.far = underwater ? 21 : this.viewDistance * (rain ? .8 : 1);
    }
    this.scene.background?.copy?.(this.skyMaterial.uniforms.horizon.value);
    this.cloudMaterial.color.setHex(rain ? 0xabb4bc : 0xffffff);
    const drift = this.elapsed * .7;
    for (let i = 0; i < this.cloudData.length; i++) {
      const cloud = this.cloudData[i];
      const x = ((cloud.x + drift - position.x + 570) % 380 + 380) % 380 - 190 + position.x;
      const z = ((cloud.z - position.z + 570) % 380 + 380) % 380 - 190 + position.z;
      this.dummy.position.set(x, cloud.y, z);
      this.dummy.scale.set(cloud.w, 2.5, cloud.d);
      this.dummy.updateMatrix();
      this.clouds.setMatrixAt(i, this.dummy.matrix);
    }
    this.clouds.instanceMatrix.needsUpdate = true;
    this.rain.visible = rain && !underwater;
    if (this.rain.visible) {
      this.rain.position.copy(position);
      for (let i = 0; i < this.rainData.length; i++) {
        const drop = this.rainData[i];
        if (!paused) drop.y -= delta * drop.speed;
        if (drop.y < -7) drop.y += 25;
        const k = i * 6;
        this.rainPositions[k] = drop.x;
        this.rainPositions[k + 1] = drop.y;
        this.rainPositions[k + 2] = drop.z;
        this.rainPositions[k + 3] = drop.x - .07;
        this.rainPositions[k + 4] = drop.y - .8;
        this.rainPositions[k + 5] = drop.z;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }
  }

  serialize() { return { time: this.time, day: this.day, weather: this.weather }; }
  dispose() {
    const geometries = new Set(), materials = new Set();
    for (const root of [this.group, this.clouds, this.rain]) {
      root.traverse(object => { if (object.geometry) geometries.add(object.geometry); if (object.material) materials.add(object.material); });
      this.scene.remove(root);
    }
    geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose());
  }
}
