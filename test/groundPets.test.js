// Step 76a: injected terrain/collider sweeps, safe reappearance, per-pet idles and real bridge decks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { groundFollowStep, nearestGroundSpot, stepRubyIdle } from '../public/js/game/groundPetLogic.js';
import { PET, BRIDGES } from '../public/js/config.js';
import { heelPoint, createIdle } from '../public/js/game/petLogic.js';
import { getHeight, isWalkable, setBridgeOpen } from '../public/js/world/terrain.js';
const state = (x = 0, z = 0) => ({ x, y: 0, z, vx: 0, vz: 0, yaw: 0 });
function run(s, target, env = {}, n = 600) {
  const results = [];
  for (let i = 0; i < n; i++) results.push(groundFollowStep(s, target, 1 / 60, env));
  return results;
}
test('ground: reaches the per-slot heel on open sloping ground with no poof, smooth turns and speed caps', () => {
  for (const slot of [0, 1, 2, 3]) {
    const heel = heelPoint({ x: 8, z: 2, facing: 0.4 }, slot), s = state();
    const results = run(s, heel, { heightAt: (x) => x * 0.1 });
    assert.ok(Math.hypot(s.x - heel.x, s.z - heel.z) <= PET.ground.stop + 1e-5);
    assert.equal(s.y, s.x * 0.1); assert.ok(results.every((r) => !r.poof && r.speed <= PET.ground.runSpeed + 1e-6));
    assert.ok(results.some((r) => r.catching)); assert.ok(Number.isFinite(s.yaw));
  }
});
test('ground: local steering goes round a round collider, without crossing it or poofing', () => {
  const s = state(), target = { x: 7, z: 0 }, radius = 0.7;
  const env = { blocked: (x, z, r) => Math.hypot(x - 3, z) < radius + r };
  const results = [];
  for (let i = 0; i < 500; i++) { results.push(groundFollowStep(s, target, 1 / 60, env)); assert.ok(!env.blocked(s.x, s.z, PET.ground.radius)); }
  assert.ok(results.every((r) => !r.poof)); assert.ok(Math.hypot(s.x - 7, s.z) < 0.2);
});
test('ground: slides alongside a long wall and reaches the target around its end', () => {
  const s = state(0, -2), env = { blocked: (x, z, r) => Math.abs(x - 2) < 0.15 + r && z < 2 + r };
  let slid = false;
  const results = [];
  for (let i = 0; i < 700; i++) { const oldZ = s.z; results.push(groundFollowStep(s, { x: 4, z: 5 }, 1 / 60, env)); if (s.x > 1.2 && s.x < 1.7 && s.z > oldZ) slid = true; assert.ok(!env.blocked(s.x, s.z, PET.ground.radius)); }
  assert.ok(slid); assert.ok(results.every((r) => !r.poof)); assert.ok(Math.hypot(s.x - 4, s.z - 5) < 0.2);
});
test('ground: stuck for about two seconds poofs across an impassable wall to a safe heel', () => {
  const s = state(), env = { blocked: (x, z, r) => Math.abs(x - 1) < 0.1 + r };
  const results = run(s, { x: 6, z: 0 }, env, 300), poofs = results.filter((r) => r.poof);
  assert.equal(poofs.length, 1); assert.equal(poofs[0].reason, 'stuck'); assert.ok(s.x > 5.8);
});
test('ground: a moving target never causes false stuck poofs while the pet is making progress', () => {
  const s = state(), results = [];
  for (let i = 0; i < 1200; i++) results.push(groundFollowStep(s, { x: i * 0.1, z: 0 }, 1 / 60));
  assert.ok(results.every((r) => !r.poof)); assert.ok(s.x > 110);
});
test('ground: lost, unwalkable heel/current ground, cliff and no-safe-spot fallback', () => {
  const s = state(); assert.equal(groundFollowStep(s, { x: 50, z: 0 }, 0.1).reason, 'lost'); assert.equal(s.x, 50);
  const water = { walkable: (x, z) => x < 2 };
  const a = state(); const r = groundFollowStep(a, { x: 3, z: 0 }, 0.1, water);
  assert.equal(r.reason, 'unwalkable'); assert.ok(r.target.x < 2); assert.ok(water.walkable(a.x, a.z));
  assert.equal(groundFollowStep(a, { x: 3, z: 0 }, 0.1, water).poof, false, 'no repeated fallback poof');
  const bad = state(4); assert.equal(groundFollowStep(bad, { x: 0, z: 0 }, 0.1, water).reason, 'unwalkable');
  assert.equal(nearestGroundSpot({ x: 0, z: 0 }, { walkable: () => false }), null);
  assert.equal(groundFollowStep(state(), { x: 0, z: 0 }, 0.1, { walkable: () => false }).target, null);
  const cliff = state(); const steps = run(cliff, { x: 4, z: 0 }, { heightAt: (x) => x > 1 ? 4 : 0 }, 300);
  assert.ok(steps.some((r) => r.reason === 'stuck')); assert.equal(cliff.y, 4);
});
test('ground: swept checks do not tunnel through a thin obstacle even with a long frame', () => {
  const s = state(), env = { blocked: (x) => x > 0.25 && x < 0.35 };
  for (let i = 0; i < 12; i++) { const r = groundFollowStep(s, { x: 10, z: 0 }, 1, env); assert.equal(r.poof, false); assert.ok(s.x < 0.35); }
});
test('ground: safe landing searches nearest rings and excludes colliders', () => {
  const env = { walkable: (x, z) => x * x + z * z > 0.9, blocked: (x) => x < 0, heightAt: () => 3 };
  const spot = nearestGroundSpot({ x: 0, z: 0 }, env);
  assert.ok(spot.x >= 0); assert.ok(Math.hypot(spot.x, spot.z) <= 1.01); assert.equal(spot.y, 3);
});
test('ground: walks every real bridge centre line without poofing or leaving its deck', () => {
  for (const br of BRIDGES) {
    setBridgeOpen(br.id, true);
    try {
      const at = (u) => ({ x: br.ax + (br.bx - br.ax) * u, z: br.az + (br.bz - br.az) * u });
      const a = at(0.2), s = { ...state(a.x, a.z), y: getHeight(a.x, a.z) };
      for (let i = 0; i < 600; i++) {
        const target = at(0.2 + 0.6 * Math.min(1, i / 500));
        const r = groundFollowStep(s, target, 1 / 60, { heightAt: getHeight, walkable: isWalkable });
        assert.equal(r.poof, false, br.id); assert.ok(isWalkable(s.x, s.z)); assert.equal(s.y, getHeight(s.x, s.z));
      }
      assert.ok(Math.hypot(s.x - at(0.8).x, s.z - at(0.8).z) < 0.2);
    } finally { setBridgeOpen(br.id, false); }
  }
});
test('Ruby idle table gates sand/water choices and cancels on movement/combat', () => {
  function pick(rng, ctx = {}) { const idle = createIdle(() => 0); idle.cooldown = 0; const kind = stepRubyIdle(idle, 2, { ownerStill: true, canIdle: true, rng: () => rng, ...ctx }); return { idle, kind }; }
  assert.equal(pick(0).kind, 'hide'); assert.equal(pick(0.4).kind, 'wave'); assert.equal(pick(0.9).kind, 'shuffle');
  assert.equal(pick(0.99, { sand: true }).kind, 'dig'); assert.equal(pick(0.99, { water: true }).kind, 'bubbles');
  const { idle } = pick(0); assert.equal(stepRubyIdle(idle, 0.1, { ownerStill: false, canIdle: true }), null);
  assert.equal(pick(0, { canIdle: false }).kind, null);
});
