import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CAMPFIRE } from '../public/js/config.js';
import { campfireCastSeats, createCampGreetings, CAMP_GREETINGS, campfireWalkPoint, reserveCampLabel } from '../public/js/player/campfireCastLogic.js';
import { createCampfireCast } from '../public/js/player/campfireCast.js';
import { getColliders } from '../public/js/world/colliders.js';

const seats = CAMPFIRE.bench.angles.map((angle, bench) => ({ x: CAMPFIRE.x + Math.cos(angle) * CAMPFIRE.bench.ring, y: 0.6, z: CAMPFIRE.z + Math.sin(angle) * CAMPFIRE.bench.ring, facing: Math.atan2(-Math.cos(angle), -Math.sin(angle)), bench }));
test('six friends sit on the existing four home benches, with unique places and no artificial fire', () => {
  const result = campfireCastSeats(CAMPFIRE, seats);
  assert.equal(result.length, 6); assert.equal(new Set(result.map((s) => `${s.x}:${s.z}`)).size, 6);
  for (const seat of result) {
    assert.ok([seat.x, seat.y, seat.z, seat.facing].every(Number.isFinite));
    assert.ok(Math.abs(Math.hypot(seat.x - CAMPFIRE.x, seat.z - CAMPFIRE.z) - CAMPFIRE.bench.ring) < 0.1);
    assert.ok(Math.abs(seat.y - 0.3) < 1e-8);
  }
});
test('cordial greetings are sparse, never overlap, pause offscreen and rotate between seated friends', () => {
  const schedule = createCampGreetings(() => 0), emissions = []; let last = null;
  for (let i = 0; i < 600; i++) {
    const bubble = schedule.update(0.1, ['rowan', 'pip', 'sunny']);
    if (bubble && bubble.id !== last) emissions.push([i / 10, bubble.id, bubble.text]);
    last = bubble?.id || null;
  }
  assert.ok(emissions.length >= 2 && emissions.length <= 4);
  for (let i = 1; i < emissions.length; i++) { assert.ok(emissions[i][0] - emissions[i - 1][0] >= 18); assert.notEqual(emissions[i][1], emissions[i - 1][1]); }
  for (const [, , text] of emissions) assert.ok(CAMP_GREETINGS.includes(text));
  assert.equal(schedule.update(100, ['rowan'], false), null);
});

function stubDOM() {
  class Element extends EventTarget {
    constructor(tag) { super(); this.tagName = tag.toUpperCase(); this.style = {}; this.children = []; this.hidden = false; }
    append(...children) { this.children.push(...children); for (const child of children) child.parentNode = this; }
    setAttribute() {}
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((child) => child !== this); }
    getContext() { return { createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, arc() {}, fill() {} }; }
    getBoundingClientRect() { return { left: 0, top: 0, width: 1200, height: 800 }; }
  }
  return { body: new Element('body'), createElement: (tag) => new Element(tag), canvas: new Element('canvas') };
}
function fixture({ reduced = false, initialSelection = true, selected = 'original', welcomeFire = null } = {}) {
  const previous = { document: globalThis.document, window: globalThis.window, matchMedia: globalThis.matchMedia };
  const dom = stubDOM(); globalThis.document = dom; globalThis.window = new EventTarget(); globalThis.matchMedia = () => ({ matches: reduced });
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1.5, 0.1, 600), root = new THREE.Group(); root.position.set(2, 0, 12);
  camera.position.set(7, 10, 24); camera.lookAt(7, 0, 9.5);
  const chosen = [], player = { root, position: root.position }, state = { blocked: false, activity: false }, colliders = getColliders().slice();
  const cast = createCampfireCast({ scene, camera, canvas: dom.canvas, player, fire: CAMPFIRE, welcomeFire, seats, initialSelection, selected, keyboard: { releaseAll() {} }, onChoose: (id) => chosen.push(id), getBlocked: () => state.blocked, hasActivity: () => state.activity, random: () => 0 });
  return { cast, scene, root, chosen, dom, state, colliders, restore() { cast.dispose(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; } } };
}
test('first visit shows six seated scene actors; chosen friend leaves and other five persist without changing physics', () => {
  const f = fixture();
  try {
    const group = f.scene.getObjectByName('campfire-friends'); f.cast.update(0);
    assert.equal(group.children.length, 6); assert.equal(group.children.filter((g) => g.visible).length, 6);
    assert.equal(f.root.visible, false); assert.equal(f.cast.isSelecting, true);
    assert.equal(f.cast.choose('sunny'), true);
    for (let i = 0; i < 28; i++) f.cast.update(0.1);
    assert.deepEqual(f.chosen, ['sunny']); assert.equal(f.cast.current, 'sunny'); assert.equal(f.cast.isSelecting, false); assert.equal(f.root.visible, true);
    assert.equal(group.children.filter((g) => g.visible).length, 5);
    assert.equal(group.children.find((g) => g.userData.campVariant === 'sunny').visible, false);
    assert.deepEqual(f.root.position.toArray(), [2, 0, 12], 'selection never teleports or edits the player save');
    assert.deepEqual(getColliders(), f.colliders);
    f.cast.dispose(); assert.equal(f.scene.getObjectByName('campfire-friends'), undefined); assert.equal(f.dom.body.children.length, 0);
  } finally { f.restore(); }
});
test('returning players retain their choice; reduced motion selects immediately; other input keeps the familiar default', () => {
  const f = fixture({ initialSelection: false, selected: 'pip', reduced: true });
  try {
    f.cast.update(0); assert.equal(f.root.visible, true);
    assert.equal(f.scene.getObjectByName('campfire-friends').children.filter((g) => g.visible).length, 5);
    f.cast.choose('clover'); assert.equal(f.cast.current, 'clover'); assert.equal(f.cast.isSelecting, false);
  } finally { f.restore(); }
  const g = fixture();
  try { g.state.activity = true; g.cast.update(0.1); assert.equal(g.cast.isSelecting, false); assert.deepEqual(g.chosen, ['original']); assert.equal(g.root.visible, true); }
  finally { g.restore(); }
});


test('switching walks the actual equipped body back before the next friend walks out; physics position and gear stay intact', () => {
  const f = fixture({ initialSelection: false, selected: 'original' });
  try {
    const gear = new THREE.Object3D(); gear.name = 'equipped-tool'; f.root.add(gear);
    const position = f.root.position.toArray(), parent = f.root.parent;
    assert.equal(f.cast.choose('sunny'), true);
    assert.equal(f.cast.summary().phase, 'returning'); assert.equal(f.root.visible, true);
    assert.equal(f.root.parent.name, 'campfire-returning-player');
    for (let i = 0; i < 13; i++) f.cast.update(0.1);
    assert.equal(f.cast.summary().phase, 'leaving'); assert.equal(f.root.visible, false);
    assert.deepEqual(f.chosen, [], 'control/identity transfer waits for the new friend to arrive');
    for (let i = 0; i < 17; i++) f.cast.update(0.1);
    assert.deepEqual(f.chosen, ['sunny']); assert.equal(f.cast.isSelecting, false);
    assert.equal(f.root.visible, true); assert.equal(f.root.parent, parent);
    assert.deepEqual(f.root.position.toArray(), position); assert.equal(gear.parent, f.root);
    assert.equal(f.scene.getObjectByName('campfire-returning-player'), undefined);
    const seated = f.scene.getObjectByName('campfire-friends').children.filter((g) => g.visible);
    assert.equal(seated.length, 5); assert.ok(seated.some((g) => g.userData.campVariant === 'original'));
    f.root.position.set(100, 0, 100);
    assert.equal(f.cast.choose('pip'), false, 'far-away clicks/debug requests cannot teleport or start a handoff');
  } finally { f.restore(); }
});

test('welcome flame boost is visual-only and restores the previous level without overriding another scene', () => {
  const fire = { boost: 0, fuel: 0, setBoost(value) { this.boost = value; } };
  const f = fixture({ welcomeFire: fire });
  try {
    assert.equal(fire.boost, 1); assert.equal(fire.fuel, 0);
    f.cast.choose('pip', true); assert.equal(fire.boost, 0); assert.equal(fire.fuel, 0);
  } finally { f.restore(); }
  const g = fixture({ welcomeFire: fire });
  try { fire.boost = 2; g.cast.dispose(); assert.equal(fire.boost, 2, 'a later scene keeps ownership of its boost'); }
  finally { g.restore(); }
});

test('cosmetic handoff paths curve around the fire pit and retain both endpoints', () => {
  const from = { x: -4, y: 0, z: 0 }, to = { x: 4, y: 1, z: 0 }, center = { x: 0, z: 0 };
  for (let i = 0; i <= 20; i++) {
    const point = campfireWalkPoint(from, to, center, i / 20);
    assert.ok(Math.hypot(point.x, point.z) >= 3.99);
  }
  assert.ok(Math.abs(campfireWalkPoint(from, to, center, 0).x + 4) < 1e-8);
  assert.ok(Math.abs(campfireWalkPoint(from, to, center, 1).x - 4) < 1e-8);
});


test('campfire names hide in distant overhead views and do not overlap neighbouring labels', () => {
  const occupied = [], label = { x: 300, y: 200, width: 70, height: 32, actorPixels: 60 };
  assert.equal(reserveCampLabel({ ...label, actorPixels: 12 }, occupied), false);
  assert.equal(occupied.length, 0);
  assert.equal(reserveCampLabel(label, occupied), true);
  assert.equal(reserveCampLabel({ ...label, x: 330 }, occupied), false);
  assert.equal(reserveCampLabel({ ...label, x: 400 }, occupied), true);
});
