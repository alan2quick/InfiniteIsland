// Real PlayerManager + party runtime + the REAL cinematic stage for the Step 80e checks (the trophy cut, the kiosk, the attract mode, the joiner queue); no renderer or browser. Like partyRuntime80d.js plus:
//   makeRuntime({ params, busy }) -> { ...,  cin (createCinematic), calls { music, sfx, duck [{ level }], unduck }, musicLevel() (what the music bus would be: 1, or the duck), bursts, toasts }
import * as THREE from 'three';
import { installDom, el } from './domStub.js';
import { MAX_PLAYERS } from '../../public/js/config.js';
import { SlotTable } from '../../public/js/players/slotTable.js';
import { PlayerManager } from '../../public/js/players/playerManager.js';
import { InputManager } from '../../public/js/input/inputManager.js';
import { createPlayersDomain } from '../../public/js/net/playersDomain.js';
import { WorldSync } from '../../public/js/net/worldSync.js';
import { FollowCamera } from '../../public/js/camera/followCamera.js';
import { createCinematic } from '../../public/js/game/cinematic.js';
import { createParty } from '../../public/js/game/party.js';
installDom();
document.createElementNS = () => el();
document.createTextNode ||= () => el();       // (the cinematic banner builds letters and text nodes)

export function makeRuntime({ params = new URLSearchParams(), busy = () => null } = {}) {
  const scene = new THREE.Scene(), sync = new WorldSync({ role: 'host' }), table = new SlotTable(MAX_PLAYERS);
  const toasts = [], bursts = [], particles = { burst: (...a) => bursts.push(a) };
  const hud = { toast: (t, o) => toasts.push(t), setRoster() {} };
  let pm = null;
  createPlayersDomain({ sync, table, onChange: () => pm && pm.slotsChanged(), hooks: { onFull: () => pm.onFull?.() } });
  pm = new PlayerManager({ scene, local: new InputManager(), hud, hudRoot: el(), particles, sync, table });
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 600), followCam = new FollowCamera(camera, {});
  const world = { root: { visible: true }, snap() {} }, water = { group: { visible: true } };
  let level = 1;
  const calls = { music: [], sfx: [], tempo: [], duck: [], unduck: 0 };
  const music = {
    party: (id) => calls.music.push(id), setTempo: (k) => calls.tempo.push(k),
    duck: (a, s) => { level = a; calls.duck.push({ level: a, s }); }, unduck: () => { level = 1; calls.unduck++; }, get duckLevel() { return level; },
  };
  const sfx = { play: (n) => calls.sfx.push(n) };
  const dialog = { isOpen: false, owner: null, close() {}, open() {}, refresh() {} };
  const items = { heldBy: () => null }, avatars = { get: () => null, list: [], hideHeld: false, setCinematic() {} };
  const hudRoot = el();
  const cin = createCinematic({ camera, followCam, players: pm, avatars, hud, hudRoot, music, dialog, pairPanel: null });
  const party = createParty({ scene, camera, followCam, players: pm, avatars, table, sync, hud, hudRoot, dialog, particles, sfx, music, items, world, water, cinematic: cin, busy, params });
  const frame = (dt = 1 / 30) => {                      // main.js's tick, the party's part of it (a cinematic scene skips the drive, like main.js's `scripted`)
    party.preInput(dt); pm.pollInput(dt);
    if (!cin.active) for (const p of pm.list) if (party.contains(p) && !p.away && !p.frozen) party.drive(p, p.actions, dt);
    pm.update(dt); party.update(dt, 0); party.afterItems(); party.afterAvatars();
    if (party.pageMode) party.updateCamera(dt);
    cin.update(dt);
  };
  const run = (secs, until = null, dt = 1 / 30) => { for (let t = 0; t < secs - 1e-9; t += dt) { frame(dt); if (until && until()) return true; } return !until; };
  return { scene, sync, table, pm, hud, toasts, bursts, particles, party, camera, followCam, calls, avatars, cin, music, frame, run, musicLevel: () => level };
}
