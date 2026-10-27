// Hop courses (PLAN Step 68a): short, easy Jump-button courses where the player has REAL heights. Pure rules (no three.js), Node-tested in test/hop.test.js.
//
// In the 3D game Jump is only a visual `_hopY` rig offset: movement, collision and terrain treat the player as on the ground. A hop course is a zone (a circle) holding PADS (stepping stones, stumps,
// platforms, lava crusts); only while the player stands inside a zone does player.js use the body below, everywhere else its code path is untouched.
//
//   COURSE   { id, zone: {x, z, r}, gapY, splashY?, pads: [PAD], links: [{a, b, optional?, wait?}], start: padId, goal: padId, route?: [padId...], hazard?: {x,z,r}, backDown?, approach?: {from:{x,z,y},to:{x,z,y},width} (route: next-pad glint; wait: time a sinking link from its still rest rock) }
//   PAD      { id, kind: 'rock' | 'stump' | 'bamboo' | 'crust' | 'wet' | 'deck' | 'floe', x, z, r | (w, d, rot), top, cp?: true (a checkpoint), motion?: MOTION }
//   MOTION   { kind: 'sway', axis: [ax, az], amp, period, phase } | { kind: 'sink', period, phase, down, warn } | { kind: 'bob', amp, period, phase }  (pure functions of the SHARED clock, never saved or hashed)
//   Step 74d motions: {kind:'drift',amp,depth?,period,phase?} (closed ellipse), {kind:'spin',period,phase?}, {kind:'tilt',period}; pad.load = replicated {x,z,sink}.
//   Floe padPos also returns rot/pitch/roll; padTop(pad,pose,x,z) answers the tilted top. Moving floes disable the landing magnet.
//   Terrain `T` = { height(x, z) }: a cell whose terrain is lower than `course.gapY` is a GAP (water / lava): you may cross it only in the air, landing in it is a splash.
//
//   hopEvents                        presentation hooks (see below) the course runtime sets
//   setHopClock(fn) / hopTime()      the shared host clock in seconds (main.js: sync.hostNow() / 1000); setHopTerrain(T)
//   registerCourse(c) / courseAt(x, z) / courses() / clearCourses()    the registry the player integration asks
//   padPos(pad, t) -> {x, z, top, tremble, sunk}     where a pad is at time t
//   padsAt(course, x, z, t, extra = 0) -> [{pad, ...padPos}]   pads whose top covers (x, z) (+ `extra` u around the rim)
//   surfaceAt(course, x, z, t, fromY, T) -> {y, pad}   the highest pad top under the feet at or below fromY + STEP, else the terrain (a gap = y -Infinity)
//   surfaceY(...) = surfaceAt(...).y;  blocks(course, x, z, footY, t) a pad side taller than STEP above the feet is a wall;  gapAt(course, x, z, T)
//   stepHop(body, input, course, t, dt, T, opts) -> events   the vertical body: the same hop / fall numbers as player.js (HOP_SPEED 5.6, GRAVITY 24); body = {x, z, y, vy, grounded, pad, glide?}; input = {jump, glide?} (held Jump caps an armed sail descent; landing clears glide)
//   catchFall(course, cb, x, z, y, glided) -> checkpoint pad id | null   Step 68e's gentle catch: a LANDING (not on the slide / stairs, not a glide) more than HOP_COURSE.catchDepth below the last checkpoint pad inside the zone pops the player back onto it (the start checkpoint never catches: it is a step above the ground)
//   validateCourse(course, T, opts = {jumpScale:1,speedScale:1}) -> {ok, errors, links}   a bot flies the REAL step along every link at 24 start times across the motions' period, with margins and wet braking; wait links must have a real open window within one period
import { rideFloe } from './iceLogic.js';
import { HOP_COURSE as H, PLAYER_SPEED, PLAYER_DAMPING, PLAYER_HEIGHT, ICE } from '../config.js';

const TAU = Math.PI * 2;
const frac = (v) => v - Math.floor(v);
/** Presentation hooks the course runtime (world/hopCourses.js) fills: onJump(player), onLand(player, impact), onSplash(player, delayS), onRespawn(player), onCatch(player, from {x, y, z}) (the soft poof of a catch: no splash). Called by player.js for LOCAL players only. */
export const hopEvents = { onJump: null, onLand: null, onSplash: null, onRespawn: null, onCatch: null };
export const HOP = { speed: H.hopSpeed, gravity: H.gravity, step: H.step };

let clock = () => 0;
let terrainSource = { height: () => 0 };
const registry = [];
export function setHopClock(fn) { clock = typeof fn === 'function' ? fn : () => 0; }
export const hopTime = () => clock();
export function setHopTerrain(T) { terrainSource = T; }
export function registerCourse(c) { if (!registry.includes(c)) registry.push(c); return c; }
export function unregisterCourse(c) { const i = registry.indexOf(c); if (i >= 0) registry.splice(i, 1); }
export function clearCourses() { registry.length = 0; }
export const courses = () => registry;
export function courseAt(x, z) {
  // A repair deck can overlap the tutorial zone; ties keep the original first-course choice.
  let found = null;
  for (let i = 0; i < registry.length; i++) {
    const z0 = registry[i].zone;
    const dx = x - z0.x, dz = z - z0.z;
    if (dx * dx + dz * dz <= z0.r * z0.r && (!found || (registry[i].priority || 0) > (found.priority || 0))) found = registry[i];
  }
  return found;
}

// ---------------------------------------------------------------------------------------------
// Pads and their motions
// ---------------------------------------------------------------------------------------------
const _pp = { x: 0, z: 0, top: 0, tremble: false, sunk: false };
/** Where a pad is at time t (a shared object: copy what you keep). */
export function padPos(pad, t, out = _pp) {
  out.x = pad.x; out.z = pad.z; out.top = pad.top; out.tremble = false; out.sunk = false;
  out.rot = pad.rot || 0; out.pitch = 0; out.roll = 0;
  const m = pad.motion;
  if (!m) return out;
  if (m.kind === 'drift') {
    // A closed ellipse, phase-locked to the shared host clock.
    const a = TAU * (t / m.period + (m.phase || 0));
    out.x += Math.cos(a) * m.amp; out.z += Math.sin(a) * (m.depth ?? m.amp);
  } else if (m.kind === 'spin') {
    out.rot += TAU * (t / m.period + (m.phase || 0));
  } else if (m.kind === 'tilt') {
    const l = pad.load || { x: 0, z: 0, sink: 0 };
    out.pitch = l.z; out.roll = -l.x; out.top -= l.sink;
  } else if (m.kind === 'sway') {
    const o = m.amp * Math.sin(TAU * (t / m.period + (m.phase || 0)));
    out.x += (m.axis ? m.axis[0] : 1) * o; out.z += (m.axis ? m.axis[1] : 0) * o;
  } else if (m.kind === 'bob') {
    out.top += m.amp * Math.sin(TAU * (t / m.period + (m.phase || 0)));
  } else if (m.kind === 'sink') {
    // up [0, .5), sinking [.5, .6), under [.6, .85), rising [.85, 1); the warning tremble is the last `warn` s before it sinks
    const u = frac(t / m.period + (m.phase || 0));
    let k = 0;                                                       // 0 = up, 1 = fully under
    if (u >= 0.5 && u < 0.6) k = (u - 0.5) / 0.1;
    else if (u >= 0.6 && u < 0.85) k = 1;
    else if (u >= 0.85) k = 1 - (u - 0.85) / 0.15;
    k = k * k * (3 - 2 * k);
    out.top -= m.down * k;
    out.sunk = k > 0.5;
    out.tremble = u < 0.5 && u >= 0.5 - (m.warn || 0) / m.period;
  }
  return out;
}

// Floe top follows its host-counted load, including the side the player stands on.
export function padTop(pad, pose, x, z) {
  return pose.top + (x - pose.x) * Math.sin(pose.roll || 0) - (z - pose.z) * Math.sin(pose.pitch || 0);
}
function inPad(pad, px, pz, x, z, extra, rot = pad.rot || 0) {
  if (pad.r !== undefined) { const dx = x - px, dz = z - pz, rr = pad.r + extra; return dx * dx + dz * dz <= rr * rr; }
  const c = Math.cos(rot), s = Math.sin(rot), dx = x - px, dz = z - pz;
  return Math.abs(dx * c + dz * s) <= pad.w / 2 + extra && Math.abs(-dx * s + dz * c) <= pad.d / 2 + extra;
}
const padRadius = (pad) => (pad.r !== undefined ? pad.r : Math.min(pad.w, pad.d) / 2);

export function padsAt(course, x, z, t, extra = 0) {
  const out = [];
  for (const pad of course.pads) {
    const p = padPos(pad, t);
    if (inPad(pad, p.x, p.z, x, z, extra, p.rot)) out.push({ pad, x: p.x, z: p.z, top: p.top, tremble: p.tremble, sunk: p.sunk });
  }
  return out;
}

/** Highest pad top under (x, z) at or below fromY + STEP, else the terrain; a gap cell has y = -Infinity. */
export function surfaceAt(course, x, z, t, fromY, T = terrainSource) {
  let best = -Infinity, id = null;
  const lim = fromY + HOP.step + 1e-9;
  for (const pad of course.pads) {
    const p = padPos(pad, t);
    if (p.sunk || (course.hazard?.kind === 'lava' && p.top <= course.hazard.y) || p.top <= best || p.top > lim || !inPad(pad, p.x, p.z, x, z, 0, p.rot)) continue;
    best = pad.kind === 'floe' ? padTop(pad, p, x, z) : p.top; id = pad.id;
  }
  const ramp = backDownY(course, x, z);
  if (ramp !== null && ramp <= lim && ramp > best) { best = ramp; id = null; }
  const h = hazardAt(course, x, z) ? -Infinity : T.height(x, z);
  if (h >= course.gapY && h > best && h <= lim) { best = h; id = null; }
  return { y: best, pad: id };
}
export const surfaceY = (course, x, z, t, fromY, T = terrainSource) => surfaceAt(course, x, z, t, fromY, T).y;

/** A pad side taller than STEP above the feet is a wall. */
export function blocks(course, x, z, footY, t) {
  const ramp = backDownY(course, x, z);
  // The return ramp joins the top through its rim and bridges lower columns.
  // Its continuous floor takes precedence over those columns' side walls.
  if (ramp !== null && Math.abs(footY - ramp) <= HOP.step + 1e-9) return false;
  const lim = footY + HOP.step + 1e-9;
  for (const pad of course.pads) {
    const p = padPos(pad, t);
    if (!p.sunk && (pad.base === undefined || pad.base + p.top - pad.top <= footY + PLAYER_HEIGHT) && p.top > lim && inPad(pad, p.x, p.z, x, z, 0, p.rot)) return true;
  }
  return false;
}
/** Height on the narrow return or approach ramp; a continuous slope avoids extra hop pads. */
export function backDownY(course, x, z) {
  let best = null;
  for (const r of [course.backDown, course.approach]) {
    if (!r) continue;
    const dx = r.to.x - r.from.x, dz = r.to.z - r.from.z, d2 = dx * dx + dz * dz;
    const u = ((x - r.from.x) * dx + (z - r.from.z) * dz) / d2;
    if (u < 0 || u > 1 || Math.abs((x - r.from.x) * dz - (z - r.from.z) * dx) / Math.sqrt(d2) > r.width / 2) continue;
    const y = r.from.y + (r.to.y - r.from.y) * u;
    if (best === null || y > best) best = y;
  }
  return best;
}
/**
 * The gentle catch (Step 68e): after a landing at (x, z, y) with the body `cb` (cb.checkpoint = the last checkpoint pad touched), the id of the checkpoint to pop back to, or null.
 * Never for a glide (the sail's way down), the slide / stairs (their own continuous floor), outside the zone, or when the checkpoint is the start (a step above the ground: just walk on).
 */
export function catchFall(course, cb, x, z, y, glided = false) {
  if (glided || !course || !cb || !cb.checkpoint || cb.checkpoint === course.start) return null;
  const zn = course.zone;
  if (Math.hypot(x - zn.x, z - zn.z) > zn.r) return null;
  const ramp = backDownY(course, x, z);
  if (ramp !== null && Math.abs(y - ramp) <= HOP.step + 0.1) return null;
  const cp = course.pads.find((q) => q.id === cb.checkpoint);
  return cp && cp.top - y > H.catchDepth ? cp.id : null;
}
// A local lava basin masks the existing terrain; seeded terrain and placement stay untouched.
export const hazardAt = (course, x, z) => !!course.hazard && Math.hypot(x - course.hazard.x, z - course.hazard.z) < course.hazard.r;
export const gapAt = (course, x, z, T = terrainSource) => hazardAt(course, x, z) || T.height(x, z) < course.gapY;
export const splashY = (course) => (course.splashY !== undefined ? course.splashY : course.gapY - H.splash.sink);

// ---------------------------------------------------------------------------------------------
// The vertical body
// ---------------------------------------------------------------------------------------------
/**
 * Advance the body one frame (the caller moved x, z already). Returns events: { jumped, landed (impact speed), splash, shift: {x, z} (the landing magnet) }.
 * Same numbers as player.js: velocity first, then position (semi-implicit Euler), apex 0.65 u, airtime 0.47 s.
 */
export function stepHop(body, input, course, t, dt, T = terrainSource, opts = {}) {
  const ev = {};
  if (input && input.jump && body.grounded) { body.vy = HOP.speed * (opts.jumpScale ?? 1); body.grounded = false; ev.jumped = true; }
  if (body.grounded) {
    const s = surfaceAt(course, body.x, body.z, t, body.y, T);
    if (s.y >= body.y - 0.08) { body.y = s.y; body.pad = s.pad; return ev; }    // standing (a pad that rises or sinks a little carries the feet)
    body.grounded = false; body.vy = 0; body.pad = null;                        // walked off an edge
  }
  body.vy -= HOP.gravity * dt;
  if (body.glide && input?.glide) body.vy = Math.max(body.vy, -H.glideFallSpeed);
  const ny = body.y + body.vy * dt;
  let s = surfaceAt(course, body.x, body.z, t, body.y, T);
  const magnet = opts.magnet === undefined ? H.assists.magnet : opts.magnet;
  if (body.vy <= 0 && magnet > 0 && s.y < ny) {                                  // the landing magnet: feet come down just outside a pad's rim
    const near = nearestPad(course, body.x, body.z, t, magnet, body.y);
    if (near && body.y > near.top + 0.02 && ny <= near.top + 1e-9) {                 // (only when coming DOWN onto it from above: walking off an edge is not pulled back)

      ev.shift = { x: near.sx - body.x, z: near.sz - body.z };
      body.x = near.sx; body.z = near.sz;
      s = { y: near.top, pad: near.pad.id };
    }
  }
  if (body.vy <= 0 && ny <= s.y) {
    ev.landed = -body.vy; body.glide = false; body.y = s.y; body.vy = 0; body.grounded = true; body.pad = s.pad;
    return ev;
  }
  body.y = ny; body.pad = null;
  if (ny < splashY(course) && s.y === -Infinity) ev.splash = true;
  return ev;
}

// the pad whose rim is within `magnet` of (x, z): the point 0.05 u inside its rim toward the feet
function nearestPad(course, x, z, t, magnet, fromY) {
  let best = null, bd = Infinity;
  for (const pad of course.pads) {
    const p = padPos(pad, t);
    if (p.sunk || p.top > fromY + HOP.step) continue;
    if (inPad(pad, p.x, p.z, x, z, 0, p.rot)) return null;                            // already over a pad: no pull
    if (pad.r === undefined || (pad.kind === 'floe' && pad.motion)) continue;                                         // (round pads only)
    const dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz) - pad.r;
    if (d > 0 && d <= magnet && d < bd) { bd = d; const k = (pad.r - 0.05) / Math.hypot(dx, dz); best = { pad, top: p.top, sx: p.x + dx * k, sz: p.z + dz * k }; }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// The validator: a bot flies the real step along every link
// ---------------------------------------------------------------------------------------------
const FLIGHT_DT = 1 / 60;

/** Fly one hop from pad `a` to pad `b`, starting at time t0, aiming 0.3 u inside b's near rim. Returns { ok, why, speed, flight }. */
export function simulateLink(course, a, b, t0, T = terrainSource, opts = {}) {
  const mg = H.margin, ra = padRadius(a), rb = padRadius(b);
  let tf = 0.45, last = null;
  for (let iter = 0; iter < 4; iter++) {
    const A = { ...padPos(a, t0) }, B = { ...padPos(b, t0 + tf) };
    let dx = B.x - A.x, dz = B.z - A.z;
    const d = Math.hypot(dx, dz) || 1e-6;
    dx /= d; dz /= d;
    const takeoff = Math.max(0, ra - mg.takeoff);
    const aim = Math.max(0, d - Math.max(0, rb - mg.land - 0.1));             // land that far inside b's near rim
    const run = aim - takeoff;
    if (run < 0) { last = { ok: true, speed: 0, flight: tf }; break; }
    const speed = run / tf;
    if (speed > PLAYER_SPEED * mg.speed * (opts.speedScale ?? 1)) return { ok: false, why: `gap too wide (needs ${speed.toFixed(1)} u/s)`, speed, flight: tf };
    const body = { x: A.x + dx * takeoff, y: A.top, z: A.z + dz * takeoff, vy: 0, grounded: true, pad: a.id };
    let t = t0, jumped = false, n = 0;
    for (; n < 240; n++) {
      const ev = stepHop(body, { jump: !jumped }, course, t, FLIGHT_DT, T, { ...opts, magnet: 0 });
      jumped = true;
      t += FLIGHT_DT;
      body.x += dx * speed * FLIGHT_DT; body.z += dz * speed * FLIGHT_DT;
      if (ev.splash || body.y < -50) return { ok: false, why: 'falls short', speed, flight: n * FLIGHT_DT };
      if (n > 2 && body.grounded) break;
    }
    let landed = body.pad === b.id;
    if (landed && (b.kind === 'wet' || b.kind === 'floe')) {
      // Release the stick on landing: use the player's exponential wet damping,
      // then keep stepping gravity so an overshoot is caught as a real fall.
      const landing = { ...body };
      let vx = dx * speed, vz = dz * speed;
      for (let stop = 0; stop < 120; stop++) {
        const damping = Math.exp(-(b.kind === 'floe' ? ICE.grip : PLAYER_DAMPING * H.wetDamping) * FLIGHT_DT);
        vx *= damping; vz *= damping;
        body.x += vx * FLIGHT_DT; body.z += vz * FLIGHT_DT;
        if (b.kind === 'floe' && b.motion) { const at = t + stop * FLIGHT_DT; const before = { ...padPos(b, at) }, after = { ...padPos(b, at + FLIGHT_DT) }; Object.assign(body, rideFloe(body, before, after)); }
        stepHop(body, {}, course, t + stop * FLIGHT_DT, FLIGHT_DT, T, { ...opts, magnet: 0 });
        if (!body.grounded || body.pad !== b.id) { landed = false; break; }
      }
      Object.assign(body, landing);          // the flight estimate excludes the braking interval
    }
    const flight = n * FLIGHT_DT;
    last = { ok: landed, why: landed ? '' : (body.pad ? `lands on ${body.pad}` : 'misses the pad'), speed, flight };
    if (!landed) {
      if (body.pad === null && body.y > b.top - 0.01 && t - t0 < 0.2) return { ok: false, why: 'cannot rise that far', speed, flight };
      tf = Math.max(0.2, flight);
      if (iter === 3) return last;
      continue;
    }
    if (Math.abs(flight - tf) < 0.02) break;
    tf = flight;
  }
  return last;
}

/** Structural checks + the bot along every link at 24 start times; also the static limits at the worst moments. */
export function validateCourse(course, T = terrainSource, opts = {}) {
  const errors = [], lim = H.limits, byId = new Map();
  for (const p of course.pads) {
    if (byId.has(p.id)) errors.push(`duplicate pad ${p.id}`);
    byId.set(p.id, p);
    if (p.r !== undefined ? p.r < lim.padR : Math.min(p.w, p.d) < lim.padW) errors.push(`pad ${p.id} is too small`);
  }
  if (!byId.has(course.start)) errors.push('no start pad');
  if (!byId.has(course.goal)) errors.push('no goal pad');
  for (const l of course.links) if (!byId.has(l.a) || !byId.has(l.b)) errors.push(`link ${l.a}-${l.b} names an unknown pad`);
  if (errors.length) return { ok: false, errors, links: [] };
  // every pad on the main graph is reachable from the start, and the goal too (links are two-way for the graph: dropping back is free but only forward hops are validated)
  const seen = new Set([course.start]), queue = [course.start];
  while (queue.length) {
    const id = queue.shift();
    for (const l of course.links) if (l.a === id && !seen.has(l.b)) { seen.add(l.b); queue.push(l.b); }
  }
  if (!seen.has(course.goal)) errors.push('the goal cannot be reached from the start along the links');
  for (const p of course.pads) if (!seen.has(p.id) && !p.free) errors.push(`pad ${p.id} cannot be reached`);
  let period = 1;
  for (const p of course.pads) if (p.motion) period = Math.max(period, p.motion.period);
  const results = [];
  for (const l of course.links) {
    const a = byId.get(l.a), b = byId.get(l.b);
    let worstGap = 0, worstRise = -Infinity, fail = null;
    for (let k = 0; k < 24; k++) {
      const t0 = (k / 24) * period;
      const pa = { ...padPos(a, t0) }, pb = { ...padPos(b, t0 + 0.45) };
      // A sinking link is a timed hop: wait on the still rock until its crust rises.
      // Check the full horizontal extremes and nominal up tops, then fly an actual open window.
      if (l.wait && a.motion?.kind === 'sink') pa.top = a.top;
      if (l.wait && b.motion?.kind === 'sink') pb.top = b.top;
      worstGap = Math.max(worstGap, Math.hypot(pb.x - pa.x, pb.z - pa.z) - padRadius(a) - padRadius(b));
      worstRise = Math.max(worstRise, pb.top - pa.top);
      if (!fail) {
        let r = simulateLink(course, a, b, t0, T, opts);
        if (l.wait) {
          r = { ok: false, why: 'no safe motion window' };
          for (let w = 0; w <= 120; w++) {
            const at = t0 + w * period / 120;
            const ap = { ...padPos(a, at) }, bp = { ...padPos(b, at + 0.45) };
            if ((a.motion?.kind === 'sink' && ap.top < a.top - 0.01) || (b.motion?.kind === 'sink' && bp.top < b.top - 0.01)) continue;
            r = simulateLink(course, a, b, at, T, opts);
            if (r.ok) break;
          }
        }
        if (!r.ok) fail = r;
      }
    }
    if (!(l.wait && (a.motion?.kind === 'drift' || b.motion?.kind === 'drift')) && worstGap > lim.gap + 1e-6) errors.push(`link ${l.a}-${l.b}: gap ${worstGap.toFixed(2)} u is over the limit ${lim.gap}`);
    if (worstRise > lim.rise + 1e-6) errors.push(`link ${l.a}-${l.b}: rise ${worstRise.toFixed(2)} u is over the limit ${lim.rise}`);
    if (fail) errors.push(`link ${l.a}-${l.b}: ${fail.why}`);
    results.push({ a: l.a, b: l.b, gap: +worstGap.toFixed(2), rise: +worstRise.toFixed(2), ok: !fail });
  }
  return { ok: errors.length === 0, errors, links: results };
}

/** The pad id that follows `id` on the course's main route (for the next-pad glint), or null. */
export function nextOnRoute(course, id) {
  const r = course.route;
  if (!r) return null;
  const i = r.indexOf(id);
  return i >= 0 && i + 1 < r.length ? r[i + 1] : null;
}
