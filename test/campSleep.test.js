import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { installDom } from './fixtures/domStub.js';
import { createCampSleep, campSleepLayout } from '../public/js/world/campSleep.js';
import { DayNight, TIME_KEY } from '../public/js/world/dayNight.js';
import { getInteractables, clearInteractables } from '../public/js/world/interactables.js';
import { getColliders, clearColliders } from '../public/js/world/colliders.js';
import { createProps } from '../public/js/world/props.js';
import { campsiteLayout } from '../public/js/world/campsiteDressing.js';
installDom();
document.removeEventListener ||= () => {};
const layout = [{ x: 2, y: 1, z: 3, angle: 0, radius: 1.15 }];
function setup() {
  clearInteractables();
  const clock = new DayNight({ persist: true, params: new URLSearchParams('time=night') }); clock.set(22);
  const events = [], sync = { isHost: true, isReplica: false, register() {}, emit(...e) { events.push(e); } }; clock.attachSync(sync);
  const dialog = { isOpen: false, open(spec) { this.spec = spec; this.isOpen = true; }, close() { this.isOpen = false; } };
  const camp = createCampSleep({ scene: new THREE.Scene(), clock, sync, dialog, layout });
  camp.update(1); return { camp, clock, sync, events, dialog };
}
test('host sleep saves and broadcasts morning without aging elapsedHours; cancellation does nothing', () => {
  const { camp, clock, dialog, events } = setup();
  const elapsed = clock.elapsedHours; camp.open({ id: 1 });
  assert.match(dialog.spec.text, /shared world/); assert.match(dialog.spec.text, /Would you like to sleep/);
  dialog.spec.choices[1].onSelect(); assert.equal(clock.hour, 22);
  camp.open({ id: 1 }); dialog.spec.choices[0].onSelect();
  assert.equal(clock.hour, 8); assert.equal(clock.elapsedHours, elapsed);
  assert.equal(JSON.parse(localStorage.getItem(TIME_KEY)).hour, 8);
  assert.ok(events.some(([domain, kind, state]) => domain === 'daynight' && kind === 'time' && state.hour === 8));
  assert.equal(dialog.isOpen, false); camp.update(1); assert.ok(camp.summary().blend < .5);
  camp.dispose(); clock.dispose();
});
test('guests and admin-locked clocks cannot sleep, including changes after opening confirmation', () => {
  for (const change of [(s) => { s.sync.isHost = false; s.sync.isReplica = true; }, (s) => { s.clock.locked = true; }, (s) => { s.clock.set(12); }]) {
    const s = setup(); s.camp.open({ id: 1 }); const accept = s.dialog.spec.choices[0].onSelect;
    change(s); const before = s.clock.hour; accept(); assert.equal(s.clock.hour, before); assert.equal(s.dialog.spec.choices.length, 1);
    s.dialog.close(); s.camp.update(1);
    if (s.sync.isReplica || s.clock.locked) { s.camp.open({ id: 1 }); assert.equal(s.dialog.spec.choices.length, 1); }
    s.camp.dispose(); s.clock.dispose();
  }
});
test('bags gently appear at night, hide during special scenes, and dispose their registrations', () => {
  const { camp, clock } = setup(); assert.equal(getInteractables().length, 1);
  assert.ok(camp.summary().blend > 0 && camp.summary().blend < 1); assert.equal(camp.group.children[0].castShadow, false);
  const item = getInteractables()[0]; assert.equal(item.canInteract(), true);
  camp.update(.1, { hidden: true }); assert.equal(camp.group.visible, false); assert.equal(item.canInteract(), false);
  camp.update(.1); clock.set(12); camp.update(.1); assert.equal(item.canInteract(), false);
  camp.dispose(); camp.dispose(); assert.equal(getInteractables().length, 0); clock.dispose();
});
test('actual home placement avoids existing props and campsite without new colliders', () => {
  clearColliders(); clearInteractables(); const scene = new THREE.Scene(); createProps(scene);
  const colliders = getColliders().slice(), campsite = campsiteLayout();
  const sites = campSleepLayout({ campsite }); assert.deepEqual(sites, campSleepLayout({ campsite }));
  assert.ok(sites.length >= 2 && sites.length <= 3, `safe bag count ${sites.length}`);
  for (const p of sites) {
    for (const c of colliders) assert.ok(Math.hypot(p.x - c.x, p.z - c.z) >= p.radius + c.r + .3);
    for (const c of campsite) assert.ok(Math.hypot(p.x - c.x, p.z - c.z) >= p.radius + c.radius + .4);
  }
  assert.deepEqual(getColliders(), colliders); console.log('sleep sites', JSON.stringify(sites));
});
