// Journal showcase: when a Journal find lands (game/collection.js onFound), the finder strikes a "look what I found!" pose and holds
// an oversized model of the find (player/journalModels.js) high above their raised hand, with a soft halo of rays and sparkles.
//
//   const showcase = createJournalShowcase({ scene, camera, players, avatars, sync, particles });
//   showcase.show(id, actor)    // actor = { screen, index } from the collection event: a local player on that screen, a remote avatar elsewhere
//   showcase.update(dt)         // every frame (main.js tick, after the players / avatars moved)
//   showcase.summary()          // debug: [{ id, slot, t }]
//
// Purely cosmetic and per screen: every screen gets the same `found` event and poses the same character (its own local player or
// that player's avatar), nothing is synced. Walking away ends the pose early. Costs two draw calls while it shows (model + halo).
import * as THREE from 'three';
import { createJournalModel } from '../player/journalModels.js';
import { buildItemModel } from '../items/models.js';

// Step 86b: Im Nabong's watering can is shown the same way ("id" = 'watering-can'; it is not a Journal find). The tool model is built for a hand (about a metre long), so it is shown smaller.
function toolShowModel(id) {
  if (id !== 'watering-can') return null;
  const item = buildItemModel(id), g = new THREE.Group();
  g.name = 'showcase-' + id; g.add(item);
  g.userData.fit = 0.62;
  g.userData.dispose = () => item.traverse((m) => { if (m.isMesh) m.geometry.dispose(); });
  return g;
}

const DUR = 2.8;          // seconds the find is shown
const MIN = 0.6;          // walking before this does not cut it short (the finder was usually just mid-swing)
const POP = 0.38;         // pop-in time (ease out back)
const SHRINK = 0.25;      // shrink-away time at the end
const LIFT = 1.05;        // model centre above the raised hand
const SIZE = 2.2;         // the models are about 0.6 u; shown off they are bigger than the finder's head
const FORE = 0.45;        // pulled this far toward the camera so the head never cuts into it

const easeOutBack = (u) => { const k = 2.2; return 1 + (k + 1) * (u - 1) ** 3 + k * (u - 1) ** 2; };

function haloTexture() {
  const s = 128, cv = document.createElement('canvas');
  cv.width = cv.height = s;
  const g = cv.getContext('2d'), c = s / 2;
  g.translate(c, c);
  for (let i = 0; i < 12; i++) {                         // twelve soft rays
    g.rotate(Math.PI / 6);
    const grad = g.createLinearGradient(0, 0, 0, -c);
    grad.addColorStop(0, 'rgba(255,246,190,0.75)'); grad.addColorStop(1, 'rgba(255,246,190,0)');
    g.fillStyle = grad;
    g.beginPath(); g.moveTo(-5, 0); g.lineTo(-11, -c); g.lineTo(11, -c); g.lineTo(5, 0); g.closePath(); g.fill();
  }
  const glow = g.createRadialGradient(0, 0, 0, 0, 0, c * 0.6);
  glow.addColorStop(0, 'rgba(255,255,235,0.9)'); glow.addColorStop(1, 'rgba(255,240,180,0)');
  g.fillStyle = glow; g.fillRect(-c, -c, s, s);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createJournalShowcase({ scene, camera, players, avatars, sync, particles }) {
  const shows = new Map();                               // player -> { id, p, model, halo, t, local }
  let tex = null;
  const hand = new THREE.Vector3(), toCam = new THREE.Vector3();

  function playerFor(actor) {
    if (!actor) return null;
    if (actor.screen === sync.screenId) return players.list.find((p) => p.index === actor.index) || null;
    return avatars?.get(actor.index) || null;
  }

  function end(s, { quiet = false } = {}) {
    shows.delete(s.p);
    s.p.showoff = false;
    s.p.parts.handSocket.visible = true;
    scene.remove(s.model, s.halo);
    s.model.userData.dispose();
    s.halo.material.dispose();
    if (!quiet) particles.burst('sparkle', s.model.position, { count: 10, radius: 0.5, speed: 1.2 });
  }

  function show(id, actor) {
    const p = playerFor(actor);
    if (!p || p.pageDrive || p.downed) return false;
    const old = shows.get(p);
    if (old) end(old, { quiet: true });
    const model = createJournalModel(id) || toolShowModel(id);
    if (!model) return false;
    tex ||= haloTexture();
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    halo.renderOrder = 3;
    model.scale.setScalar(0.001);
    scene.add(halo, model);
    const local = actor.screen === sync.screenId;
    p.showoff = true;
    p.parts.handSocket.visible = false;                 // the held tool steps aside for the find
    if (local) { p.faceToward(camera.position.x, camera.position.z); p.squash(0.2); }
    shows.set(p, { id, p, model, halo, t: 0, local, sparked: false, fit: model.userData.fit || 1 });
    return true;
  }

  function update(dt) {
    for (const s of [...shows.values()]) {
      s.t += dt;
      const { p, model, halo, t } = s;
      if (!p.root.parent || t >= DUR || (t > MIN && p.speed > 1.2) || p.pageDrive || p.downed) { end(s); continue; }
      p.parts.handSocket.getWorldPosition(hand);
      const k = t < POP ? Math.max(0.001, easeOutBack(t / POP)) : t > DUR - SHRINK ? Math.max(0.001, (DUR - t) / SHRINK) : 1;
      model.position.set(hand.x, hand.y + LIFT * Math.min(1, k) + Math.sin(t * 4) * 0.04, hand.z);
      model.position.addScaledVector(toCam.subVectors(camera.position, model.position).normalize(), FORE);   // (along the view ray: same spot on screen, just nearer)
      model.scale.setScalar(k * SIZE * s.fit);
      model.rotation.set(0, Math.atan2(camera.position.x - model.position.x, camera.position.z - model.position.z) + Math.sin(t * 2.2) * 0.4, Math.sin(t * 3) * 0.08);
      toCam.subVectors(camera.position, model.position).normalize();
      halo.position.copy(model.position).addScaledVector(toCam, -0.45);
      halo.scale.setScalar(1.25 * SIZE * k * s.fit);
      halo.material.rotation += dt * 0.7;
      halo.material.opacity = 0.45 * Math.min(1, t / 0.2) * (t > DUR - SHRINK ? (DUR - t) / SHRINK : 1);
      if (!s.sparked && t > 0.05) {
        s.sparked = true;
        particles.burst('sparkle', model.position, { count: 16, radius: 0.6, speed: 2, ring: true });
      }
      if (t - dt < 0.55 && t >= 0.55) particles.burst('sparkle', model.position, { count: 8, radius: 0.7, speed: 0.8 });
    }
  }

  return {
    show, update,
    get active() { return shows.size; },
    summary: () => [...shows.values()].map((s) => ({ id: s.id, slot: s.p.index, t: +s.t.toFixed(2) })),
  };
}
