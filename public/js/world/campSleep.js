// A small nighttime camp: only the host may move the shared, saved runtime clock.
import * as THREE from 'three';
import { CAMPFIRE } from '../config.js';
import { SPAWN, getTerrainHeight, getGroundType, isWalkable } from './terrain.js';
import { getColliders } from './colliders.js';
import { addInteractable, removeInteractable, getInteractables } from './interactables.js';
import { part, combine, VERTEX_TOON } from '../render/geo.js';

const isNight = (clock) => Number.isFinite(clock?.hour) && (clock.hour >= 19 || clock.hour < 6);
function routeDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
}
export function campSleepLayout({ fire = CAMPFIRE, campsite = [], obstacles = getColliders(), interactables = getInteractables(), heightAt = getTerrainHeight, walkable = isWalkable, groundAt = getGroundType } = {}) {
  const result = [], radius = 1.15;
  for (const distance of [5.3, 6.5, 7.7]) for (let i = 0; i < 24 && result.length < 3; i++) {
    const angle = -Math.PI / 2 + i * Math.PI / 12;
    const x = fire.x + Math.sin(angle) * distance, z = fire.z + Math.cos(angle) * distance, y = heightAt(x, z);
    if (!Number.isFinite(y) || !walkable(x, z) || groundAt(x, z) !== 'grass') continue;
    if (routeDistance(x, z, SPAWN, fire) < radius + 1.1) continue;
    if (obstacles.some((p) => Math.hypot(x - p.x, z - p.z) < radius + p.r + .3)) continue;
    if (campsite.some((p) => Math.hypot(x - p.x, z - p.z) < radius + p.radius + .4)) continue;
    if (interactables.some((p) => Math.hypot(x - p.position.x, z - p.position.z) < radius + p.radius + .3)) continue;
    if (result.some((p) => Math.hypot(x - p.x, z - p.z) < radius * 2 + .35)) continue;
    let clear = true;
    for (let j = 0; j < 8; j++) {
      const px = x + Math.cos(j * Math.PI / 4) * radius, pz = z + Math.sin(j * Math.PI / 4) * radius;
      if (!walkable(px, pz) || groundAt(px, pz) !== 'grass' || Math.abs(heightAt(px, pz) - y) > .22) clear = false;
    }
    if (clear) result.push({ x, y: y + .025, z, angle: Math.atan2(fire.x - x, fire.z - z), radius });
  }
  return result;
}
function bagGeometry(color) {
  const cube = new THREE.BoxGeometry(1, 1, 1), parts = [];
  const add = (c, p, s) => parts.push(part(cube, c, { p, s }));
  add('#88765f', [0, .04, 0], [.94, .08, 2]);
  add(color, [0, .15, -.14], [.88, .22, 1.62]);
  add('#f0dfba', [0, .13, .7], [.67, .17, .38]);
  add('#e1c99d', [0, .265, .43], [.88, .025, .11]);
  add('#c8b68f', [.32, .267, -.24], [.025, .025, 1.2]);
  const geometry = combine(parts); cube.dispose(); return geometry;
}
export function createCampSleep({ scene, clock, sync, dialog, world, campsite, fire = CAMPFIRE, getBlocked = () => false, layout } = {}) {
  const group = new THREE.Group(); group.name = 'camp-sleeping-bags'; group.visible = false; scene.add(group);
  const positions = layout || campSleepLayout({ fire, campsite: campsite?.layout || [] });
  const material = VERTEX_TOON.clone(); material.transparent = true; material.opacity = 0; material.depthWrite = false;
  let blend = 0, hidden = false, disposed = false;
  const available = () => !disposed && !hidden && isNight(clock) && !getBlocked() && world?.root?.visible !== false && (!world?.regions?.isFull || world.regions.isFull(fire.island));
  const host = () => sync?.isHost === true && sync?.isReplica !== true;
  const reason = () => !host() ? 'Only the host can sleep until morning because this changes the time for everyone.' : clock.locked ? 'The administrator has paused the world clock. Sleeping is unavailable until the day cycle resumes.' : !isNight(clock) ? 'It is already daytime. Come back tonight for a rest.' : getBlocked() ? 'Finish your current activity before resting.' : null;
  function open(by) {
    if (!by || !available() || dialog.isOpen) return false;
    const unavailable = reason();
    dialog.open({ name: 'Rest by the fire', owner: by, menuId: 'camp-sleep',
      text: unavailable || 'Would you like to sleep? The shared world will wake at 8:00 in the morning. Everyone’s progress stays as it is.',
      choices: unavailable ? [{ label: 'Okay', onSelect: () => dialog.close() }] : [
        { label: 'Sleep until morning', onSelect: () => {
          // Authority and admin lock can change while the confirmation is open.
          const denied = reason();
          if (denied || !available()) {
            dialog.close();
            dialog.open({ name: 'Rest by the fire', owner: by, menuId: 'camp-sleep', text: denied || 'Resting is unavailable here right now.', choices: [{ label: 'Okay', onSelect: () => dialog.close() }] });
            return;
          }
          clock.set(8); // DayNight saves + broadcasts, without advancing elapsedHours or aging systems.
          dialog.close();
        } },
        { label: 'Stay up a little longer', onSelect: () => dialog.close() },
      ],
    });
    return true;
  }
  const items = positions.map((p, i) => {
    const mesh = new THREE.Mesh(bagGeometry(['#92b4ad', '#c3a1a9', '#d4bb86'][i % 3]), material);
    mesh.name = `camp-sleeping-bag-${i + 1}`; mesh.position.set(p.x, p.y, p.z); mesh.rotation.y = p.angle;
    mesh.castShadow = mesh.receiveShadow = false; group.add(mesh);
    return addInteractable({ type: 'sleeping-bag', object: mesh, position: mesh.position.clone(), radius: .65,
      prompt: 'Would you like to sleep?', canInteract: () => available() && blend > .5, onInteract: (_item, by) => open(by) });
  });
  return { group, layout: positions, open,
    update(dt, { hidden: nextHidden = false } = {}) {
      hidden = nextHidden;
      const target = available() ? 1 : 0;
      blend += (target - blend) * (1 - Math.exp(-Math.max(0, Number.isFinite(dt) ? dt : 0) / .65));
      material.opacity = blend;
      for (const mesh of group.children) mesh.scale.set(.94 + .06 * blend, .1 + .9 * blend, .94 + .06 * blend);
      group.visible = !disposed && !hidden && world?.root?.visible !== false && (!world?.regions?.isFull || world.regions.isFull(fire.island)) && blend > .005;
    },
    summary() { return { bags: items.length, visible: group.visible, blend, host: host(), locked: !!clock.locked, nighttime: isNight(clock) }; },
    dispose() { if (disposed) return; disposed = true; for (const item of items) { removeInteractable(item); item.object.geometry.dispose(); } material.dispose(); group.removeFromParent(); },
  };
}
