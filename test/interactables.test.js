// Step 27b: the bucketed findNearest must return exactly what the old linear scan returned (including equal-distance ties).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addInteractable, removeInteractable, restoreInteractable, getInteractables, clearInteractables, findNearest,
} from '../public/js/world/interactables.js';
import { mulberry32 } from '../public/js/utils/rng.js';

/** The pre-27b implementation, over the registration-ordered array. */
function linear(items, pos, maxDist) {
  let best = null, bestD = maxDist;
  for (const it of items) {
    const dx = pos.x - it.position.x, dz = pos.z - it.position.z;
    const d = Math.max(0, Math.sqrt(dx * dx + dz * dz) - it.radius);
    if (d <= bestD) { bestD = d; best = it; }
  }
  return best;
}

const TYPES = ['tree', 'bush', 'rock', 'herb', 'flower', 'item', 'digspot'];

test('findNearest equals the linear scan on random data (add / remove / restore / moving items, coordinates up to +-320)', () => {
  clearInteractables();
  const rng = mulberry32(27);
  const r = (a, b) => a + (b - a) * rng();
  const added = [];
  for (let i = 0; i < 1500; i++) {
    const big = rng() < 0.5;
    added.push(addInteractable({
      type: TYPES[Math.floor(rng() * TYPES.length)],
      position: { x: big ? r(-320, 320) : r(-30, 30), y: 0, z: big ? r(-320, 320) : r(-30, 30) },
      radius: rng() < 0.1 ? 0 : r(0.2, 1.6),
    }));
  }
  for (let round = 0; round < 6; round++) {
    // churn: remove some, restore some, move the dynamic ones in place (as ground items do)
    for (const it of added) {
      const k = rng();
      if (k < 0.1) removeInteractable(it);
      else if (k < 0.2) restoreInteractable(it);
      if (it.type === 'item' && rng() < 0.5) { it.position.x = r(-320, 320); it.position.z = r(-320, 320); }
    }
    for (let q = 0; q < 400; q++) {
      const pos = rng() < 0.5 ? { x: r(-330, 330), z: r(-330, 330) } : (() => {
        const t = getInteractables(); const o = t[Math.floor(rng() * t.length)];
        return o ? { x: o.position.x + r(-1, 1), z: o.position.z + r(-1, 1) } : { x: 0, z: 0 };
      })();
      const maxDist = rng() < 0.5 ? 2.2 : r(0.5, 8);
      assert.equal(findNearest(pos, maxDist), linear(getInteractables(), pos, maxDist));
    }
  }
});

test('equal distances go to the most recently registered / restored entry; surface distance floors at 0', () => {
  clearInteractables();
  const a = addInteractable({ type: 'tree', position: { x: 5, y: 0, z: 5 }, radius: 1 });
  const b = addInteractable({ type: 'tree', position: { x: 5, y: 0, z: 5 }, radius: 1 });
  assert.equal(findNearest({ x: 5.2, z: 5 }), b);          // both at distance 0: the later one wins, as in the old scan
  removeInteractable(a); restoreInteractable(a);           // a is now the newest registration
  assert.equal(findNearest({ x: 5.2, z: 5 }), a);
  assert.equal(findNearest({ x: 50, z: 50 }), null);
  assert.equal(a.lastDistance, 0);
});


test('toolrack wins in its front approach only; ordinary ranking, filters and reach stay intact', () => {
  clearInteractables();
  const rack=addInteractable({type:'toolrack',position:{x:0,z:0},radius:0.72});
  const pickup=addInteractable({type:'item',position:{x:0,z:1.5},radius:0.55});
  const bush=addInteractable({type:'bush',position:{x:0.3,z:1.5},radius:0.7});
  assert.equal(findNearest({x:0,z:1.5}),rack,'pickup and bush cannot steal repeated rack presses');
  assert.equal(findNearest({x:0,z:1.5},0.1),bush,'priority does not extend reach');
  assert.equal(findNearest({x:0,z:1.5},2.2,it=>it!==rack),bush,'eligible filter still applies');
  rack.canInteract=()=>false;assert.equal(findNearest({x:0,z:1.5}),bush);rack.canInteract=null;
  pickup.position={x:1.6,z:0};assert.equal(findNearest({x:1.6,z:0}),pickup,'walking to the side permits pickup');
  pickup.position={x:0,z:-1.5};assert.equal(findNearest({x:0,z:-1.5}),pickup,'behind the rack uses normal nearest');
  removeInteractable(rack);pickup.position={x:0,z:1.5};assert.equal(findNearest({x:0,z:1.5}),bush,'non-rack tie behaviour is unchanged');
});
