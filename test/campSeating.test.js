import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CAMPFIRE, FIRES } from '../public/js/config.js';
import { campBenchSpot, HOME_SEATING_OFFSET } from '../public/js/world/campSeating.js';
import { campfireCastSeats, campfireWalkPoint } from '../public/js/player/campfireCastLogic.js';
import { streamDistance, STREAM_HALF_WIDTH, getGroundType } from '../public/js/world/terrain.js';
import { createCampfire } from '../public/js/world/campfire.js';
import { createProps } from '../public/js/world/props.js';
import { clearColliders, getColliders } from '../public/js/world/colliders.js';
import { clearInteractables } from '../public/js/world/interactables.js';
import { campSleepLayout } from '../public/js/world/campSleep.js';
import { campsiteLayout } from '../public/js/world/campsiteDressing.js';
import { installDom, el } from './fixtures/domStub.js';
installDom(); const createElement = document.createElement;
document.createElement = (...args) => { const node = createElement(...args); node.firstElementChild = el(); return node; };

test('home log footprint moves 1.1 units south onto dry grass; other island seating stays unchanged', () => {
  for (const fire of FIRES) for (let i = 0; i < fire.bench.angles.length; i++) {
    const a = fire.bench.angles[i], p = campBenchSpot(fire, i), dz = fire.id === 'home' ? HOME_SEATING_OFFSET.z : 0;
    assert.equal(p.x, Math.cos(a) * fire.bench.ring); assert.equal(p.z, Math.sin(a) * fire.bench.ring + dz);
    if (fire.id !== 'home') continue;
    for (const offset of [-.85, 0, .85]) {
      const x = fire.x + p.x + p.tangentX * offset, z = fire.z + p.z + p.tangentZ * offset;
      assert.equal(getGroundType(x, z), 'grass');
      assert.ok(streamDistance(x, z) - STREAM_HALF_WIDTH > 2.6);
      const old = streamDistance(x, z - HOME_SEATING_OFFSET.z);
      if (Number.isFinite(old)) assert.ok(streamDistance(x, z) >= old);
    }
  }
});
test('mesh, collider seats, six friends and walk handoff agree; sleeping bags still have safe patches', () => {
  clearColliders(); clearInteractables(); const scene = new THREE.Scene(); createProps(scene);
  const fire = createCampfire({ scene, players: { list: [], get() {} }, particles: { burst() {} }, hud: { root: el(), toast() {} }, inventory: { count() { return 0; }, on() {} }, dialog: { isOpen: false }, sync: { isHost: true, register() {}, emit() {}, hostNow: () => 0 } });
  assert.equal(fire.seats.length, 4);
  for (let i = 0; i < fire.seats.length; i++) {
    const seat = fire.seats[i], spot = campBenchSpot(CAMPFIRE, i);
    assert.equal(seat.x, CAMPFIRE.x + spot.x); assert.equal(seat.z, CAMPFIRE.z + spot.z);
    assert.ok(getColliders().some((c) => Math.hypot(c.x - seat.x, c.z - seat.z) < .01));
  }
  const cast = campfireCastSeats(CAMPFIRE, fire.seats); assert.equal(cast.length, 6);
  for (const s of cast) {
    const path = campfireWalkPoint(s, { x: 2, y: 1.5, z: 12 }, CAMPFIRE, 0); assert.equal(path.x, s.x); assert.equal(path.z, s.z);
    assert.ok(Number.isFinite(s.facing));
  }
  const bags = campSleepLayout({ campsite: campsiteLayout() }); assert.ok(bags.length >= 2);
  for (const bag of bags) for (const seat of fire.seats) assert.ok(Math.hypot(bag.x - seat.x, bag.z - seat.z) > 1.5);
  console.log('dry-side camp seats', JSON.stringify(fire.seats), 'bags', bags.length);
});
