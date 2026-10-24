// Six friends at the REAL home fire, rendered by the existing game scene. No overlay, extra canvas or gameplay registrations.
import * as THREE from 'three';
import { createCharacter } from './character.js';
import { attachVariant, CHARACTER_VARIANTS, normaliseVariant } from './characterVariants.js';
import { attachHeldProp } from './heldProps.js';
import { campfireCastSeats, createCampGreetings, campfireWalkPoint, reserveCampLabel } from './campfireCastLogic.js';

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);
const smooth = (t) => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };
export function createCampfireCast({ scene, camera, canvas, player, keyboard, fire, welcomeFire = null, seats, selected = 'original', initialSelection = false, onChoose = () => {}, onSettled = () => {}, getBlocked = () => false, hasActivity = () => false, random = Math.random } = {}) {
  const group = new THREE.Group(); group.name = 'campfire-friends'; scene.add(group);
  const layout = campfireCastSeats(fire, seats), greetings = createCampGreetings(random), pointer = new THREE.Vector2(), ray = new THREE.Raycaster(), projected = new THREE.Vector3();
  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
  const ui = document.createElement('div'); ui.className = 'camp-friends'; ui.setAttribute('aria-label', 'Friends by the campfire');
  const hint = document.createElement('p'); hint.className = 'camp-friends-hint'; hint.textContent = 'Choose a friend by the fire · Click or tap · Keys 1–6 · Move to keep Sprout'; ui.append(hint);
  const bubble = document.createElement('span'); bubble.className = 'camp-friends-greeting'; bubble.setAttribute('aria-live', 'off'); bubble.hidden = true; ui.append(bubble); document.body.append(ui);
  let current = normaliseVariant(selected), selecting = !!initialSelection, departure = null, disposed = false, elapsed = 0;
  let hiddenPlayer = null, welcome = !!initialSelection, returningBody = null;
  const point = new THREE.Vector3(), ahead = new THREE.Vector3(), localPoint = new THREE.Vector3(), projectedBase = new THREE.Vector3();
  const propDefaults = { original: 'none', rowan: 'lantern', pip: 'flower', marlow: 'pinwheel', clover: 'umbrella', sunny: 'torch' };
  let priorBoost = initialSelection && Number.isFinite(welcomeFire?.boost) ? welcomeFire.boost : null;
  const welcomeBoost = priorBoost === null ? null : Math.max(1, priorBoost);
  if (welcomeBoost !== null) welcomeFire.setBoost(welcomeBoost);
  function restoreBoost() {
    if (priorBoost === null) return;
    if (welcomeFire.boost === welcomeBoost) welcomeFire.setBoost(priorBoost);
    priorBoost = null;
  }
  function restoreReturningBody() {
    if (!returningBody) return;
    const { parent, wrapper, rotations } = returningBody;
    if (parent) parent.add(player.root); else player.root.removeFromParent();
    wrapper.removeFromParent();
    for (const [object, rotation] of rotations) object.rotation.copy(rotation);
    if (Number.isFinite(player.facing)) player.root.rotation.y = player.facing;
    returningBody = null;
  }
  function walkPose(parts, time, sit = 0) {
    if (!parts) return;
    parts.rig.rotation.x = 0.06 * sit;
    parts.legL.rotation.x = -1.42 * sit + Math.sin(time * 10) * 0.32 * (1 - sit);
    parts.legR.rotation.x = -1.42 * sit - Math.sin(time * 10) * 0.32 * (1 - sit);
    parts.armL.rotation.x = -0.85 * sit - Math.sin(time * 10) * 0.18 * (1 - sit);
    // Actual held gear continues to own its right-arm pose.
  }
  const hidePlayer = () => { if (hiddenPlayer === null) hiddenPlayer = player.root.visible; player.root.visible = false; keyboard?.releaseAll?.(); };
  const revealPlayer = () => { if (hiddenPlayer !== null) player.root.visible = hiddenPlayer; hiddenPlayer = null; keyboard?.releaseAll?.(); };
  const actors = CHARACTER_VARIANTS.map((variant, index) => {
    const character = createCharacter(), cleanup = attachVariant(character, variant.id), seat = layout[index];
    character.root.position.set(seat.x, seat.y, seat.z); character.root.rotation.y = seat.facing;
    character.parts.legL.rotation.x = character.parts.legR.rotation.x = -1.42;
    character.parts.armL.rotation.x = character.parts.armR.rotation.x = -0.85;
    character.parts.rig.rotation.x = 0.06;
    character.root.userData.campVariant = variant.id;
    // Decorative friends do not cast six additional expensive shadow passes.
    character.root.traverse((node) => { if (node.isMesh) node.castShadow = false; });
    group.add(character.root);
    const button = document.createElement('button'); button.className = 'camp-friend-label'; button.type = 'button'; button.textContent = variant.name;
    button.hidden = true;
    button.setAttribute('aria-label', `Choose ${variant.name}. ${variant.description}. Same abilities as every character.`);
    button.addEventListener('pointerdown', (e) => e.stopPropagation());
    button.addEventListener('keydown', (e) => e.stopPropagation());
    button.addEventListener('click', () => choose(variant.id)); ui.append(button);
    const prop = attachHeldProp(character, propDefaults[variant.id]);
    return { ...variant, character, cleanup, seat, button, prop };
  });
  if (selecting) hidePlayer();
  function finish(id) {
    restoreReturningBody();
    current = normaliseVariant(id); departure = null; selecting = false; welcome = false; restoreBoost();
    for (const actor of actors) {
      actor.character.root.position.set(actor.seat.x, actor.seat.y, actor.seat.z);
      actor.character.root.rotation.y = actor.seat.facing;
      actor.character.parts.rig.rotation.x = 0.06;
      actor.character.parts.legL.rotation.x = actor.character.parts.legR.rotation.x = -1.42;
      actor.character.parts.armL.rotation.x = actor.character.parts.armR.rotation.x = -0.85;
      if (actor.prop.id !== propDefaults[actor.id]) { actor.prop(); actor.prop = attachHeldProp(actor.character, propDefaults[actor.id]); }
    }
    revealPlayer(); onChoose(current); onSettled();
  }
  function prepareLeaving(actor) {
    // The arriving look keeps the player's selected cosmetic prop; actual gameplay gear stays attached to the real body.
    const propId = player.holding ? 'none' : (player.heldProp || 'none');
    if (actor.prop.id !== propId) { actor.prop(); actor.prop = attachHeldProp(actor.character, propId); }
  }
  function choose(id, immediate = false) {
    if (disposed || departure || getBlocked()) return false;
    const actor = actors.find((entry) => entry.id === id); if (!actor || (!welcome && actor.id === current)) return false;
    // Scene labels and debug callers share this guard: choosing never transports a distant player.
    if (Math.hypot(player.position.x - fire.x, player.position.z - fire.z) >= 7) return false;
    selecting = true; bubble.hidden = true; keyboard?.releaseAll?.();
    if (immediate || media.matches) { finish(id); return true; }
    const destination = player.position.clone ? player.position.clone() : new THREE.Vector3(player.position.x, player.position.y, player.position.z);
    if (welcome) {
      hidePlayer(); prepareLeaving(actor);
      departure = { actor, phase: 'leaving', time: 0, duration: 2.6, destination };
    } else {
      const parent = player.root.parent, wrapper = new THREE.Group(); wrapper.name = 'campfire-returning-player';
      (parent || scene).add(wrapper); wrapper.add(player.root);
      const parts = player.parts || player.character?.parts;
      const rotations = [player.root, parts?.rig, parts?.legL, parts?.legR, parts?.armL, parts?.armR].filter(Boolean).map((object) => [object, object.rotation.clone()]);
      returningBody = { parent, wrapper, rotations };
      const old = actors.find((entry) => entry.id === current);
      departure = { actor, old, phase: 'returning', time: 0, duration: 1.25, destination, from: destination.clone() };
    }
    return true;
  }
  function onKey(e) {
    if (!selecting || departure || e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName)) return;
    if (/^Digit[1-6]$/.test(e.code)) {
      e.preventDefault(); e.stopImmediatePropagation(); choose(CHARACTER_VARIANTS[Number(e.code.slice(-1)) - 1].id);
    } else if (e.code === 'Escape' || MOVE_KEYS.has(e.code)) {
      // Movement is the zero-friction default: do not swallow the key that starts the player's walk.
      finish('original');
    }
  }
  function onPointer(e) {
    if (disposed || departure || getBlocked() || e.button !== 0 || !group.visible) return;
    const box = canvas.getBoundingClientRect(); if (!(box.width > 0 && box.height > 0)) return;
    pointer.set((e.clientX - box.left) / box.width * 2 - 1, -(e.clientY - box.top) / box.height * 2 + 1);
    camera.updateMatrixWorld(); group.updateWorldMatrix(true, true); ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObjects(actors.filter((a) => a.character.root.visible).map((a) => a.character.root), true)[0];
    if (!hit) return;
    let object = hit.object; while (object && !object.userData.campVariant) object = object.parent;
    if (object && choose(object.userData.campVariant)) { e.preventDefault(); e.stopImmediatePropagation(); keyboard?.releaseAll?.(); }
  }
  window.addEventListener('keydown', onKey, true); canvas.addEventListener('pointerdown', onPointer, true);
  function place(element, actor, lift = 1.65, occupied = null) {
    projected.set(actor.character.root.position.x, actor.character.root.position.y + lift, actor.character.root.position.z).project(camera);
    const rect = canvas.getBoundingClientRect(), shown = projected.z > -1 && projected.z < 1 && Math.abs(projected.x) < 0.98 && Math.abs(projected.y) < 0.98;
    element.hidden = !shown;
    if (shown) {
      const x = rect.left + (projected.x + 1) * rect.width / 2, y = rect.top + (1 - projected.y) * rect.height / 2;
      if (occupied) {
        projectedBase.copy(actor.character.root.position).project(camera);
        const actorPixels = Math.abs(projectedBase.y - projected.y) * rect.height / 2;
        element.hidden = !reserveCampLabel({ x, y, width: actor.name.length * 7 + 20, height: 32, actorPixels }, occupied);
      }
      element.style.left = `${x}px`; element.style.top = `${y}px`;
    }
  }
  return {
    get isSelecting() { return selecting; },
    get current() { return current; },
    choose,
    summary() { return { selecting, current, phase: departure?.phase || null, seated: actors.filter((actor) => selecting || actor.id !== current).map((actor) => actor.id), visible: group.visible, greeting: bubble.hidden ? null : bubble.textContent }; },
    setSelected(id) { current = normaliseVariant(id); },
    update(dt = 0) {
      if (disposed) return;
      const step = Number.isFinite(dt) ? Math.max(0, Math.min(dt, 0.1)) : 0; elapsed += step;
      const blocked = getBlocked(), distance = Math.hypot(player.position.x - fire.x, player.position.z - fire.z);
      if (selecting && (blocked || (!departure && hasActivity()))) { finish(current); }
      group.visible = !blocked && (selecting || distance < 40);
      hint.hidden = !welcome || !selecting || !!departure || blocked;
      if (departure) {
        const transition = departure; transition.time += step;
        if (transition.phase === 'returning') {
          const t = Math.min(1, transition.time / transition.duration), travel = smooth(t), sit = smooth((t - 0.8) / 0.2);
          campfireWalkPoint(transition.from, transition.old.seat, fire, travel, point);
          campfireWalkPoint(transition.from, transition.old.seat, fire, Math.min(1, travel + 0.01), ahead);
          returningBody.wrapper.parent.updateWorldMatrix(true, false);
          localPoint.copy(point); returningBody.wrapper.parent.worldToLocal(localPoint);
          returningBody.wrapper.position.copy(localPoint).sub(player.root.position);
          player.root.rotation.y = t >= 0.95 ? transition.old.seat.facing : Math.atan2(ahead.x - point.x, ahead.z - point.z);
          walkPose(player.parts || player.character?.parts, transition.time, sit);
          if (t >= 1) {
            restoreReturningBody(); hidePlayer(); prepareLeaving(transition.actor);
            transition.phase = 'leaving'; transition.time = 0; transition.duration = 1.6;
          }
        } else {
          const { actor } = transition, t = transition.time, stand = smooth(t / 0.35), travel = smooth((t - 0.3) / (transition.duration - 0.3));
          const from = { x: actor.seat.x, y: actor.seat.y + stand * 0.3, z: actor.seat.z };
          campfireWalkPoint(from, transition.destination, fire, travel, point);
          campfireWalkPoint(from, transition.destination, fire, Math.min(1, travel + 0.01), ahead);
          actor.character.root.position.copy(point);
          const heading = Math.atan2(ahead.x - point.x, ahead.z - point.z);
          actor.character.root.rotation.y = travel > 0.9 && Number.isFinite(player.facing) ? player.facing : heading;
          walkPose(actor.character.parts, t, 1 - stand);
          if (t >= transition.duration) finish(actor.id);
        }
      }
      camera.updateMatrixWorld();
      const occupiedLabels = [];
      for (const actor of actors) {
        actor.character.root.visible = group.visible && (welcome || actor.id !== current || departure?.phase === 'leaving');
        if (!departure || departure.actor !== actor) actor.character.parts.torso.position.y = media.matches ? 0 : Math.sin(elapsed * 1.4 + actors.indexOf(actor)) * 0.012;
        actor.prop.update(elapsed);
        const labels = group.visible && !departure && (selecting || distance < 7) && actor.character.root.visible;
        actor.button.hidden = !labels; actor.button.tabIndex = labels ? 0 : -1;
        if (labels) place(actor.button, actor, 1.65, occupiedLabels);
        actor.button.tabIndex = actor.button.hidden ? -1 : 0;
      }
      const available = actors.filter((a) => a.id !== current || selecting).map((a) => a.id);
      const greeting = greetings.update(step, available, group.visible && distance < 16 && !departure);
      bubble.hidden = !greeting;
      if (greeting) { bubble.textContent = greeting.text; place(bubble, actors.find((a) => a.id === greeting.id), 2.2); }
    },
    dispose() {
      if (disposed) return; disposed = true;
      window.removeEventListener('keydown', onKey, true); canvas.removeEventListener('pointerdown', onPointer, true);
      restoreReturningBody(); revealPlayer(); restoreBoost(); ui.remove(); group.removeFromParent();
      for (const actor of actors) { actor.prop(); actor.cleanup(); actor.character.dispose(); }
    },
  };
}
