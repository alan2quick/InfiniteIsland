// A host + replica WorldSync pair with a `party` domain on each (shared by the Step 80b tests; the same wiring as test/party.test.js pair()).
import assert from 'node:assert/strict';
import { WorldSync } from '../../public/js/net/worldSync.js';
import { SlotTable } from '../../public/js/players/slotTable.js';
import { createPartyDomain } from '../../public/js/game/party/partyDomain.js';
import { mulberry32 } from '../../public/js/utils/rng.js';

// delayMs > 0 delays every message (both ways) by that much simulated time (Step 81b: the host-simulated Tilty Tiles with about 100 ms of latency); flush() delivers what is due.
export function pair({ positionOf = () => null, delayMs = 0 } = {}) {
  const clock = { ms: 5_000_000 }, wall = () => clock.ms;
  const q = [], replicas = new Map();
  const hSync = new WorldSync({ role: 'host', wallNow: wall }), rSync = new WorldSync({ role: 'replica', wallNow: wall });
  replicas.set(1, rSync);
  hSync.attachHost({ sendTo: (tid, m) => q.push([replicas.get(tid), JSON.parse(JSON.stringify(m)), undefined, clock.ms + delayMs]), broadcast: (m) => { for (const r of replicas.values()) q.push([r, JSON.parse(JSON.stringify(m)), undefined, clock.ms + delayMs]); } });
  rSync.attachReplica({ send: (m) => { q.push([hSync, JSON.parse(JSON.stringify(m)), 1, clock.ms + delayMs]); return true; } });
  const flush = () => { while (q.length && q[0][3] <= clock.ms) { const [to, m, tid] = q.shift(); if (to === hSync) hSync.screenMessage(tid, m); else to.receive(m); } };
  const hTable = new SlotTable(4);
  hTable.claim('host', 'p1', { kind: 'keyboard' }); hTable.claim('host', 'bot:1', { bot: true, name: 'Nabong', kind: 'bot' });
  const mem = { value: null }, prefs = { read: () => mem.value, write: (o) => { mem.value = JSON.stringify(o); } };
  const host = createPartyDomain({ sync: hSync, table: hTable, prefs, rng: mulberry32(11), positionOf, busy: () => null, now: () => hSync.hostNow() });
  const replica = createPartyDomain({ sync: rSync, table: new SlotTable(4), prefs: { read: () => null, write() {} } });
  rSync.linkUp(); hSync.screenConnected(1, { clientId: 'screen-2' }); flush();
  const rSlot = hTable.claim(rSync.screenId, 'local', { kind: 'keyboard' }).slot;
  const equal = (msg = '') => assert.equal(hSync.hash(), rSync.hash(), `hashes equal ${msg}`);
  const run = (secs, dt = 1 / 30, each = null) => { for (let t = 0; t < secs - 1e-9; t += dt) { clock.ms += dt * 1000; host.update(dt); flush(); if (each && each() === false) return; } };
  const rActor = () => ({ screen: rSync.screenId, index: rSlot, pos: { x: 0, y: 0, z: 0 } });
  return { clock, hSync, rSync, host, replica, flush, equal, run, rActor, rSlot, hTable };
}
