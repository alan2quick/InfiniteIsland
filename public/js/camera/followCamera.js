// Original fixed-angle camera plus optional gently rotating behind-character follow. Both drag the sun's shadow
// frustum along with the player so shadows stay crisp.
//
//   const cam = new FollowCamera(camera, { sun });
//   cam.update(dt, focusPoint, zoomTarget = 1)   // snaps on the first call; zoomTarget scales the camera offset (multiplayer)
//   cam.zoomForSpread({ half, near, far })       // zoom factor that frames the players around the focus (half = half width, near / far =
//                                                // ground distance toward / away from the camera; PlayerManager.extent)
//   cam.zoomForExtent(extentX, extentZ)          // the same for a symmetric ground area
//   cam.resize(w, h)
// With several players the focus is their centroid and the offset distance grows up to CAMERA_MAX_ZOOM x (eased); the sun's shadow
// box grows with it. With zoomTarget = 1 (solo) nothing changes.
import * as THREE from 'three';
import { cameraSettings, chaseOffset, advanceChaseYaw, chasePositionRate, cameraRelativeMove, introEase } from './followMath.js';
import { CAMERA_OFFSET, CAMERA_FOLLOW_LERP, SHADOW_MAP_SIZE, CAMERA_MAX_ZOOM, CAMERA_ZOOM_MARGIN, CAMERA_ZOOM_LERP, CAMERA_FOV } from '../config.js';

const LOOK_UP = 0.9;             // look a little above the feet
const SHADOW_HALF = 26;          // half extent of the shadow box (52u wide, covers the visible ground)

export class FollowCamera {
  constructor(camera, { sun = null, offset = CAMERA_OFFSET, lerp = CAMERA_FOLLOW_LERP } = {}) {
    this.camera = camera;
    this.sun = sun;
    this.offset = new THREE.Vector3(offset.x, offset.y, offset.z);
    this.lerp = lerp;
    this.focus = new THREE.Vector3();       // smoothed look-at point
    this.enabled = true;
    this.zoom = 1;                          // current (smoothed) offset multiplier
    this.zoomTarget = 1;
    this._first = true;
    this._shadowZoom = 1;                   // quantised zoom the shadow box was last sized for
    this._shadowMap = sun ? (sun.shadow.mapSize.x || SHADOW_MAP_SIZE) : SHADOW_MAP_SIZE;
    this.settings = cameraSettings();
    this.subject = null;
    this.followActive = false;
    this._yaw = 0;
    this._yawMotion = { yaw: 0, velocity: 0 };
    this._movementYaw = null;
    this._chaseOffset = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._followPosition = new THREE.Vector3();
    this._resolved = new THREE.Vector3();
    this._intro = null;
    this._occlusion = null;
    this.touch = false;
    this.framingZoom = 1;
    this.regionBlend = 0;                   // Step 69c: 0..1 weight of regionCamera (Duskcrown's gentler camera); exactly 0 everywhere else = the old numbers bit for bit
    this.regionCamera = null;               // { offset: {x, y, z}, aim } blended in by regionBlend
    this._eff = new THREE.Vector3();
    this._shake = { amp: 0, t: 0, dur: 0 };   // additive camera offset that decays (see shake())

    if (sun) {
      this._sunOffset = sun.position.clone().sub(sun.target.position);
      this._lightDirection = this._sunOffset.clone().normalize();
      this._nextDirection = new THREE.Vector3();
      const sc = sun.shadow.camera;
      sc.left = -SHADOW_HALF; sc.right = SHADOW_HALF; sc.top = SHADOW_HALF; sc.bottom = -SHADOW_HALF;
      sc.updateProjectionMatrix();
      // Light-space basis used to snap the shadow frustum to whole shadow-map texels (no shimmering).
      const z = this._sunOffset.clone().normalize();
      this._lx = new THREE.Vector3(0, 1, 0).cross(z).normalize();
      this._ly = z.clone().cross(this._lx).normalize();
      this._texel = (SHADOW_HALF * 2) / this._shadowMap;
    }
  }

  /** Shared environment settings; original remains the default. Does not write player saves. */
  setSettings(settings) {
    const previous = this.settings;
    this.settings = cameraSettings(settings, previous);
    if (previous.mode !== this.settings.mode) this._movementYaw = null;
    if (!this.settings.intro) this.skipIntro();
    return { ...this.settings };
  }

  /** Call before input polling and camera update. Special areas and shared screens use the original view. */
  setSubject(player, { allowed = true, count = 1 } = {}) {
    const active = !!(player && Number.isFinite(player.facing) && allowed && count === 1 && this.settings.mode === 'follow' && this.enabled);
    if (active && (!this.followActive || player !== this.subject)) {
      this._yaw = this._yawMotion.yaw = player.facing;
      this._yawMotion.velocity = 0;
    }
    if (active !== this.followActive || player !== this.subject) this._movementYaw = null;
    this.subject = player;
    this.followActive = active;
    if (!allowed || count !== 1) this.skipIntro();
  }

  /** Mutates movement once per freshly polled frame. Keep a stable basis until release, avoiding chase-camera steering feedback. */
  transformMovement(move) {
    if (!this.followActive) { this._movementYaw = null; return move; }
    if (Math.hypot(move.x, move.z) < 0.001) { this._movementYaw = null; return move; }
    if (this._movementYaw === null) this._movementYaw = this._yaw;
    return cameraRelativeMove(move, this._movementYaw);
  }

  /** Optional collision adapter: (focus, desiredPosition, outputPosition) -> void. It must not mutate focus. */
  setOcclusionResolver(resolve) { this._occlusion = typeof resolve === 'function' ? resolve : null; }

  /** A brief opening only: never restarts on resize, settings edits or teleport. Caller supplies current island centre. */
  startIntro({ center = this.focus, height = 65, duration = 3 } = {}) {
    if (!this.settings.intro || !this.enabled || ![center.x, center.y, center.z].every(Number.isFinite)) return false;
    this._intro = {
      time: 0, duration: Math.max(0.5, Math.min(6, Number.isFinite(duration) ? duration : 3)),
      center: new THREE.Vector3(center.x, center.y, center.z),
      position: new THREE.Vector3(center.x, center.y + Math.max(25, Math.min(Number.isFinite(this.camera.far) ? this.camera.far * 0.8 : 600, Number.isFinite(height) ? height : 65)), center.z + 20),
    };
    return true;
  }
  skipIntro() { this._intro = null; }
  get introActive() { return !!this._intro; }
  get introDistance() {
    if (!this._intro) return 0;
    return (this._intro.time === 0 ? this._intro.position : this.camera.position).distanceTo(this.focus);
  }

  /** The offset in effect: `offset` itself while the region blend is 0, else eased towards regionCamera.offset by the blend. */
  effectiveOffset() {
    const w = this.regionBlend, rc = this.regionCamera;
    if (!(w > 0) || !rc) return this.offset;
    return this._eff.set(this.offset.x + (rc.offset.x - this.offset.x) * w, this.offset.y + (rc.offset.y - this.offset.y) * w, this.offset.z + (rc.offset.z - this.offset.z) * w);
  }

  /** Zoom factor (1..CAMERA_MAX_ZOOM) needed to keep a ground area of extentX x extentZ (plus a margin) in view, centred on the focus. */
  zoomForExtent(extentX, extentZ, margin = CAMERA_ZOOM_MARGIN, clamp = true) {
    return this.zoomForSpread({ half: extentX / 2, near: extentZ / 2, far: extentZ / 2 }, { margin, clamp });
  }

  /**
   * Zoom factor (1..CAMERA_MAX_ZOOM; `clamp` false: unclamped) that keeps everything within `half` sideways, `near` toward the camera and
   * `far` away from it (ground units from the focus, plus a margin) in view. The camera is tilted, so the half of the view BELOW the focus
   * covers much less ground than the half above it (dist * sin(fov/2) / sin(pitch +- fov/2)): each side is sized on its own, or a player
   * walking down-screen leaves the view while the zoom still thinks they fit.
   */
  zoomForSpread({ half = 0, near = 0, far = 0 }, { margin = CAMERA_ZOOM_MARGIN, clamp = true } = {}) {
    const off = this.effectiveOffset();
    const dist = off.length() * this.framingZoom;
    const fov2 = THREE.MathUtils.degToRad(this.camera.fov * 0.5);
    const pitch = Math.atan2(off.y, Math.hypot(off.x, off.z));
    const halfW = Math.tan(fov2) * dist * this.camera.aspect;                          // ground half width at zoom 1 (at the focus depth)
    const nearD = dist * Math.sin(fov2) / Math.max(0.2, Math.sin(pitch + fov2));       // ground visible below / above the focus at zoom 1
    const farD = pitch - fov2 > 0.05 ? dist * Math.sin(fov2) / Math.sin(pitch - fov2) : Infinity;
    const z = Math.max((half + margin) / halfW, (near + margin) / nearD, (far + margin) / farD);
    return clamp ? Math.min(CAMERA_MAX_ZOOM, Math.max(1, z)) : z;
  }

  /** Jump straight to the target on the next update (use after teleporting the player). */
  snap() { this._first = true; this._chaseFirst = true; this._movementYaw = null; this._yawMotion.velocity = 0; this.skipIntro(); }

  /** Tiny additive camera shake: `amount` world units of jitter that decays to 0 over `duration` s (stronger shakes win). */
  shake(amount = 0.08, duration = 0.2) {
    const s = this._shake;
    const cur = s.dur > 0 ? s.amp * Math.pow(Math.max(0, 1 - s.t / s.dur), 2) : 0;
    if (amount >= cur) { s.amp = amount; s.t = 0; s.dur = duration; }
  }

  update(dt, target, zoomTarget = 1) {
    const tx = target.x, ty = target.y + LOOK_UP, tz = target.z;
    if (this._first) {
      this.focus.set(tx, ty, tz);
      this.zoom = this.zoomTarget = zoomTarget;
      this._first = false;
    } else {
      this.zoomTarget = zoomTarget;
      this.zoom += (zoomTarget - this.zoom) * (1 - Math.exp(-CAMERA_ZOOM_LERP * dt));
      if (Math.abs(zoomTarget - this.zoom) < 0.002) this.zoom = zoomTarget;   // land exactly (solo framing stays bit-identical)
      const a = 1 - Math.exp(-this.lerp * dt);         // frame-rate independent
      this.focus.x += (tx - this.focus.x) * a;
      this.focus.z += (tz - this.focus.z) * a;
      this.focus.y += (ty - this.focus.y) * (1 - Math.exp(-this.lerp * 0.6 * dt));   // vertical eases a bit slower
    }
    if (this.enabled) {           // disabled in ?debug mode where OrbitControls owns the camera
      if (this.followActive) {
        const rate = chasePositionRate(this.settings.smoothness);
        advanceChaseYaw(this._yawMotion, this.subject.facing, dt, this.settings.smoothness);
        this._yaw = this._yawMotion.yaw;
        chaseOffset(this._yaw, this.settings, this._chaseOffset);
        this._desired.copy(this.focus).add(this._chaseOffset);
        if (this._occlusion) {
          this._resolved.copy(this._desired);
          this._occlusion(this.focus, this._desired, this._resolved);
          if ([this._resolved.x, this._resolved.y, this._resolved.z].every(Number.isFinite)) this._desired.copy(this._resolved);
        }
        const a = 1 - Math.exp(-rate * Math.max(0, dt));
        if (this._chaseFirst !== false || dt === 0) this._followPosition.copy(this._desired);
        else if (this._occlusion && this._desired.distanceToSquared(this.focus) < this._followPosition.distanceToSquared(this.focus)) this._followPosition.copy(this._desired);
        else this._followPosition.lerp(this._desired, a);
        this.camera.position.copy(this._followPosition);
        this._chaseFirst = false;
      } else {
        this._chaseFirst = true;
        this.camera.position.copy(this.focus).addScaledVector(this.effectiveOffset(), this.zoom * this.framingZoom);
      }
      // Aim slightly above the player so touch controls and the upper HUD leave a clear playable band.
      let aimLift = this.touch ? (this.camera.aspect < 0.8 ? 2.1 : 0.45) : 0;
      if (this.regionBlend > 0 && this.regionCamera) aimLift += this.regionCamera.aim * this.regionBlend;   // Duskcrown: aim a little higher so the caps come into frame
      if (this.followActive) aimLift = 0.35;
      if (this._intro) {
        const intro = this._intro;
        intro.time += Math.max(0, dt);
        const t = introEase(intro.time / intro.duration);
        this.camera.position.lerpVectors(intro.position, this.camera.position, t);
        this._desired.copy(intro.center).lerp(this.focus, t);
        this.camera.lookAt(this._desired.x, this._desired.y + aimLift, this._desired.z);
        if (t >= 1) this._intro = null;
      } else this.camera.lookAt(this.focus.x, this.focus.y + aimLift, this.focus.z);
      const sh = this._shake;
      if (sh.dur > 0) {
        sh.t += dt;
        if (sh.t >= sh.dur) { sh.dur = 0; sh.amp = 0; }
        else {
          const k = sh.amp * Math.pow(1 - sh.t / sh.dur, 2);
          const w = sh.t * 55;
          this.camera.position.x += Math.sin(w * 1.3) * k;
          this.camera.position.y += Math.sin(w * 1.9 + 1.7) * k * 0.8;
          this.camera.position.z += Math.cos(w * 1.1 + 0.4) * k * 0.6;
        }
      }
    }
    if (this.sun) this._updateSun();
  }

  _updateSun() {
    // The clock rotates the light before this update. Rebuild its texel-snapping basis in place.
    this._sunOffset.subVectors(this.sun.position, this.sun.target.position);
    this._nextDirection.copy(this._sunOffset).normalize();
    if (this._nextDirection.distanceToSquared(this._lightDirection) > 1e-16) {
      this._lightDirection.copy(this._nextDirection);
      this._lx.set(0, 1, 0).cross(this._lightDirection);
      if (this._lx.lengthSq() < 1e-10) this._lx.set(1, 0, 0);
      else this._lx.normalize();
      this._ly.crossVectors(this._lightDirection, this._lx).normalize();
    }
    // Shadow box grows with the zoom. The zoom is quantised (1/8 steps) so the box - and with it the texel grid used for
    // snapping - stays put while the camera is stable, instead of shimmering through a continuous resize.
    const zq = Math.ceil(this.zoom * this.framingZoom * 8 - 1e-3) / 8;
    if (zq !== this._shadowZoom) {
      this._shadowZoom = zq;
      const half = SHADOW_HALF * zq;
      const sc = this.sun.shadow.camera;
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.updateProjectionMatrix();
      this._texel = (half * 2) / this._shadowMap;
    }
    const f = this.focus;
    // Snap the light's target to the shadow texel grid in light space.
    const px = f.dot(this._lx), py = f.dot(this._ly);
    const sx = Math.round(px / this._texel) * this._texel;
    const sy = Math.round(py / this._texel) * this._texel;
    const t = this.sun.target.position;
    t.copy(f).addScaledVector(this._lx, sx - px).addScaledVector(this._ly, sy - py);
    this.sun.position.copy(t).add(this._sunOffset);
    this.sun.target.updateMatrixWorld();
  }

  /** Keep the shadow-texel snapping in sync after the sun's shadow map size changes (quality fallback). */
  setShadowMapSize(n) {
    this._shadowMap = n;
    this._texel = (SHADOW_HALF * this._shadowZoom * 2) / n;
  }

  resize(w, h) {
    if (!(w > 0 && h > 0)) return;      // a hidden / minimised window reports 0 x 0: a NaN aspect would poison the camera for good
    const aspect = w / h;
    this.camera.aspect = aspect;
    // Preserve the desktop horizontal field of view on tall touch screens.
    const base = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV * 0.5));
    const idealTan = this.touch && aspect < 16 / 9 ? base * (16 / 9) / aspect : base;
    const cappedTan = Math.min(idealTan, Math.tan(THREE.MathUtils.degToRad(50)));
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(cappedTan));
    this.framingZoom = idealTan / cappedTan;
    this.camera.updateProjectionMatrix();
  }
}
