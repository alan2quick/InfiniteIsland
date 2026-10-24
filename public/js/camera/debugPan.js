// Debug-camera exploration only. Translate camera + orbit target together across
// the ground plane; never change a player, orbit distance, save or game binding.
const ARROWS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'];
const RESPONSE = 12;
const typing = target => ['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName) || target?.isContentEditable;

// Exact exponential velocity integration makes held-key motion independent of
// frame rate, with a short ease-in/out and no faster diagonal movement.
export function stepDebugPan(velocity, input, right, dt, speed = 60) {
  const seconds = Number.isFinite(dt) ? Math.max(0, Math.min(0.1, dt)) : 0;
  let rx = right.x, rz = right.z, length = Math.hypot(rx, rz);
  if (!Number.isFinite(length) || length < 1e-8) { rx = 1; rz = 0; length = 1; }
  rx /= length; rz /= length;
  const magnitude = Math.max(1, Math.hypot(input.x, input.y));
  const x = input.x / magnitude, y = input.y / magnitude;
  const goalX = (rx * x + rz * y) * speed, goalZ = (rz * x - rx * y) * speed;
  const gain = -Math.expm1(-RESPONSE * seconds), vx = velocity.x || 0, vz = velocity.z || 0;
  return {
    x: goalX * seconds + (vx - goalX) * gain / RESPONSE,
    z: goalZ * seconds + (vz - goalZ) * gain / RESPONSE,
    velocity: { x: vx + (goalX - vx) * gain, z: vz + (goalZ - vz) * gain },
  };
}

export function createDebugPan({ camera, controls, keyboard, target = window, doc = document, blocked = () => false }) {
  const held = new Set(), shifts = new Set();
  let velocity = { x: 0, z: 0 };
  const releasePlayerArrows = () => { for (const code of ARROWS) keyboard?.release?.(code); };
  const clear = () => { held.clear(); shifts.clear(); velocity = { x: 0, z: 0 }; releasePlayerArrows(); };
  const down = event => {
    if (event.ctrlKey || event.metaKey || event.altKey) { clear(); return; }
    if (['ShiftLeft', 'ShiftRight'].includes(event.code)) { shifts.add(event.code); return; }
    if (!ARROWS.includes(event.code)) return;
    keyboard?.release?.(event.code);
    if (typing(event.target) || blocked()) { held.delete(event.code); return; }
    held.add(event.code);
    event.preventDefault(); event.stopImmediatePropagation();
  };
  const up = event => {
    held.delete(event.code); shifts.delete(event.code);
    if (ARROWS.includes(event.code)) keyboard?.release?.(event.code);
  };
  const visibility = () => { if (doc.hidden) clear(); };
  target.addEventListener('keydown', down, true);
  target.addEventListener('keyup', up, true);
  target.addEventListener('blur', clear);
  doc.addEventListener('visibilitychange', visibility);
  return {
    releasePlayerArrows,
    update(dt) {
      releasePlayerArrows();
      if (doc.hidden || typing(doc.activeElement) || blocked()) { clear(); return; }
      camera.updateMatrixWorld?.();
      const matrix = camera.matrixWorld.elements;
      const distance = Math.hypot(camera.position.x - controls.target.x, camera.position.y - controls.target.y, camera.position.z - controls.target.z);
      const speed = Math.max(12, Math.min(180, distance * 0.55)) * (shifts.size ? 2 : 1);
      const step = stepDebugPan(velocity, { x: +held.has('ArrowRight') - +held.has('ArrowLeft'), y: +held.has('ArrowUp') - +held.has('ArrowDown') }, { x: matrix[0], z: matrix[2] }, dt, speed);
      velocity = step.velocity;
      camera.position.x += step.x; camera.position.z += step.z;
      controls.target.x += step.x; controls.target.z += step.z;
    },
    dispose() {
      clear(); target.removeEventListener('keydown', down, true); target.removeEventListener('keyup', up, true);
      target.removeEventListener('blur', clear); doc.removeEventListener('visibilitychange', visibility);
    },
  };
}
