// Ambient life: butterflies gliding around flower patches (by day), rare firefly gatherings over the meadow, pond and
// stream (by night), blossom petals drifting off cherry trees and occasional twinkling glints on the sea near the
// shore. Each is a single draw call (butterflies two), driven by one update(); butterflies are sparse across flower
// patches while petals favour nearby trees. `clock` (the DayNight) supplies `nightness` (0 day .. 1 night):
// butterflies fly off one by one as it gets dark and fireflies come out, and the reverse at dawn.
//
//   const amb = createAmbient({ scene, props, getHeight, clock });
//   amb.update(dt, t, player.position, camera, drawingBufferHeight)
//   amb.duskWeight = atmosphere.duskWeight  // canopy fireflies come out by day too; calm still suppresses caves / Frostpine
import * as THREE from 'three';
import { butterflyWingAngle, butterflySpeed } from './butterflyMotion.js';
import { fireflyGathering } from './fireflyGathering.js';
import { WATER_LEVEL, PALETTE } from '../config.js';
import { SPAWN, POND, STREAM_PATH } from '../world/terrain.js';

const TAU = Math.PI * 2;
const rnd = (a, b) => a + Math.random() * (b - a);

// =============================================================================================
// Butterflies
// =============================================================================================
const BUTTERFLY_COLORS = ['#ffb3d1', '#ffe27a', '#b8a4ff', '#8fe8ff', '#ffb98a', '#c7f0a0', '#ff9fb8', '#fff0f6'];

function wingGeometry() {
  // One wing in the XY plane (x = outwards, y = towards the head), rounded upper lobe + smaller lower lobe.
  const s = new THREE.Shape();
  s.moveTo(0, 0.02);
  s.bezierCurveTo(0.08, 0.4, 0.52, 0.62, 0.66, 0.3);
  s.bezierCurveTo(0.72, 0.1, 0.5, 0.0, 0.32, -0.05);
  s.bezierCurveTo(0.52, -0.16, 0.46, -0.52, 0.22, -0.44);
  s.bezierCurveTo(0.08, -0.38, 0.02, -0.18, 0, -0.04);
  const g = new THREE.ShapeGeometry(s, 6);
  g.rotateX(-Math.PI / 2);          // lie flat: head points to -Z, up is +Y
  return g;
}

class Butterflies {
  constructor(scene, centers, getHeight) {
    this.getHeight = getHeight;
    this.motion = 0.3;
    this.time = 0;
    this.wingTime = 0;
    const n = centers.length;
    this.n = n;
    const mat = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide });
    this.wings = new THREE.InstancedMesh(wingGeometry(), mat, n * 2);
    this.wings.name = 'butterfly-wings';
    this.wings.frustumCulled = false;
    this.wings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const bodyGeo = new THREE.CapsuleGeometry(0.055, 0.3, 2, 6);
    bodyGeo.rotateX(Math.PI / 2);
    this.bodies = new THREE.InstancedMesh(bodyGeo, new THREE.MeshBasicMaterial({ color: PALETTE.outline }), n);
    this.bodies.name = 'butterfly-bodies';
    this.bodies.frustumCulled = false;
    this.bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.Color();
    this.state = centers.map((c, i) => {
      col.set(BUTTERFLY_COLORS[i % BUTTERFLY_COLORS.length]);
      this.wings.setColorAt(i * 2, col);
      this.wings.setColorAt(i * 2 + 1, col);
      const partner = c.partner || c;
      return {
        a: c, b: partner,                                   // wander locally, not across the island through spawn
        mix: rnd(0, TAU), mixSpeed: rnd(0.03, 0.06),
        rx: rnd(1.8, 3.2), rz: rnd(1.6, 3.0),
        wx: rnd(0.55, 0.95), wz: rnd(0.5, 0.9), px: rnd(0, TAU), pz: rnd(0, TAU),
        hover: rnd(0.55, 0.9), hoverPh: rnd(0, TAU), flap: rnd(0, TAU), flapF: rnd(2.6, 3.6),
        size: rnd(0.95, 1.25) * 0.65,
        altitude: 0.7 + ((i * 0.61803398875) % 1) * 1.2,
        leaveAt: rnd(0.2, 0.55),                           // nightness at which this one heads home
        vis: -1,                                           // 1 = out and about, 0 = gone (-1 = not set yet)
        x: c.x, y: 1.5, z: c.z, yaw: rnd(0, TAU),
      };
    });
    if (this.wings.instanceColor) this.wings.instanceColor.needsUpdate = true;
    scene.add(this.wings, this.bodies);
    this._m = new THREE.Matrix4();
    this._base = new THREE.Matrix4();
    this._rz = new THREE.Matrix4();
    this._sc = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._one = new THREE.Vector3(1, 1, 1);
    this._yAxis = new THREE.Vector3(0, 1, 0);
  }

  setMotion(value) {
    const n = Number(value);
    if (Number.isFinite(n)) this.motion = THREE.MathUtils.clamp(n, 0, 1);
    return this.motion;
  }

  update(dt, t, night = 0) {
    // Integrate a local visual clock: changing speed never jumps a butterfly to a new position.
    this.time += Math.max(0, dt) * butterflySpeed(this.motion);
    // Wing beats use elapsed seconds, independent of the movement-speed setting.
    this.wingTime += Math.max(0, dt);
    t = this.time;
    const m = this._m, base = this._base;
    for (let i = 0; i < this.n; i++) {
      const s = this.state[i];
      // Dusk: each butterfly leaves at its own darkness level (rising and shrinking away); dawn brings it back.
      const want = night < s.leaveAt ? 1 : 0;
      s.vis = s.vis < 0 ? want : s.vis + Math.sign(want - s.vis) * Math.min(Math.abs(want - s.vis), dt * 0.45);
      if (s.vis <= 0.001) {
        this._sc.makeScale(0, 0, 0);
        this.bodies.setMatrixAt(i, this._sc);
        this.wings.setMatrixAt(i * 2, this._sc);
        this.wings.setMatrixAt(i * 2 + 1, this._sc);
        continue;
      }
      const away = 1 - s.vis;
      const k = 0.5 + 0.5 * Math.sin(s.mix + t * s.mixSpeed * TAU);
      const cx = s.a.x + (s.b.x - s.a.x) * k * 0.6, cz = s.a.z + (s.b.z - s.a.z) * k * 0.6;
      const tx = cx + s.rx * Math.sin(t * s.wx + s.px) + 0.35 * s.rx * Math.sin(t * s.wx * 2.7 + s.pz);
      const tz = cz + s.rz * Math.sin(t * s.wz + s.pz) + 0.35 * s.rz * Math.sin(t * s.wz * 2.3 + s.px);
      const dx = tx - s.x, dz = tz - s.z;
      s.x = tx; s.z = tz;
      // heading follows the motion (smoothed)
      if (dt > 0 && dx * dx + dz * dz > 1e-8) {
        const want = Math.atan2(-dx, -dz);
        let d = want - s.yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        s.yaw += d * Math.min(1, dt * 7);
      }
      s.flap += Math.max(0, dt) * TAU * s.flapF * butterflySpeed(this.motion);
      const ground = Math.max(this.getHeight(s.x, s.z), 0.3);
      // Different cruising heights and slow independent rises/dips; never bob at the rapid flap frequency.
      const y = ground + s.altitude + 0.18 * Math.sin(t * s.hover * 0.55 + s.hoverPh)
        + 0.1 * Math.sin(t * s.hover * 0.23 + s.pz) + away * away * 5;
      s.y = y;
      // body
      this._q.setFromAxisAngle(this._yAxis, s.yaw);
      this._p.set(s.x, y, s.z);
      base.compose(this._p, this._q, this._one);
      const size = s.size * (s.vis < 1 ? Math.sqrt(s.vis) : 1);
      m.copy(base).multiply(this._sc.makeScale(size, size, size));
      this.bodies.setMatrixAt(i, m);
      // Wings hinge on local Z. Rotate the opposite wing rather than negatively scaling an
      // instance (unsupported by InstancedMesh and prone to inconsistent face culling).
      const theta = butterflyWingAngle(this.wingTime, s.flap, s.px, this.motion);
      for (let w = 0; w < 2; w++) {
        const sgn = w === 0 ? 1 : -1;
        this._rz.makeRotationZ(sgn * theta + (w === 1 ? Math.PI : 0));
        m.copy(base).multiply(this._rz).multiply(this._sc.makeScale(size, size, size));
        this.wings.setMatrixAt(i * 2 + w, m);
      }
    }
    this.wings.instanceMatrix.needsUpdate = true;
    this.bodies.instanceMatrix.needsUpdate = true;
  }
}

// =============================================================================================
// Blossom petals drifting from cherry trees
// =============================================================================================
const PETAL_PINKS = ['#ffb3d1', '#ff8fbe', '#ffd6e7', '#fff0f6'];

function petalGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, -0.5);
  s.bezierCurveTo(0.42, -0.35, 0.5, 0.25, 0, 0.5);
  s.bezierCurveTo(-0.5, 0.25, -0.42, -0.35, 0, -0.5);
  return new THREE.ShapeGeometry(s, 4);
}

class Petals {
  constructor(scene, trees, count, getHeight) {
    this.trees = trees;
    this.n = count;
    this.getHeight = getHeight;
    this.mesh = new THREE.InstancedMesh(petalGeometry(), new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide }), count);
    this.mesh.name = 'drifting-petals';
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.Color();
    this.p = [];
    for (let i = 0; i < count; i++) {
      col.set(PETAL_PINKS[i % PETAL_PINKS.length]);
      this.mesh.setColorAt(i, col);
      this.p.push({ x: 0, y: -50, z: 0, vy: 0, rx: 0, ry: 0, rz: 0, sx: 0, sy: 0, sz: 0, ph: 0, size: 0, age: 0, life: 0, ground: 0, rest: 0 });
    }
    this.mesh.instanceColor.needsUpdate = true;
    scene.add(this.mesh);
    this._d = new THREE.Object3D();
    this._init = false;
  }

  _spawn(p, playerPos, initial) {
    // prefer trees near the player so the petals are in view; fall back to any cherry tree
    let tree = null;
    if (this.trees.length) {
      for (let tries = 0; tries < 8 && !tree; tries++) {
        const c = this.trees[(Math.random() * this.trees.length) | 0];
        if (!playerPos || Math.hypot(c.position.x - playerPos.x, c.position.z - playerPos.z) < 34) tree = c;
      }
      if (!tree) tree = this.trees[(Math.random() * this.trees.length) | 0];
    }
    if (!tree) { p.y = -50; return; }
    const s = tree.scale.x;
    const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * 2.1 * s;
    p.x = tree.position.x + Math.cos(a) * r;
    p.z = tree.position.z + Math.sin(a) * r;
    p.ground = this.getHeight(p.x, p.z);
    const top = tree.position.y + 3.4 * s, low = tree.position.y + 2.2 * s;
    p.y = initial ? p.ground + 0.1 + Math.random() * (top - p.ground) : rnd(low, top);
    p.vy = rnd(0.35, 0.75);
    p.rx = rnd(0, TAU); p.ry = rnd(0, TAU); p.rz = rnd(0, TAU);
    p.sx = rnd(-2.5, 2.5); p.sy = rnd(-2, 2); p.sz = rnd(-2.5, 2.5);
    p.ph = rnd(0, TAU);
    p.size = rnd(0.18, 0.28);
    p.age = 0;
    p.rest = 0;
  }

  update(dt, t, playerPos) {
    if (!this._init) { for (const p of this.p) this._spawn(p, playerPos, true); this._init = true; }
    const d = this._d;
    for (let i = 0; i < this.n; i++) {
      const p = this.p[i];
      if (p.rest > 0) {
        p.rest -= dt;
        if (p.rest <= 0) this._spawn(p, playerPos, false);
      } else {
        p.age += dt;
        // gentle wind drift + flutter, slow fall
        p.x += (0.55 + 0.45 * Math.sin(t * 0.7 + p.ph) + 0.25 * Math.sin(t * 2.3 + p.ph * 2)) * dt;
        p.z += (0.18 + 0.4 * Math.cos(t * 0.9 + p.ph * 1.3)) * dt;
        p.y -= p.vy * dt * (0.75 + 0.25 * Math.sin(t * 3 + p.ph));
        p.rx += p.sx * dt; p.ry += p.sy * dt; p.rz += p.sz * dt;
        if (p.y <= p.ground + 0.04) { p.y = p.ground + 0.04; p.rest = 0.9; p.rx = -Math.PI / 2 + Math.sin(p.ph) * 0.3; p.rz = 0; }
      }
      const fade = p.rest > 0 ? Math.max(0, p.rest / 0.9) : Math.min(1, p.age / 0.4);
      const sc = p.size * fade;
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(p.rx, p.ry, p.rz);
      d.scale.set(sc, sc, sc);
      d.updateMatrix();
      this.mesh.setMatrixAt(i, d.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// =============================================================================================
// Ocean glints: 4-point star sprites that twinkle near the shore
// =============================================================================================
const GLINT_VERT = /* glsl */`
attribute vec2 aParams;   // x = size (world), y = alpha
uniform float uScale;
varying float vAlpha;
void main() {
  vAlpha = aParams.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aParams.x * uScale / max(0.1, -mv.z);
}
`;
const GLINT_FRAG = /* glsl */`
varying float vAlpha;
uniform float uNight;
uniform float uWarmth;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float d = pow(abs(p.x), 0.5) + pow(abs(p.y), 0.5);
  float a = (1.0 - smoothstep(0.8, 1.0, d)) * vAlpha;
  if (a < 0.02) discard;
  vec3 warm = mix(vec3(1.0, 1.0, 0.92), vec3(1.0, 0.78, 0.38), uWarmth);
  vec3 col = mix(warm, vec3(0.63, 0.8, 1.0), uNight);
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}
`;

class Glints {
  constructor(scene, count, getHeight) {
    this.n = count;
    // candidate water spots near shores / the pond: shallow-ish water
    this.spots = [];
    for (let i = 0; i < 6000 && this.spots.length < 700; i++) {
      const x = rnd(-72, 72), z = rnd(-72, 72);
      const h = getHeight(x, z);
      if (h < -0.04 && h > -2.6) this.spots.push(x, z);
    }
    this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aPar = new THREE.BufferAttribute(new Float32Array(count * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('aParams', this.aPar);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uNight: { value: 0 }, uWarmth: { value: 0 } },
      vertexShader: GLINT_VERT, fragmentShader: GLINT_FRAG,
      transparent: true, depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.points.name = 'ocean-glints';
    scene.add(this.points);
    this.s = [];
    for (let i = 0; i < count; i++) this.s.push({ age: 0, life: 1, delay: rnd(0, 2.5), size: 0.4 });
  }

  _place(i, playerPos) {
    const sp = this.spots;
    if (!sp.length) return false;
    let x = 0, z = 0;
    for (let tries = 0; tries < 30; tries++) {
      const k = ((Math.random() * (sp.length / 2)) | 0) * 2;
      x = sp[k]; z = sp[k + 1];
      if (!playerPos || (Math.abs(x - playerPos.x) < 22 && z - playerPos.z > -12 && z - playerPos.z < 16)) break;   // roughly what the fixed camera sees
    }
    this.aPos.setXYZ(i, x + rnd(-1, 1), WATER_LEVEL + 0.1, z + rnd(-1, 1));
    return true;
  }

  update(dt, playerPos, camera, viewportHeightPx, night = 0, warmth = 0) {
    this.mat.uniforms.uNight.value = night;
    this.mat.uniforms.uWarmth.value = warmth;
    if (camera && viewportHeightPx) {
      this.mat.uniforms.uScale.value = viewportHeightPx / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    }
    for (let i = 0; i < this.n; i++) {
      const s = this.s[i];
      if (s.delay > 0) {
        s.delay -= dt;
        this.aPar.setXY(i, 0, 0);
        if (s.delay <= 0) {
          if (this._place(i, playerPos)) { s.age = 0; s.life = rnd(0.7, 1.3); s.size = rnd(0.4, 0.72); }
          else s.delay = 5;
        }
        continue;
      }
      s.age += dt;
      const u = s.age / s.life;
      if (u >= 1) { s.delay = rnd(0.4, 3.0); this.aPar.setXY(i, 0, 0); continue; }
      const tw = Math.sin(u * Math.PI);
      this.aPar.setXY(i, s.size * (0.4 + 0.6 * tw), 0.85 * tw * tw * (1 - night * 0.55));
    }
    this.aPos.needsUpdate = true;
    this.aPar.needsUpdate = true;
  }
}

// =============================================================================================
// Fireflies: rare small gatherings around vegetation, water and campsite anchors, with long quiet gaps.
// =============================================================================================
const FIREFLY_VERT = /* glsl */`
attribute vec2 aParams;   // x = size (world), y = glow 0..1
attribute float aWarm;
uniform float uScale;
varying float vGlow;
varying float vWarm;
void main() {
  vGlow = aParams.y;
  vWarm = aWarm;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aParams.x * uScale / max(0.1, -mv.z);
}
`;
const FIREFLY_FRAG = /* glsl */`
uniform float uDusk;
varying float vGlow;
varying float vWarm;
void main() {
  float d = length(gl_PointCoord * 2.0 - 1.0);
  float core = 1.0 - smoothstep(0.08, 0.3, d);            // bright little body
  float halo = pow(max(0.0, 1.0 - d), 2.0) * 0.45;         // soft glow around it
  float a = (core + halo) * vGlow;
  if (a < 0.01) discard;
  vec3 col = mix(vec3(1.0, 0.74, 0.32), vec3(1.0, 0.94, 0.65), vWarm);
  col = mix(col, vec3(1.0, 0.96, 0.78), core * 0.35);
  gl_FragColor = vec4(col * a, a);
  #include <colorspace_fragment>
}
`;

class Fireflies {
  constructor(scene, count, anchors, getHeight) {
    count = Math.min(6, Math.max(0, Math.floor(count)));
    this.n = count;
    this.time = 0;
    this.gathering = -1;
    this.anchor = null;
    this.anchors = anchors;
    this.getHeight = getHeight;
    this.gardenSpots = null;            // Optional bloom anchors join the same rare gathering.
    this.geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(count * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aPar = new THREE.BufferAttribute(new Float32Array(count * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.aPos);
    this.geo.setAttribute('aParams', this.aPar);
    this.geo.setAttribute('aWarm', new THREE.BufferAttribute(Float32Array.from({ length: count }, (_, i) => (i * 0.618) % 1), 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 600 }, uDusk: { value: 0 } },
      vertexShader: FIREFLY_VERT, fragmentShader: FIREFLY_FRAG,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.points.name = 'fireflies';
    this.points.visible = false;
    scene.add(this.points);
    this.s = [];
    for (let i = 0; i < count; i++) {
      this.s.push({
        ax: 0, az: 0, placed: false,
        appearAt: rnd(0.55, 0.7),                 // nightness at which this one lights up
        vis: 0,
        wx: rnd(0.25, 0.5), wz: rnd(0.2, 0.45), px: rnd(0, TAU), pz: rnd(0, TAU), r: rnd(0.35, 1.1),
        hy: rnd(0.35, 1.1), hw: rnd(0.4, 0.9), hp: rnd(0, TAU),
        period: rnd(2.2, 4.4), phase: rnd(0, 1), size: rnd(0.16, 0.23),
      });
    }
  }

  // Roughly the ground the fixed camera sees around the players (it looks from +z toward -z).
  static inView(x, z, focus, margin = 0) {
    const dx = x - focus.x, dz = z - focus.z;
    return Math.abs(dx) < 11 + margin && dz > -13 - margin && dz < 8 + margin;
  }

  _anchor(f, focus) {
    if (!this.anchor) return;
    f.ax = this.anchor.x + rnd(-0.6, 0.6);
    f.az = this.anchor.z + rnd(-0.6, 0.6);
    f.placed = true;
  }

  update(dt, t, night, focus, camera, viewportHeightPx, calm = false) {
    this.time += Math.max(0, Number.isFinite(dt) ? dt : 0);
    t = this.time;
    const gathering = fireflyGathering(t);
    if (gathering.index !== this.gathering) {
      this.gathering = gathering.index;
      const candidates = [...this.anchors, ...(this.gardenSpots?.() || [])].filter((a) => !focus || Fireflies.inView(a.x, a.z, focus));
      this.anchor = candidates.length ? candidates[Math.max(0, gathering.index) % candidates.length] : null;
      for (const f of this.s) { f.placed = false; f.vis = 0; this._anchor(f, focus); }
    }
    if ((night <= 0.3 || calm || gathering.glow === 0 || !this.anchor) && !this.points.visible) return;
    if (camera && viewportHeightPx) {
      this.mat.uniforms.uScale.value = viewportHeightPx / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    }
    let any = false;
    for (let i = 0; i < this.n; i++) {
      const f = this.s[i];
      const want = night >= f.appearAt && !calm && i < gathering.count && this.anchor ? 1 : 0;
      f.vis += Math.sign(want - f.vis) * Math.min(Math.abs(want - f.vis), dt * 0.35);
      // A low, continuous breathing twinkle; the gathering envelope supplies long quiet gaps.
      const u = ((t / f.period + f.phase) % 1 + 1) % 1;
      const blink = 0.65 + 0.35 * Math.sin(u * TAU);
      // Each group stays around its chosen clearing for its whole appearance.
      if (!f.placed) this._anchor(f, focus);
      const x = f.ax + f.r * Math.sin(t * f.wx + f.px) + 0.4 * Math.sin(t * f.wx * 2.3 + f.pz);
      const z = f.az + f.r * Math.sin(t * f.wz + f.pz) + 0.4 * Math.sin(t * f.wz * 1.9 + f.px);
      const y = Math.max(this.getHeight(x, z), WATER_LEVEL) + 0.3 + f.hy * (0.6 + 0.4 * Math.sin(t * f.hw + f.hp));
      this.aPos.setXYZ(i, x, y, z);
      const glow = f.vis * gathering.glow * blink * 0.18;
      this.aPar.setXY(i, f.size * (0.6 + 0.4 * blink), glow);
      if (glow > 0.01) any = true;
    }
    this.points.visible = any;
    this.aPos.needsUpdate = true;
    this.aPar.needsUpdate = true;
  }
}

// =============================================================================================
export function createAmbient({ scene, props, getHeight, clock = null, campfire = null, butterflies = 5, petals = 64, glints = 42, fireflies = 6 }) {
  // Farthest-point sampling spreads a few homes across the flowers, without
  // doubling up at the starting campfire or consuming the world's seeded RNG.
  const flowers = (props.handles.flowers && props.handles.flowers.list) || [];
  const outsideCamp = flowers.filter((f) => Math.hypot(f.x - SPAWN.x, f.z - SPAWN.z) >= 14);
  const candidates = outsideCamp.length ? outsideCamp : flowers;
  const homes = [];
  while (homes.length < butterflies && homes.length < candidates.length) {
    let best = null, bestDistance = -1;
    for (const f of candidates) {
      const distance = homes.length ? Math.min(...homes.map((h) => Math.hypot(h.x - f.x, h.z - f.z)))
        : Math.hypot(f.x - SPAWN.x, f.z - SPAWN.z);
      if (distance > bestDistance) { best = f; bestDistance = distance; }
    }
    if (!best || (homes.length && bestDistance < 14)) break;
    let partner = best, nearest = 8;
    for (const f of flowers) {
      const distance = Math.hypot(f.x - best.x, f.z - best.z);
      if (distance > 0.5 && distance < nearest) { nearest = distance; partner = f; }
    }
    homes.push({ x: best.x, z: best.z, partner: { x: partner.x, z: partner.z } });
  }

  const bf = new Butterflies(scene, homes, getHeight);
  const cherries = props.handles.trees.filter((g) => g.userData.cherry);
  const pt = new Petals(scene, cherries, cherries.length ? petals : 1, getHeight);
  const gl = new Glints(scene, glints, getHeight);

  // Land vegetation and campsite haunts, with occasional waterside gatherings.
  const haunts = flowers.filter((_, i) => i % 3 === 0).map((f) => ({ x: f.x, z: f.z }));
  for (const item of [...props.handles.trees, ...(props.handles.bushes || [])]) {
    if (item.position) haunts.push({ x: item.position.x, z: item.position.z });
  }
  for (let a = 0; a < TAU; a += TAU / 10) haunts.push({ x: POND.x + Math.cos(a) * (POND.rx + 1.5), z: POND.z + Math.sin(a) * (POND.rz + 1.5) });
  for (let i = 0; i < STREAM_PATH.length; i += 4) haunts.push({ x: STREAM_PATH[i].x + 1.8, z: STREAM_PATH[i].z });
  if (campfire) for (let k = 0; k < 4; k++) haunts.push({ x: campfire.x + 3.5, z: campfire.z + 1.5 * k - 2 });
  const ff = new Fireflies(scene, fireflies, haunts, getHeight);

  return {
    butterflies: bf, petals: pt, glints: gl, fireflies: ff,
    setButterflyMotion(value) { return bf.setMotion(value); },
    setFireflyAnchors(anchors) {
      for (const a of anchors || []) if (Number.isFinite(a.x) && Number.isFinite(a.z)) ff.anchors.push({ x: a.x, z: a.z });
    },
    setClock(value) { clock = value; },
    /** Step 29a: set true while the view is on Frostpine: no fireflies there (butterflies / petals live at home's flower patches and cherry trees anyway). */
    calm: false, duskWeight: 0,
    update(dt, t, playerPos, camera, viewportHeightPx) {
      const night = clock ? clock.nightness : 0;
      bf.update(dt, t, night);
      pt.update(dt, t, playerPos);
      gl.update(dt, playerPos, camera, viewportHeightPx, night, clock ? clock.look.warmth : 0);
      ff.mat.uniforms.uDusk.value = this.duskWeight;
      ff.update(dt, t, Math.max(night, this.duskWeight), playerPos, camera, viewportHeightPx, this.calm);
    },
  };
}
