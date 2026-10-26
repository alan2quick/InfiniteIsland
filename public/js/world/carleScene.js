// Carle's screen-side cinematics: update(dt) samples the host scene clock, animates the climb / hatch,
// owns cinematic.js until the shared finish/skip, and disposes all four temporary butterflies on exit.
import * as THREE from 'three';
import { CARLE } from '../config.js';
import { createPetModel } from '../npc/pets.js';
const clamp = (v) => Math.max(0, Math.min(1, v));
const smooth = (v) => { const u = clamp(v); return u * u * (3 - 2 * u); };
export function createCarleScene({ scene, carle, plan, cinematic: cin, camera, models, particles, sfx }) {
  let run = null;
  const butterflies = [], look = new THREE.Vector3(), shot = new THREE.Vector3();
  function end() {
    if (!run) return;
    for (const m of butterflies.splice(0)) m.dispose();
    run = null;
    cin.releaseAll(); cin.end();
  }
  function update(dt) {
    const sc = carle.scene;
    if (!sc || sc.startAt === null) { end(); return; }
    if (!cin?.begin) return;
    if (run && run.startAt !== sc.startAt) end();
    if (!run) {
      if (cin.busy || !cin.begin('carle', { avatarsCinematic: false })) return;
      run = { startAt: sc.startAt, banner: false, silk: -1 };
      if (sc.kind === 'hatch') for (let k = 0; k < 4; k++) { const m = createPetModel('carle'); scene.add(m.root); butterflies.push(m); }
    }
    const t = Math.max(0, (carle.now() - sc.startAt) / 1000), { cat, cocoon } = models();
    const h = plan.hang, p = plan.perch, f = sc.watcher || { x: p.x, y: p.y - CARLE.sapling.leafY, z: p.z + 2 };
    cin.freezeAll();
    if (cin.pollSkip(dt, t)) { carle.skip(); return; }
    look.set((h.x + f.x) / 2, h.y + 0.25, (h.z + f.z) / 2);
    shot.set(look.x + 3.5, look.y + 2.7, look.z + 5.5);
    const k = smooth(t / 0.8);
    if (camera) { camera.position.lerpVectors(cin.startPos, shot, k); look.lerpVectors(cin.startLook, look.clone(), k); cin.look(look); }
    if (sc.kind === 'cocoon') {
      const u = smooth(t / 2.6);
      cat.root.visible = t < 3.5;
      cat.root.position.set(p.x + (h.x - p.x) * u, p.y + (h.y - p.y) * u, p.z + (h.z - p.z) * u);
      cat.root.rotation.set(0, p.yaw + t * (t > 2.5 ? 4 : 0), -0.5 * Math.sin(u * Math.PI));
      cat.root.scale.setScalar(CARLE.growth.to * (1 - smooth((t - 3) / 0.7)));
      cat.update(dt, t, { anim: 'crawl' });
      cocoon.root.visible = t >= 3.3;
      const silk = Math.floor(t * 10);
      if (t > 2 && t < 4 && silk !== run.silk) {
        run.silk = silk;
        const a = t * 12;
        particles?.burst('sparkle', { x: h.x + Math.sin(a) * 0.3, y: h.y - 0.2 + Math.cos(a) * 0.15, z: h.z + Math.cos(a) * 0.3 }, { count: 2, radius: 0.12, height: 0.1, color: '#fff3d6' });
      }
    } else {
      cat.root.visible = false; cocoon.root.visible = t < 2.8;
      cocoon.crack(smooth((t - 0.3) / 1.5));
      cocoon.update(dt, t, { anim: 'wiggle' });
      butterflies.forEach((m, i) => {
        const born = i === 0 ? 1.1 : 5 + (i - 1) * 0.3, u = t - born;
        m.root.visible = u >= 0;
        if (u < 0) return;
        let x, y, z, anim = 'flap';
        if (i === 0 && t < 2.4) { const e = smooth(u / 1.3); x = h.x; y = h.y - 0.5 + e * 1.1; z = h.z; anim = u < 0.5 ? 'rest' : 'flap'; }
        else if (i === 0) {
          // Ease out of the shell, complete a loop, then come to rest on the watcher before leaving.
          const orbit = clamp((t - 2.4) / 1.9), a = orbit * Math.PI * 2;
          const land = smooth((t - 4.1) / 0.45), leave = smooth((t - 5.3) / 0.65);
          const r = 1.2 * (1 - land) + leave * 1.2, enter = smooth((t - 2.4) / 0.45);
          x = h.x + (f.x + Math.sin(a + leave * 3) * r - h.x) * enter;
          y = h.y + 0.6 + (f.y + 2.05 + Math.sin(a) * 0.2 * (1 - land) - h.y - 0.6) * enter;
          z = h.z + (f.z + Math.cos(a + leave * 3) * r - h.z) * enter;
          anim = t >= 4.45 && t < 5.3 ? 'rest' : 'flap';
        } else { const a = u * 3 + i * 2.1, r = smooth(u) * (1.3 + i * 0.35); x = h.x + Math.sin(a) * r; z = h.z + Math.cos(a) * r; y = h.y + 0.2 + smooth(u) * 0.8 + Math.sin(u * 4) * 0.2; }
        m.root.position.set(x, y, z); m.root.rotation.y = u * 3 + i * 2.1 + Math.PI / 2;
        m.root.scale.setScalar(Math.max(0.001, smooth(u / 0.4)));
        m.update(dt, t + i, { anim });
      });
      if (t >= 5.6 && !run.banner) { run.banner = true; cin.showBanner([{ text: 'Carle wants to come with you!', cls: 'fb-title' }]); sfx?.play('jingle', { vol: 0.7 }); }
    }
  }
  return { update, end, get active() { return !!run; }, get extras() { return butterflies; } };
}
