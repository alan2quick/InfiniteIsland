// Campfire tool racks: createToolRacks({scene, players, items, quests, sync, boat, world, ...}).
// update(dt) drives pop-in and local stock pegs; summary/unlock/stock/cycle/goto/resetSession are the debug API.
// Gameplay registrations happen once on unlock, independent of visibility or island visual rebuilds. Nothing is saved.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { FIRES, TOOL_RACK } from '../config.js';
import { rackKinds, rackUnlocked, RACK_EXTRA_KIND as EXTRA } from '../game/toolRackLogic.js';
import { toolRackPlan } from './toolRackPlan.js';
import { addCollider } from './colliders.js';
import { addInteractable } from './interactables.js';
import { buildItemModel } from '../items/models.js';
import { VERTEX_TOON, part, combine, makeOutline } from '../render/geo.js';
import { createPopper } from './popIn.js';

export function rackGeometry() {
  const box = new THREE.BoxGeometry(1, 1, 1), parts = [];
  const plank = (p, s, c = '#bd8050', r = [0, 0, 0]) => parts.push(part(box, c, { p, s, r }));
  for (const x of [-0.55, 0.55]) plank([x, 0.58, 0], [0.14, 1.16, 0.18], '#8f5a37');
  for (const y of [0.46, 0.72, 0.98]) plank([0, y, 0], [1.3, 0.23, 0.12]);
  for (const side of [-1, 1]) plank([side * 0.35, 1.2, 0], [0.78, 0.1, 0.48], '#914b40', [0, 0, -side * 0.25]);
  for (let i = 0; i < 5; i++) plank([(i - 2) * 0.25, 0.82, 0.16], [0.055, 0.07, 0.25], '#ffe0a0');
  // The locked rod's little question carving sits behind its removable display model.
  for (const [x, y, w, h] of [[0.5,0.69,0.08,0.025],[0.54,0.65,0.025,0.07],[0.51,0.6,0.06,0.025],[0.485,0.57,0.025,0.05],[0.485,0.51,0.025,0.025]]) plank([x,y,0.068], [w,h,0.012], '#664531');
  box.dispose();
  return combine(parts);
}
// Step 86b: the home rack's watering can hangs from its own little side peg (the five tool pegs are full), so it never moves the other tools.
const SIDE_PEG = { 'watering-can': { p: [0.86, 0.56, 0.22], rz: 0.25 } };
function displayGeometry(kinds, bright) {
  const geos = [], pegBox = new THREE.BoxGeometry(1, 1, 1);
  for (const kind of kinds) {
    const model = buildItemModel(kind), i = TOOL_RACK.kinds.indexOf(kind), side = SIDE_PEG[kind];
    model.position.set(...(side ? side.p : [(i - 2) * 0.25, 0.68, 0.22]));
    model.scale.setScalar(TOOL_RACK.displayScale); model.rotation.z = side ? side.rz : Math.PI;
    if (side) geos.push(part(pegBox, '#8f5a37', { p: [0.74, 0.7, 0.16], s: [0.26, 0.06, 0.07] }), part(pegBox, '#8f5a37', { p: [0.86, 0.7, 0.2], s: [0.06, 0.1, 0.12] }));
    model.updateMatrixWorld(true);
    // Body only: outlines are merged once for the entire peg display.
    for (const m of model.children) if (m.isMesh) {
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld);
      if (!bright.includes(kind)) {
        const c = g.attributes.color;
        for (let n = 0; n < c.count; n++) c.setXYZ(n, c.getX(n) * 0.25, c.getY(n) * 0.25, c.getZ(n) * 0.25);
      }
      geos.push(g);
    }
    model.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
  }
  pegBox.dispose();
  const merged = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return merged;
}
export function createToolRacks({ scene, players, items, quests, sync, boat, world = null, particles, sfx = null, homestead = null,
  floatLabel = null, table = null, cinematic = null, followCam = null, params = new URLSearchParams(), plan = toolRackPlan() }) {
  const forced = new Set(params.has('racks') ? FIRES.map((f) => f.id) : []), racks = new Map();
  let initialised = false;
  const known = () => !sync.isReplica || sync.status === 'synced';
  const unlocked = (id) => known() && !!plan[id] && (forced.has(id) || rackUnlocked(quests, id));
  const kinds = (fire = null) => rackKinds(!!boat?.state?.discovered, fire, !!homestead?.unlocked);     // (Step 86b: the home rack also offers the watering can once Homesteading is unlocked)
  items.configureRacks({ unlocked, spot: (id) => plan[id], kinds,
    allowed: (actor) => (!table || table.get(actor.index)?.screen === actor.screen && !table.get(actor.index)?.away) && !cinematic?.busy,
    label: (name, p) => { if (p && floatLabel) floatLabel(name, { x: p.position.x, y: p.position.y + 2.3, z: p.position.z }, p); },
  });
  function build(fire, live) {
    const spot = plan[fire.id], group = new THREE.Group(); group.name = `toolrack-${fire.id}`;
    group.position.set(spot.x, spot.y, spot.z); scene.add(group);
    const geo = rackGeometry(), stand = new THREE.Mesh(geo, VERTEX_TOON);
    stand.castShadow = stand.receiveShadow = true; stand.add(makeOutline(geo, TOOL_RACK.outline)); group.add(stand);
    const collider = addCollider({ x: spot.x, z: spot.z, r: TOOL_RACK.radius, owner: group });
    const interactable = addInteractable({ type: 'toolrack', position: group.position.clone(), radius: TOOL_RACK.radius,
      prompt: 'Take tool', onInteract: (_, p) => p && items.cycleRack(p, fire.id) });
    interactable.fire = fire.id;
    const popper = createPopper({ parent: group });
    const r = { group, stand, collider, interactable, popper, display: null, signature: '' }; racks.set(fire.id, r);
    if (live) {
      stand.visible = false;
      popper.add(geo, { cast: true, onStart: () => sfx?.play('cooked', { pitch: 1.1 }),
        onLand: () => particles.burst('puff', spot, { count: 12, radius: 0.8 }), onDone: () => { stand.visible = true; } });
    }
  }
  // The watering can's peg display: simply there on load, popping in when Homesteading unlocks while the rack is already standing.
  function updateCan(r, on, lit) {
    const sig = `${on}:${lit}`;
    if (sig === r.canSig) return;
    const first = r.canSig === undefined, was = r.canOn;
    r.canSig = sig; r.canOn = on;
    if (r.can) { r.can.removeFromParent(); r.can.traverse((m) => { if (m.isMesh) m.geometry.dispose(); }); r.can = null; }
    if (!on) return;
    const g = displayGeometry([EXTRA], lit ? [EXTRA] : []), m = new THREE.Mesh(g, VERTEX_TOON);
    m.add(makeOutline(g, TOOL_RACK.outline * 0.6));
    r.can = m;
    if (!first && !was && !r.canPopped) {
      r.canPopped = true; m.visible = false;
      r.popper.add(g, { cast: false, outline: 0.02, onStart: () => sfx?.play('cooked', { pitch: 1.4 }), onLand: () => particles.burst('sparkle', r.group.position, { count: 8, radius: 0.5 }), onDone: () => { if (r.can === m) m.visible = true; } });
    }
    r.group.add(m);
  }
  function refresh(live = false) {
    if (!known()) return;
    for (const fire of FIRES) if (unlocked(fire.id) && !racks.has(fire.id)) build(fire, live && initialised);
    initialised = true;
  }
  function update(dt) {
    refresh(false);
    for (const [id, r] of racks) {
      const all = kinds(id), ks = all.filter((k) => k !== EXTRA);        // the five classic pegs; the watering can (Step 86b) is its own mesh below, so it can pop in alone
      r.group.visible = !world || world.regions.isFull(FIRES.find((f) => f.id === id).island);
      r.popper.update(dt);
      const locals = players.list.filter((p) => !p.bot && !p.leaving);
      const bright = all.filter((k) => locals.some((p) => items.rackStock(p.index, id)[k] === 'rack'));
      const sig = `${ks.join(',')}:${bright.filter((k) => k !== EXTRA).join(',')}`;
      if (sig !== r.signature) {
        r.signature = sig;
        if (r.display) { r.display.removeFromParent(); r.display.traverse((m) => { if (m.isMesh) m.geometry.dispose(); }); }
        const g = displayGeometry(ks, bright), m = new THREE.Mesh(g, VERTEX_TOON);
        m.add(makeOutline(g, TOOL_RACK.outline * 0.6)); r.display = m; r.group.add(m);
      }
      updateCan(r, all.includes(EXTRA), bright.includes(EXTRA));
    }
  }
  quests.on('change', () => refresh(true));
  sync.on('snapshot', () => refresh(false));
  refresh(false); update(0);
  const resolve = (p) => typeof p === 'number' ? players.get(p) : p || players.p1;
  return {
    update, plan,
    prompt(player, fire) { const d = items.rackDecision(player, fire); return d.take ? `${items.heldBy(player) ? 'Swap for' : 'Take'} ${d.take[0].toUpperCase() + d.take.slice(1)}` : 'Swap tool'; },
    unlock(id) { if (!FIRES.some((f) => f.id === id)) return false; forced.add(id); refresh(true); return !!plan[id]; },
    stock(p, id) { return items.rackStock(typeof p === 'number' ? p : resolve(p).index, id); },
    cycle(p, id) { return items.cycleRack(resolve(p), id); },
    goto(id) { const s = plan[id]; if (!s) return false; const p = players.p1; p.teleport(s.x, s.z + 1.6); players.update?.(0); followCam?.snap(); followCam?.update?.(0, players.focus); world?.snap(); update(0); return s; },
    resetSession: () => items.resetRacks(),
    summary() { return FIRES.map((f) => {
      const r = racks.get(f.id); let calls = 0, triangles = 0;
      if (r) r.group.traverse((m) => { if (m.isMesh) { const n = 1 + (m.castShadow ? 1 : 0); calls += n; triangles += (m.geometry.index?.count || m.geometry.attributes.position.count) / 3 * n; } });
      return { fire: f.id, spot: plan[f.id], shown: !!r, visible: !!r?.group.visible, drawCalls: calls, triangles, forced: forced.has(f.id), kinds: kinds(f.id), can: !!r?.can };
    }); },
  };
}
