import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodePose, decodePose, PoseBuffer } from '../public/js/net/poseBuffer.js';
import { WorldSync } from '../public/js/net/worldSync.js';
import { SlotTable } from '../public/js/players/slotTable.js';
import { createPlayersDomain } from '../public/js/net/playersDomain.js';
import { Avatars } from '../public/js/net/avatars.js';
import { createCharacter } from '../public/js/player/character.js';
import { CHARACTER_VARIANTS } from '../public/js/player/characterVariants.js';
const base = { index: 1, position: { x: 2, y: 0, z: 3 }, velocity: { x: 0, z: 0 }, facing: 0, character: { hat: {} } };

test('variant wire field is optional, backwards compatible and whitelist bounded', () => {
  const original = encodePose(base);
  assert.equal(original.length, 16); assert.equal(decodePose(original).variant, 'original');
  assert.deepEqual(encodePose({ ...base, characterVariant: 'original' }), original);
  assert.deepEqual(encodePose({ ...base, characterVariant: 'unknown' }), original);
  for (const [i, v] of CHARACTER_VARIANTS.entries()) {
    const wire = encodePose({ ...base, characterVariant: v.id });
    assert.equal(wire.length, i ? 17 : 16);
    assert.equal(decodePose(wire).variant, v.id);
    assert.deepEqual(wire.slice(0, 16), original);
  }
  for (const invalid of [-1, 99, 1.5]) assert.equal(decodePose([...original, invalid]).variant, 'original');
  const buffer = new PoseBuffer(100);
  buffer.push(encodePose({ ...base, characterVariant: 'sunny' }, -1, 1), 1000);
  buffer.push(encodePose({ ...base, characterVariant: 'pip' }, -1, 2), 1100);
  assert.equal(buffer.sample(1150).variant, 'pip');
});

test('remote variant builds once per change, restores original and disposes before player removal', () => {
  const prior = globalThis.document;
  globalThis.document = { createElement: () => ({ getContext: () => ({ createRadialGradient: () => ({ addColorStop() {} }), fillRect() {}, beginPath() {}, arc() {}, fill() {} }) }) };
  try {
    const character = createCharacter(); let disposed = 0;
    const player = { character, parts: character.parts, dispose: () => character.dispose() };
    const r = { player, variant: 'original', variantCleanup: null };
    Avatars.prototype._appearance(r, { variant: 'sunny' });
    const first = character.root.getObjectByName('variant-sunny');
    first.geometry.addEventListener('dispose', () => disposed++);
    Avatars.prototype._appearance(r, { variant: 'sunny' });
    assert.equal(character.root.getObjectByName('variant-sunny'), first); assert.equal(disposed, 0);
    Avatars.prototype._appearance(r, { variant: 'original' });
    assert.equal(disposed, 1); assert.equal(character.parts.head.visible, true);
    Avatars.prototype._appearance(r, { variant: 'pip' });
    const second = character.root.getObjectByName('variant-pip'); second.geometry.addEventListener('dispose', () => disposed++);
    const remote = new Map([[1, r]]);
    Avatars.prototype._remove.call({ remote, visuals: { detach() {} } }, 1);
    assert.equal(remote.size, 0); assert.equal(disposed, 2);
  } finally { if (prior === undefined) delete globalThis.document; else globalThis.document = prior; }
});


test('host relays owned variants to a real replica and late join without changing world hashes', () => {
  const host = new WorldSync({ role: 'host', wallNow: () => 1000 });
  const replica = new WorldSync({ role: 'replica', wallNow: () => 1000 });
  const table = new SlotTable(4), replicaTable = new SlotTable(4);
  createPlayersDomain({ sync: host, table }); createPlayersDomain({ sync: replica, table: replicaTable });
  table.claim('host', 'local'); table.claim('s1', 'local');
  const received = [];
  replica.on('poses', (_screen, poses) => { for (const p of poses) received.push(decodePose(p)); });
  const broadcasts = [], snapshots = [];
  host.attachHost({ sendTo: (_id, msg) => snapshots.push(msg), broadcast: (msg) => { broadcasts.push(msg); replica.receive(msg); } });
  host.screenConnected('t1', { clientId: 'first' });
  replica.receive(snapshots.find((m) => m.type === 'snapshot'));
  const hash = host.hashes(), seq = host.seq;
  for (const variant of ['sunny', 'pip', 'original']) {
    const wire = encodePose({ ...base, characterVariant: variant }, -1, 1);
    host.screenMessage('t1', { type: 'poses', p: [wire] });
    assert.equal(received.at(-1).variant, variant);
    assert.deepEqual(host.hashes(), hash); assert.equal(host.seq, seq);
  }
  const owned = encodePose({ ...base, characterVariant: 'clover' });
  host.screenMessage('t1', { type: 'poses', p: [owned] });
  const before = broadcasts.length;
  const nonfinite = [...owned]; nonfinite[16] = Infinity;
  const forged = encodePose({ ...base, index: 0, characterVariant: 'sunny' });
  host.screenMessage('t1', { type: 'poses', p: [forged, [...owned, 0], owned.slice(0, 2), nonfinite] });
  assert.equal(broadcasts.length, before, 'wrong owner, oversized, undersized and nonfinite packets are not relayed');
  host.screenConnected('t2', { clientId: 'second' });
  const late = snapshots.filter((m) => m.type === 'snapshot').at(-1);
  assert.equal(decodePose(late.poses.find((p) => p[0] === 1)).variant, 'clover');
  for (const invalid of [99, -1, 1.5]) {
    const wire = [...owned]; wire[16] = invalid;
    host.screenMessage('t1', { type: 'poses', p: [wire] });
    assert.equal(received.at(-1).variant, 'original');
  }
});
