// The world side of Carle's quest line "The Very Hungry Visitor" (PLAN Step 74b): the caterpillar on its own small sapling near the home campfire, the first-sight beat, the hunger / full / tummy-ache bubbles, the feeding
// menu, the munching beat with the item's own pickup model, growth, the tummy ache tint and its cure, and (placeholder) the cocoon hanging from the sapling's short branch after the seventh day. Everything here is COSMETIC
// and per screen except what the `carle` domain (game/carle.js) decides: every screen derives what it shows from that synced state and its own players' positions.
//
//   const cw = createCarleWorld({ scene, players, world, sync, carle, plan, domain, inventory, thoughts, particles, sfx, hud, dialog, cinematic, floatText?, heightAt })
//     carle = game/carle.js    plan = world/islands/homeCarle.js    domain = the `pets` unlock domain (a LIVE first unlock scales the sapling and the caterpillar in; a load / late join shows them silently)
//   cw.update(dt)                       once per tick (any time after players.update)
//   cw.interactables                    [the `carle` interactable at the sapling] (registered once)
//   cw.openMenu(player)                 the feeding menu (debug / the interactable's onInteract)       cw.shown / cw.where / cw.beat / cw.summary()
//   cw.model / cw.cocoon                the 74a skinned models (null until first needed)
//
// The sapling (saplingGeometry: ONE merged vertex-coloured mesh + outline hull = 2 draw calls, VERTEX_TOON) is a young plant about 1.25 u tall with a few oversized flat leaves; the biggest leaf, on the camera side, carries the
// caterpillar (nothing above it), and a short branch on the other side carries the cocoon. It is never felled: one small trunk collider, registered ONCE the first time the quest is open (nothing blocks the spot before). It is absent
// until the quest opens (pets.questlinesOpen / ?testcarle, or the stage is above 0). Where: stage 0 it sits on the leaf; a local player within CARLE.sight asks the host for stage 1 (the beat: it looks up, a "?" bubble, then the
// hunger bubble). While hungry a bubble with the icon(s) of today's food shows now and then when someone is near; full: a "Zzz" bubble; the day-6 tummy ache: a green face, an "ugh" bubble and a slow roll until the mint.
// Draw calls: the caterpillar 2, the sapling 2, a food piece 2 each (up to 3) during a beat; the cocoon 2 instead of the caterpillar. Visuals are built lazily. The popping in is a scale-in with a little overshoot (popIn.js works on
// merged geometry, not skinned models). The interactable's prompt: "Hungry..." / "Offer" / "Look".
// TODO 74c: the climb / spin cinematic, the cocoon day counting + "Listen", the hatch and Carle as a follower pet; here the cocoon simply replaces the caterpillar after the seventh day's beat.
import * as THREE from 'three';
import { CARLE } from '../config.js';
import { createWipPetModel } from '../npc/petsWip.js';
import { createFoodModel } from './pickups.js';
import { addCollider } from './colliders.js';
import { G, part, combine, VERTEX_TOON, makeOutline, smoothOutlineGeo } from '../render/geo.js';
import { addInteractable } from './interactables.js';
import { getItem } from '../game/catalog.js';
import { wantsOf, nextOf, isFull, ache, growth, needLine, hintsFor, DAY_COUNT } from '../game/carleLogic.js';
import { ICONS } from '../ui/icons.js';
import { actorKey } from '../net/worldSync.js';

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
const HINT_RANGE = 9, HINT_EVERY = 8; // a hint bubble shows when a local player is this close, at most this often (s)
const WHY = {
  locked: 'Nothing here yet.', unseen: 'It has not noticed you yet.', done: 'It is all wrapped up.', 'wrong-day': 'It wants something else now.', full: 'It is full for today. Come back tomorrow!',
  far: 'A little closer.', none: 'You do not have what it wants.', seen: '', offline: 'The island is quiet. Try again.',
};

/** The sapling in LOCAL coordinates (origin at the trunk's foot on the ground, +Z toward the camera): a thin trunk about 1.25 u tall, the BIG leaf the caterpillar sits on (centre CARLE.sapling.leafOut toward +Z, leafY up, its
 *  long axis along X so the caterpillar is seen side-on), three more oversized flat leaves lower down and behind, a bud on top and the short branch (toward +X, hangY up) the cocoon hangs from. One merged geometry. */
export function saplingGeometry() {
  const S = CARLE.sapling, parts = [];
  parts.push(part(G.cyl6, '#7a5232', { p: [0, 0.36, 0], s: [0.075, 0.72, 0.075] }));
  parts.push(part(G.cyl6, '#5fa23a', { p: [0, 0.99, 0], s: [0.055, 0.54, 0.055] }));
  parts.push(part(G.sphereLo, '#7a5232', { p: [0, 0.04, 0], s: [0.13, 0.08, 0.13] }));
  parts.push(part(G.sphereLo, '#ffb6d2', { p: [0, S.height + 0.02, 0], s: [0.065, 0.08, 0.065] }));                                   // the bud
  const leaf = (x, y, z, sx, sz, yaw, tiltZ, tiltX, color, vein) => {
    parts.push(part(G.sphere, color, { p: [x, y, z], r: [tiltX, yaw, tiltZ], s: [sx, 0.045, sz] }));
    parts.push(part(G.sphere, vein, { p: [x, y + 0.04, z], r: [tiltX, yaw, tiltZ], s: [sx * 0.92, 0.011, 0.02] }));
  };
  leaf(0, S.leafY, S.leafOut, 0.62, 0.34, 0, 0, 0, '#6fb83a', '#3f8a2c');                                                            // the big flat leaf (the caterpillar's seat)
  parts.push(part(G.cyl6, '#5fa23a', { p: [0, S.leafY - 0.03, S.leafOut * 0.4], r: [Math.PI / 2, 0, 0], s: [0.03, S.leafOut * 0.8, 0.03] }));     // its stalk
  leaf(-0.42, 0.46, -0.26, 0.5, 0.3, 0.6, 0.14, 0, '#58b567', '#2f7a3a');
  leaf(0.38, 0.38, -0.4, 0.46, 0.28, -0.5, -0.12, 0, '#7fcf4a', '#3f8a2c');
  leaf(-0.1, 1.08, -0.3, 0.34, 0.2, 0.3, 0, -0.3, '#58b567', '#2f7a3a');
  parts.push(part(G.cyl6, '#7a5232', { p: [0.29, S.hangY, 0], r: [0, 0, Math.PI / 2], s: [0.035, 0.58, 0.035] }));                         // the short branch for the cocoon
  parts.push(part(G.sphereLo, '#6fb83a', { p: [0.52, S.hangY + 0.04, 0.02], s: [0.1, 0.02, 0.06] }));                                   // a small leaf on its tip
  return combine(parts);
}

export function createCarleWorld({
  scene, players, world = null, sync, carle, plan, domain = null, inventory, thoughts = null, particles = null, sfx = null, hud = null, dialog, cinematic: cin = null, floatText = null, heightAt,
}) {
  const snd = (name, opts) => { if (sfx) sfx.play(name, opts); };
  const here = () => !world || world.regions.isFull('home');
  const st = () => carle.state;
  const time = { t: 0 };
  const sap = plan.sapling, perch = plan.perch, hang = plan.hang;
  const localKeyOf = (p) => actorKey(sync.actorFor(p));
  const anyPerch = !!(sap && perch);

  // ------------------------------------------------------------------ the sapling (a visual prop, built on first use) and where the caterpillar sits (always the leaf)
  let prop = null, collided = false;
  function makeProp() {
    const geo = saplingGeometry();
    const mesh = new THREE.Mesh(geo, VERTEX_TOON);
    mesh.castShadow = false; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.visible = false;
    mesh.add(makeOutline(geo, 0.03, smoothOutlineGeo(geo)));
    mesh.position.set(sap.x, sap.y, sap.z);
    scene.add(mesh);
    return mesh;
  }
  const at = { spot: null, x: perch ? perch.x : 0, y: perch ? perch.y : 0, z: perch ? perch.z : 0, yaw: perch ? perch.yaw : 0 };

  // ------------------------------------------------------------------ the models (lazy)
  let cat = null, cocoon = null, everBuilt = false;
  const buildModels = () => {
    if (cat) return;
    cat = createWipPetModel('carle:caterpillar');
    cat.root.rotation.order = 'YXZ';
    cat.root.visible = false;
    scene.add(cat.root);
    cocoon = createWipPetModel('carle:cocoon');
    cocoon.root.visible = false;
    scene.add(cocoon.root);
    everBuilt = true;
  };

  // ------------------------------------------------------------------ the interactable (registered ONCE, at the leaf)
  const iSap = anyPerch ? addInteractable({
    type: 'carle', object: null, position: new THREE.Vector3(perch.x, perch.y, perch.z), radius: 0.9, prompt: 'Look',
    canInteract: () => visible() && st().stage >= 1,
    onInteract: (item_, by) => { openMenu(by || players.p1); },
  }) : null;
  const interactables = iSap ? [iSap] : [];

  // ------------------------------------------------------------------ state of the show
  const show = { visible: false, scale: 1, pop: null, popLive: -99, ache: 0, cured: null, cocoonOn: false, sightBeat: null, feedBeat: null, hintT: 0, fullT: 0, lastHint: -99, rollK: 0, goodbye: null };
  let liveUnlockAt = -99;
  const visible = () => show.visible;
  const wantVisible = () => anyPerch && here() && (carle.open || st().stage > 0);

  const anchor = () => ({ x: at.x, y: at.y + 0.55 * show.scale, z: at.z });
  const bubble = (key, icon, seconds = CARLE.beat.hunger, lift = 0.35) => { if (thoughts) thoughts.show(key, anchor, icon, { seconds, lift }); };
  const itemIcon = (id) => (getItem(id) ? getItem(id).icon : '');
  const iconsOf = (items) => {
    const ids = Object.keys(items);
    return ids.length === 1 ? itemIcon(ids[0]) : `<span style="display:inline-flex;gap:3px;align-items:center">${ids.map(itemIcon).join('')}</span>`;
  };
  const puff = (kind, o = {}) => { if (particles) particles.burst(kind, { x: at.x, y: at.y + 0.3 * show.scale, z: at.z }, { count: 6, radius: 0.4, height: 0.2, ...o }); };
  const nearestLocal = () => {
    let best = null, bd = Infinity;
    for (const p of players.list) {
      if (p.away || p.frozen) continue;
      const d = Math.hypot(p.position.x - at.x, p.position.z - at.z);
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { p: best, d: bd } : null;
  };

  // ------------------------------------------------------------------ requests
  const toastWhy = (reason) => { if (hud && WHY[reason]) hud.toast(WHY[reason], { icon: 'sparkle', duration: 2400 }); };
  const settle = (res, onOk = null) => Promise.resolve(res).then((r) => { if (r && r.ok === false) toastWhy(r.reason); else if (onOk) onOk(r); }, () => toastWhy('offline'));

  // ------------------------------------------------------------------ the menu
  function haveAll(items) { return Object.entries(items).every(([id, n]) => inventory.count(id) >= n); }
  function offerRow(items, p) {
    const ok = haveAll(items);
    return {
      label: `Offer ${needLine(items)}`,
      detail: ok ? '' : hintsFor(items, (id) => inventory.count(id)).join(' '),
      chips: Object.entries(items).map(([id, n]) => ({ icon: itemIcon(id), have: inventory.count(id), need: n })),
      disabled: !ok,
      onSelect: () => { dialog.close(); p.faceToward(at.x, at.z); settle(carle.feed(p, st().day + 1)); },
    };
  }
  function openMenu(p) {
    if (!p || dialog.isOpen) return false;
    const s = st();
    const common = { name: 'Little Caterpillar', owner: p, tag: players.multi ? p.colors.name : '', color: p.colors.ui };
    p.faceToward(at.x, at.z);
    if (s.stage >= 3) {                                          // TODO 74c: "Listen" (the tapping, how close the hatch is) and "Watch" when it is ready
      dialog.open({ ...common, pages: ['Snug in its cocoon. Something is changing in there...'] });
      return true;
    }
    if (isFull(s)) {
      dialog.open({ ...common, pages: ['Zzz... Full! Come back tomorrow.'] });
      return true;
    }
    const items = wantsOf(s);
    if (!items) { dialog.open({ ...common, pages: ['...?'] }); return true; }
    const closeUp = () => dialog.close();
    dialog.open({
      ...common, menuId: 'carle-feed',
      text: ache(s) ? 'Ugh... my tummy... Something green and cool, maybe?' : `Day ${s.day + 1}: Munch munch? I am so hungry!`,
      choices: () => [offerRow(items, p), { label: 'Not now', onSelect: closeUp }],
      onCancel: closeUp,
    });
    return true;
  }

  // ------------------------------------------------------------------ the feeding beat
  function foodPiece(id) {
    let mesh = createFoodModel(id);
    if (!mesh) {                                                  // a dish has no ground model: a plain lump in the dish's colour
      const geo = combine([part(G.sphere, getItem(id) ? getItem(id).color : '#e8b56b', { p: [0, 0.12, 0], s: [0.14, 0.12, 0.14] })]);
      mesh = new THREE.Mesh(geo, VERTEX_TOON);
      mesh.add(makeOutline(geo, 0.025, smoothOutlineGeo(geo)));
    }
    mesh.frustumCulled = false; mesh.castShadow = false;
    scene.add(mesh);
    return mesh;
  }
  function disposeMesh(mesh) {
    scene.remove(mesh);
    mesh.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  }
  function startFeed(d, stateAfter) {
    if (!cat) buildModels();
    endFeed(true);
    const items = Object.entries(CARLE.days[clamp(d.day - 1, 0, DAY_COUNT - 1)].items);
    const pieces = [];
    for (const [id, n] of items) for (let k = 0; k < (items.length === 1 ? Math.min(n, 3) : 1); k++) { const mesh = foodPiece(id); pieces.push({ id, mesh, base: mesh.scale.x || 1, bites: 0 }); }   // one piece per count (up to 3); the feast: one dish each
    show.feedBeat = { t: 0, day: d.day, pieces, items, cocoon: stateAfter.stage >= 3, hearts: false, cure: d.day === DAY_COUNT };
    thoughts && thoughts.hide('carle-hint');
    if (floatText && d.actor) {
      const who = players.list.find((p) => localKeyOf(p) === d.actor);
      if (who) for (const [id, n] of items) floatText(id, -n, { x: who.position.x, y: who.position.y + 1.8, z: who.position.z }, who);
    }
  }
  function endFeed(silent = false) {
    const b = show.feedBeat;
    if (!b) return;
    for (const pc of b.pieces) disposeMesh(pc.mesh);
    show.feedBeat = null;
    if (silent) return;
  }
  const forward = () => ({ x: Math.sin(at.yaw), z: Math.cos(at.yaw) });
  function stepFeed(dt) {
    const b = show.feedBeat;
    if (!b) return;
    b.t += dt;
    const E = CARLE.beat.eat, f = forward(), sc = show.scale;
    const bites = [0.28 * E, 0.52 * E, 0.76 * E];                // three nibbles per piece (the item's model shrinks in steps: the "bite-shaped chunk" of the plan)
    b.pieces.forEach((pc, i) => {
      const base = 0.5 * sc + 0.12 * i, side = (i - (b.pieces.length - 1) / 2) * 0.22;
      pc.mesh.position.set(at.x + f.x * base - f.z * side, at.y + 0.3 * sc + 0.03 * Math.sin(time.t * 5 + i), at.z + f.z * base + f.x * side);
      const done = bites.filter((tb) => b.t >= tb + i * 0.06).length;
      if (done > pc.bites) { pc.bites = done; snd('nom', { pitch: 1.1 + 0.08 * done, vol: 0.7 }); puff('chip', { count: 3, radius: 0.12, color: getItem(pc.id) ? getItem(pc.id).color : '#ffffff' }); }
      const s = (1 - pc.bites * 0.3) * (1 + 0.04 * Math.sin(b.t * 20)) * (b.t >= E * 0.9 ? 0 : 1);
      pc.mesh.scale.setScalar(Math.max(0.0001, s * pc.base));
      pc.mesh.visible = s > 0.02;
    });
    if (!b.hearts && b.t >= E * 0.92) {
      b.hearts = true;
      puff('heart', { count: 5, radius: 0.5 });
      snd('chime', { pitch: 1.4, vol: 0.5 });
      if (b.cocoon) bubble('carle-say', ICONS.heart || ICONS.sparkle, 2.2);
    }
    if (b.t >= E) {
      const stage3 = b.cocoon, cure = b.cure;
      endFeed();
      if (cure) show.cured = { t: 0 };
      if (stage3) show.goodbye = { t: 0, wait: cure ? 1.6 : 0 };      // the week is done: after the cure's wiggle, the goodbye bubbles, then the cocoon
    }
  }

  // ------------------------------------------------------------------ the first-sight beat (stage 0 -> 1)
  function startSight() {
    show.sightBeat = { t: 0, q: false, hungry: false };
    show.lastHint = time.t;
  }
  function stepSight(dt) {
    const b = show.sightBeat;
    if (!b) return;
    b.t += dt;
    if (!b.q && b.t >= 0.4) { b.q = true; bubble('carle-say', ICONS['thought-question'], 2.2); snd('pop', { pitch: 1.2, vol: 0.5 }); puff('sparkle', { count: 4, color: '#fff3a0' }); }
    if (!b.hungry && b.t >= 2.7) { b.hungry = true; const items = nextOf(st()); if (items) bubble('carle-say', iconsOf(items), CARLE.beat.hunger); }
    if (b.t >= 6) show.sightBeat = null;
  }

  // ------------------------------------------------------------------ hints while idle
  function stepHints(dt) {
    if (show.feedBeat || show.sightBeat || show.goodbye) return;
    const s = st();
    if (s.stage < 1 || s.stage >= 3 || time.t - show.lastHint < HINT_EVERY) return;
    const n = nearestLocal();
    if (!n || n.d > HINT_RANGE) return;
    show.lastHint = time.t;
    if (isFull(s)) bubble('carle-hint', ICONS['thought-zzz'], 2.6);
    else if (ache(s)) bubble('carle-hint', ICONS['thought-ugh'], 2.8);
    else { const items = wantsOf(s); if (items) bubble('carle-hint', iconsOf(items), CARLE.beat.hunger); }
  }

  // ------------------------------------------------------------------ the goodbye after day 7 (74c replaces it with the climb / spin cinematic)
  function stepGoodbye(dt) {
    const g = show.goodbye;
    if (!g) return;
    if (g.wait > 0) { g.wait -= dt; return; }
    g.t += dt;
    if (!g.said && g.t >= 0.2) { g.said = true; bubble('carle-say', ICONS['thought-cocoon'], 2.4); snd('jingle', { pitch: 1.05, vol: 0.55 }); }
    if (!g.puffed && g.t >= 1.4) { g.puffed = true; puff('sparkle', { count: 14, radius: 0.5, height: 0.5, color: '#fff3d6' }); puff('puff', { count: 6 }); }
    if (g.t >= 1.6) show.goodbye = null;
  }

  // ------------------------------------------------------------------ events
  carle.on((kind, d) => {
    if (kind === 'sight') { if (here()) startSight(); return; }
    if (kind === 'feed') {
      if (here() && cat) startFeed(d, st());
      else if (here()) { buildModels(); startFeed(d, st()); }
      return;
    }
    if (kind === 'dawn') { show.lastHint = -99; return; }
    // set / reset / snapshot: jump straight to the state (no animation)
    endFeed(true); show.sightBeat = null; show.goodbye = null; show.cured = null;
    show.scale = growth(st());
    show.ache = ache(st()) ? 1 : 0;
    if (cat) cat.setAche(show.ache);
  });
  if (domain) domain.onUnlock((id, { live }) => { if (live) liveUnlockAt = time.t; });

  // ------------------------------------------------------------------ the sighting: somebody walks up to it
  let sightCooldown = 0;
  function stepSighting(dt) {
    sightCooldown = Math.max(0, sightCooldown - dt);
    if (st().stage !== 0 || !show.visible || sightCooldown > 0 || !carle.open || (cin && cin.busy)) return;
    const n = nearestLocal();
    if (n && n.d <= CARLE.sight) { sightCooldown = 3; settle(carle.sight(n.p)); }
  }

  // ------------------------------------------------------------------ per frame
  function layout(dt) {
    const s = st();
    const catOn = show.visible && (s.stage < 3 || !!show.feedBeat || !!show.goodbye);
    const cocoonOn = show.visible && s.stage >= 3 && !show.feedBeat && !show.goodbye;
    let propK = 1;                                              // the sapling scales in with the caterpillar
    if (cat) {
      cat.root.visible = !!catOn;
      if (catOn) {
        let anim = 'idle', yaw = at.yaw, roll = 0, sy = 1;
        if (show.feedBeat) anim = 'nibble';
        const target = growth(s), prev = show.scale;
        show.scale += (target - prev) * Math.min(1, dt * 1.6);
        let scale = show.scale;
        if (show.pop) {                                          // the live pop-in: scale 0 -> overshoot -> 1
          show.pop.t += dt;
          const u = clamp(show.pop.t / 0.6);
          const k = u < 0.6 ? smooth(u / 0.6) * 1.12 : 1.12 - 0.12 * smooth((u - 0.6) / 0.4);
          scale *= k; propK = k;
          if (u >= 1) show.pop = null;
        }
        const wantAche = ache(s) && !show.feedBeat ? 1 : 0;
        show.ache += (wantAche - show.ache) * Math.min(1, dt * 1.2);
        if (Math.abs(show.ache - wantAche) < 0.01) show.ache = wantAche;
        cat.setAche(show.ache);
        if (show.ache > 0.05) roll = Math.sin(time.t * 1.3) * 0.28 * show.ache;     // the slow roll of a tummy ache
        if (show.cured) {                                        // the cure: a happy wiggle and a big stretch
          show.cured.t += dt;
          const u = clamp(show.cured.t / 2);
          yaw += Math.sin(show.cured.t * 16) * 0.22 * (1 - u);
          sy = 1 + 0.3 * Math.sin(Math.min(1, u * 1.6) * Math.PI);
          if (u >= 1) show.cured = null;
        }
        if (show.sightBeat && show.sightBeat.t < 2.2) yaw += Math.sin(show.sightBeat.t * 2.2) * 0.35;   // it looks around, then up at whoever came
        cat.root.position.set(at.x, at.y, at.z);
        cat.root.rotation.set(0, yaw, roll);
        cat.root.scale.set(scale, scale * sy, scale);
        cat.update(dt, time.t, { anim });
      }
    }
    if (cocoon) {
      cocoon.root.visible = !!cocoonOn;
      if (cocoonOn) {
        cocoon.root.position.set(hang.x, hang.y - 0.02, hang.z);             // its own twig lies along the sapling's short branch, touching it (the branch runs toward +X)
        cocoon.root.rotation.set(0, 0, 0);
        cocoon.root.scale.setScalar(1);
        cocoon.update(dt, time.t, { anim: 'idle' });                           // the sway; TODO 74c: wiggle more often as the hatch nears
      }
    }
    show.cocoonOn = !!cocoonOn;
    if (prop) prop.scale.setScalar(Math.max(0.0001, propK));
  }

  function update(dt) {
    dt = Math.min(dt, 0.1);
    time.t += dt;
    const was = show.visible;
    show.visible = wantVisible();
    if (show.visible && !everBuilt) {
      buildModels();
      show.scale = growth(st());
      show.ache = ache(st()) ? 1 : 0;
      cat.setAche(show.ache);
    }
    if (!show.visible) {
      if (was) { if (cat) cat.root.visible = false; if (cocoon) cocoon.root.visible = false; if (prop) prop.visible = false; endFeed(true); }
      return;
    }
    // the sapling (built and its trunk collider registered ONCE, the first time the quest is open) and the caterpillar on its leaf
    if (!prop) prop = makeProp();
    if (!collided) { collided = true; addCollider({ x: plan.collider.x, z: plan.collider.z, r: plan.collider.r, owner: prop }); }
    prop.visible = true;
    if (!was || !at.spot) {
      at.spot = 'sapling'; at.x = perch.x; at.y = perch.y; at.z = perch.z; at.yaw = perch.yaw;
      if (liveUnlockAt > -90 && time.t - liveUnlockAt < 20 && st().stage === 0 && !show.pop) { show.pop = { t: 0 }; liveUnlockAt = -99; snd('pop', { pitch: 0.9, vol: 0.6 }); puff('sparkle', { count: 8, radius: 0.6, color: '#b6f58a' }); }
    }
    stepSighting(dt);
    stepSight(dt);
    stepFeed(dt);
    stepGoodbye(dt);
    stepHints(dt);
    layout(dt);
    // the prompts
    const s = st(), items = wantsOf(s);
    const prompt = s.stage >= 3 ? 'Look' : isFull(s) ? 'Look' : items ? (haveAll(items) ? 'Offer' : 'Hungry...') : 'Look';
    for (const it of interactables) it.prompt = prompt;
  }

  return {
    update, openMenu, interactables,
    get shown() { return show.visible; },
    get where() { return { spot: at.spot, x: +at.x.toFixed(2), y: +at.y.toFixed(2), z: +at.z.toFixed(2), hopping: false }; },
    get beat() { return { sight: !!show.sightBeat, feed: show.feedBeat ? { t: +show.feedBeat.t.toFixed(2), day: show.feedBeat.day } : null, goodbye: !!show.goodbye, cured: !!show.cured }; },
    get model() { return cat; },
    get sapling() { return prop; },
    get cocoon() { return cocoon; },
    get scale() { return show.scale; },
    get ache() { return show.ache; },
    summary() {
      let calls = 0;
      if (cat && cat.root.visible) calls += cat.drawCalls;
      if (cocoon && cocoon.root.visible) calls += cocoon.drawCalls;
      if (prop && prop.visible) calls += 2;
      if (show.feedBeat) calls += 2 * show.feedBeat.pieces.length;
      return { stage: st().stage, shown: show.visible, where: this.where, beat: this.beat, scale: +show.scale.toFixed(3), ache: +show.ache.toFixed(2), cocoon: show.cocoonOn, drawCalls: calls, interactables: interactables.length, plan: plan.summary() };
    },
  };
}
