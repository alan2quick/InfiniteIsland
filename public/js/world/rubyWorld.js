// Screen-side Shell Ladder: registered-once targets, impact-frame requests, merged props,
// Ruby's swap / thief beats, shared befriend cinematic and local bring-along questions.
import * as THREE from 'three';
import { RUBY } from '../config.js';
import { buildRuby } from '../npc/petsEmber.js';
import { shellOf, sizeOf } from '../game/rubyLogic.js';
import { addInteractable } from './interactables.js';
import { getHeight } from './terrain.js';
import { G, VERTEX_TOON, part, combine, makeOutline } from '../render/geo.js';
import { ICONS, svg } from '../ui/icons.js';
const SHELL_ICON = svg('<path d="M5 20C1 13 3 5 11 3c6-2 11 3 10 9-1 5-7 6-10 3-3-4 0-8 3-6 2 1 1 4-1 3M5 20l8-4" fill="#fff0cd" stroke="#805137" stroke-width="2" stroke-linecap="round"/>');
const HINTS = ['A shiny bottle cap!', 'A Small Whelk is buried in the sparkling beach sand. Dig with a shovel.', 'A Turban Shell waits on the last tide-pool stone. Jump across!', 'Offer a Coconut, then hollow it with three axe or hammer hits.', 'An Ember Conch is trapped in cooled lava beside the lava-tube mouth.', 'Meet Ruby at the garden hearth. Bring 3 Obsidian, 2 Bamboo and 1 Spring Water.', 'Ruby is your friend!'];
export function createRubyWorld({ scene, ruby, plan, players, world = null, items, inventory, pets, domain, dialog, cinematic: cin, camera, particles = null, sfx = null, hud = null, thoughts = null, hop, marlo = null, hearthFire = null }) {
  marlo?.setRubyProvider?.(() => ruby.open && ruby.stage < 6 ? [{ label: 'The little bottle-cap thief?', lines: ["That little rascal's been nicking my bottle caps since the storm, crew. Lost its shell, poor thing.", HINTS[ruby.stage]] }] : []);
  hearthFire?.setMenuExtras(p => ruby.open && ruby.stage === 5 ? [{ label: 'Make Ruby a home shell', icon: ICONS.sparkle, onSelect: () => { dialog.close(); openMenu(p); } }] : []);
  const targets = [], pending = [], asks = [], asked = new Set();
  let model = null, adopted = [], t = 0, thiefT = 99, running = false, banner = false, lastHint = -99, sparkle = false;
  const full = () => !world?.regions || world.regions.isFull('ember');
  const at = () => plan[ruby.scene?.kind === 'swap' ? 'pool' : ruby.stage >= 5 ? 'hearth' : ruby.stage === 0 ? 'thief' : 'pool'];
  const shown = () => ruby.open && full();
  const puff = (p, color = '#fff0cd') => particles?.burst('sparkle', p, { count: 8, radius: 0.45, color });
  const settle = r => Promise.resolve(r).then(res => { if (res?.ok === false) hud?.toast(({ tool: 'Try the right tool.', items: 'Bring the materials from the shared bag.', shell: HINTS[ruby.stage], far: 'Come a little closer.' })[res.reason] || 'Ruby is busy. Try again.', { icon: 'sparkle' }); });
  const req = (kind, p) => settle(ruby.request(kind, p));
  function target(type, spot, prompt, active, action) {
    const p = plan[spot];
    const it = addInteractable({ type, position: new THREE.Vector3(p.x, p.y, p.z), radius: 0.65, prompt,
      canInteract: () => shown() && !ruby.scene && !cin?.busy && active(), onInteract: (_, by) => action(by) });
    it.rubySpot = spot; targets.push(it); return it;
  }
  target('ruby', 'pool', 'Offer shell', () => ruby.stage >= 1 && ruby.stage <= 4, openMenu);
  target('ruby', 'hearth', 'Make a home', () => ruby.stage === 5, openMenu);
  target('rubydig', 'dig', 'Dig', () => ruby.stage === 1 && !ruby.state.shell, p => hud?.toast('Dig here with a shovel.', { icon: 'sparkle' }));
  target('ruby', 'goal', 'Take Turban Shell', () => ruby.stage === 2 && !ruby.state.shell, p => req('hop', p));
  target('rubycoconut', 'pool', 'Hollow coconut', () => ruby.stage === 3 && ruby.state.coconut, p => hud?.toast('Three hits with an axe or hammer.', { icon: 'sparkle' }));
  target('rubycrust', 'crust', 'Free Ember Conch', () => ruby.stage === 4 && !ruby.state.shell, p => hud?.toast('Break the cooled lava with a hammer, axe or sword.', { icon: 'sparkle' }));
  // Props are one merged mesh per independently visible quest target, each with the shared outline.
  const props = {};
  function prop(id, color, scale) {
    const geo = combine([part(id === 'crust' ? G.ico1 : G.sphere, color, { p: [0, scale[1], 0], s: scale }),
      ...(id === 'crust' ? [part(G.cone6, '#f2ac74', { p: [0, 0.55, 0], s: [0.24, 0.6, 0.24], r: [0, 0, 0.6] })] : [])]);
    const mesh = new THREE.Mesh(geo, VERTEX_TOON); mesh.add(makeOutline(geo, 0.025)); scene.add(mesh); props[id] = mesh;
    const p = plan[id]; mesh.position.set(p.x, p.y + 0.02, p.z); mesh.visible = false; return mesh;
  }
  prop('dig', '#ffe3a1', [0.45, 0.05, 0.35]); prop('goal', '#c7e1bf', [0.26, 0.2, 0.24]); prop('crust', '#493943', [0.65, 0.28, 0.65]);
  // A coconut and its opened halves share one mesh. The halves spread during the swap beat.
  const coconutGeo = combine([-1, 1].map(s => part(G.sphere, '#805034', { p: [s * 0.17, 0.17, 0], s: [0.17, 0.17, 0.29] })));
  props.coconut = new THREE.Mesh(coconutGeo, VERTEX_TOON); props.coconut.add(makeOutline(coconutGeo, 0.025)); scene.add(props.coconut);
  props.coconut.position.set(plan.pool.x + 0.65, plan.pool.y, plan.pool.z + 0.2); props.coconut.visible = false;
  const trailParts = [part(G.cyl8, '#6fb8d6', { p: [plan.pool.x + 0.9, plan.pool.y + 0.012, plan.pool.z - 0.6], s: [0.85, 0.025, 0.65] })];
  for (let i = 0; i < 9; i++) for (const s of [-1, 1]) {
    const u = i / 8;
    trailParts.push(part(G.sphereLo, '#a78c6c', { p: [plan.thief.x + (plan.pool.x - plan.thief.x) * u + s * 0.13, getHeight(plan.thief.x + (plan.pool.x - plan.thief.x) * u + s * 0.13, plan.thief.z + (plan.pool.z - plan.thief.z) * u) + 0.012, plan.thief.z + (plan.pool.z - plan.thief.z) * u], s: [0.045, 0.012, 0.09] }));
  }
  const glint = new THREE.Mesh(combine([part(G.sphereLo, '#ffd54a', { s: [0.07, 0.035, 0.07] })]), VERTEX_TOON); scene.add(glint); glint.visible = false;
  const trail = new THREE.Mesh(combine(trailParts), VERTEX_TOON); scene.add(trail); trail.visible = false;
  let courseOn = false;
  function openMenu(p) {
    if (!p || dialog.isOpen || ruby.scene) return false;
    const s = ruby.state, kind = s.stage === 5 ? 'hearth' : s.stage === 3 ? 'coconut' : 'offer';
    const label = s.stage === 5 ? 'Fit the home shell' : s.stage === 3 ? 'Offer 1 Coconut' : `Offer ${s.stage === 1 ? 'Small Whelk' : s.stage === 2 ? 'Turban Shell' : 'Ember Conch'}`;
    const ready = s.stage === 5 ? Object.entries(RUBY.gifts).every(([id, n]) => inventory.count(id) >= n) : s.stage === 3 ? !s.coconut && inventory.count('coconut') > 0 : !!s.shell;
    const close = () => dialog.close();
    dialog.open({ name: s.stage === 5 ? 'Hearth Spirit & Ruby' : 'Ruby', owner: p, color: p.colors?.ui, menuId: 'ruby-offer', text: HINTS[s.stage], choices: [
      { label, disabled: !ready, onSelect: () => { close(); req(kind, p); } }, { label: 'Not now', onSelect: close }], onCancel: close });
    return true;
  }
  function toolAction(it, p) {
    if (!p || p.swinging || pending.some(q => q.p === p) || !it.canInteract()) return false;
    if (!items.swing(p, { dig: it.type === 'rubydig' })) return false;
    p.faceToward(it.position.x, it.position.z);
    pending.push({ p, kind: it.type === 'rubydig' ? 'dig' : it.type === 'rubycoconut' ? 'hit' : 'crust', left: it.type === 'rubydig' ? 0.46 : 0.3 }); return true;
  }
  ruby.on((kind, d) => {
    if (kind === 'sight') { thiefT = 0; marlo?.say("That little rascal's been nicking my bottle caps since the storm, crew. Lost its shell, poor thing."); }
    if (kind === 'queued' && d.action === 'hearth') hud?.toast('Hearth Spirit: A little obsidian, a little bamboo... welcome home, Ruby.', { icon: 'sparkle', duration: 4500 });
    if (kind === 'start') { sparkle = false; banner = false; }
    if (kind === 'dig' || kind === 'hop' || kind === 'crust') { puff(plan[d.action === 'dig' ? 'dig' : kind === 'hop' ? 'goal' : 'crust']); sfx?.play('chime', { vol: 0.5 }); }
  });
  domain?.onUnlock((id, { live }) => { if (id === 'ruby' && live) for (const p of players.list) if (!asked.has(p)) { asked.add(p); asks.push(p); } });
  // The scene camera stands on the far side of the crab from the nearest local player, a little off to the side, so the crab faces the lens with the player behind it
  // (a fixed south-east offset put the player's back in front of the crab whenever they walked up from that side). The befriend shot pulls back to fit the adopted crabs' ring.
  const _shotPos = new THREE.Vector3(), _shotLook = new THREE.Vector3();
  function sceneShot(p, wide) {
    let best = null, bd = Infinity;
    for (const pl of players.list) { const d = Math.hypot(pl.position.x - p.x, pl.position.z - p.z); if (!pl.away && d < bd) { bd = d; best = pl; } }
    let dx = 0.55, dz = 0.85;                                                          // no player near: the old south-east side
    if (best && bd > 0.05) { dx = (p.x - best.position.x) / bd; dz = (p.z - best.position.z) / bd; }
    const side = 0.45, ax = dx * Math.cos(side) - dz * Math.sin(side), az = dx * Math.sin(side) + dz * Math.cos(side);
    const dist = wide ? 5.2 : 3.6, up = wide ? 2.6 : 1.9;
    _shotPos.set(p.x + ax * dist, p.y + up, p.z + az * dist);
    const mid = best && bd < 6 ? 0.25 : 0;                                              // aim a little toward the player so both stay in frame
    _shotLook.set(p.x + (best ? (best.position.x - p.x) * mid : 0), p.y + 0.35, p.z + (best ? (best.position.z - p.z) * mid : 0));
    return { pos: _shotPos, look: _shotLook };
  }
  function endScene() { if (!running) return; running = false; cin.releaseAll(); cin.end(); }
  function update(dt) {
    t += dt; thiefT += dt;
    for (const q of [...pending]) { q.left -= dt; if (q.left <= 0) { pending.splice(pending.indexOf(q), 1); if (!q.p.leaving) req(q.kind, q.p); } }
    if (!courseOn && ruby.open) { hop.add(plan.course, { island: 'ember' }); courseOn = true; }
    const s = ruby.state, sc = ruby.scene, visible = shown() || !!sc;
    if (!model && visible) { model = buildRuby(); scene.add(model.root); }
    const finished = s.stage === 6;
    if ((finished || sc?.kind === 'befriend') && !adopted.length) adopted = ['whelk', 'turban', 'coconut'].map(shell => { const m = buildRuby({ shell, size: 0.55 }); scene.add(m.root); return m; });
    props.dig.visible = visible && s.stage === 1 && !s.shell;
    props.goal.visible = visible && s.stage === 2 && !s.shell;
    props.crust.visible = visible && s.stage === 4 && !s.shell;
    props.coconut.visible = visible && (s.coconut || sc?.kind === 'swap' && sc.from === 3);
    props.coconut.scale.x = sc?.kind === 'swap' && sc.from === 3 ? 1 + Math.min(1, ruby.sceneTime()) * 0.8 : 1;
    glint.visible = visible && (s.stage === 0 || thiefT < 2);
    glint.position.set(plan.thief.x, plan.thief.y + 0.2, plan.thief.z + 0.3);
    trail.visible = visible && s.stage >= 1;
    if (!sc) endScene();
    let st = sc ? ruby.sceneTime() : 0;
    if (sc?.startAt != null && !running && !cin?.busy && cin?.begin('ruby', { avatarsCinematic: false })) { running = true; banner = false; }
    if (running && sc) {
      cin.freezeAll();
      if (cin.pollSkip(dt, st)) ruby.skip();
      if (camera) { const p = at(), shot = sceneShot(p, sc.kind === 'befriend'); camera.position.lerp(shot.pos, Math.min(1, dt * 4)); cin.look(shot.look); }
      if (sc.kind === 'befriend' && st >= 4.5 && !banner) { banner = true; cin.showBanner([{ text: 'Ruby wants to come with you!', cls: 'fb-title' }]); sfx?.play('jingle', { vol: 0.7 }); }
    }
    if (model) {
      model.root.visible = visible && (!finished || !!sc);
      const p = at(); let x = p.x, z = p.z, anim = 'idle', shell = shellOf(s), size = sizeOf(s);
      if (thiefT < 2) { const u = Math.min(1, thiefT / 2); x = plan.thief.x + (plan.pool.x - plan.thief.x) * u; z = plan.thief.z + (plan.pool.z - plan.thief.z) * u; anim = 'walk'; }
      if (sc && sc.startAt == null) { shell = shellOf({ stage: sc.from }); size = sizeOf({ stage: sc.from }); }
      if (sc && sc.startAt != null) {
        const before = { stage: sc.from }, next = { stage: sc.from + 1 };
        shell = st < 1.8 ? shellOf(before) : shellOf(next);
        size = sizeOf(before) + (sizeOf(next) - sizeOf(before)) * Math.max(0, Math.min(1, (st - 1.8) / 0.7));
        if (st < 1.8) { x += Math.sin(st * 5) * 0.35; z += Math.cos(st * 5) * 0.35; anim = 'swap'; }
        else anim = st < 2.2 ? 'hide' : 'wave';
        if (st >= 1.8 && !sparkle) { sparkle = true; puff(p); }
      }
      if (thiefT < 2) glint.position.set(x + 0.12, p.y + 0.16, z + 0.17);
      model.setShell(shell); model.setSize(size); model.root.position.set(x, p.y, z); model.root.rotation.y = thiefT < 2 ? Math.PI / 2 : Math.sin(t * 0.3) * 0.1; model.update(dt, t, { anim, speed: anim === 'walk' ? 1 : 0 });
    }
    adopted.forEach((m, i) => {
      const born = finished || (sc?.kind === 'befriend' && st >= 2.3 + i * 0.35);
      m.root.visible = visible && (born || sc?.kind === 'befriend');
      const p = finished ? plan.pool : plan.hearth, u = finished ? t * 0.5 + i * 2.1 : Math.max(0, st - 2.3 - i * 0.35);
      m.root.position.set(p.x + Math.sin(u + i * 2.1) * (finished ? 1.3 : Math.min(1.5, u)), p.y, p.z + Math.cos(u + i * 2.1) * (finished ? 1.3 : Math.min(1.5, u)));
      m.root.rotation.y = u + i * 2.1 + Math.PI / 2; m.update(dt, t + i, { anim: born ? 'walk' : 'hide', speed: 0.5 });
    });
    if (visible && !sc && !cin?.busy) {
      const near = players.list.find(p => !p.away && !p.frozen && Math.hypot(p.position.x - at().x, p.position.z - at().z) <= RUBY.sight);
      if (near && s.stage === 0) req('sight', near);
      if (near && s.stage > 0 && s.stage < 6 && t - lastHint > 8) { lastHint = t; thoughts?.show('ruby-shell', () => ({ ...at(), y: at().y + 0.65 }), SHELL_ICON, { seconds: 3 }); hud?.toast(HINTS[s.stage], { icon: 'sparkle', duration: 4000 }); }
      if (props.dig.visible && Math.floor(t * 2) !== Math.floor((t - dt) * 2)) puff(plan.dig);
    }
    if (asks.length && !dialog.isOpen && !cin?.busy && !sc) {
      const p = asks.shift();
      if (players.list.includes(p) && !p.away) { const close = () => dialog.close(); dialog.open({ name: 'Ruby', owner: p, color: p.colors?.ui, menuId: 'ruby-ask', text: 'Bring Ruby along?', choices: [
        { label: 'Yes!', icon: ICONS['pet-ruby'], onSelect: () => { close(); pets.set(p, 'ruby', { fx: true }); } }, { label: 'Not now', onSelect: close }], onCancel: close }); }
    }
  }
  return { update, toolAction, openMenu, interactables: targets, get model() { return model; }, get adopted() { return adopted; },
    summary() { let drawCalls = 0, triangles = 0; for (const root of [model?.root, ...adopted.map(m => m.root), ...Object.values(props), trail, glint]) root?.traverseVisible(o => { if (o.isMesh) { drawCalls += o.castShadow ? 2 : 1; triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3; } }); return { shown: shown(), drawCalls, triangles, spot: at(), adopted: adopted.length, interactables: targets.length, plan: plan.summary() }; } };
}
