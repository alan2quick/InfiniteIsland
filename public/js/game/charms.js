// Charms (Step 58): the off-hand slot's spells as DATA, plus the small pure rules around them. Everything here is Node-tested in test/charm.test.js.
//
//   CHARMS[id] = { id, name, color, cooldown, reach, desc, icon, debug?, cast(run, key, facing, positions) -> event | null }
//       `reach` = how far soft auto-aim looks for a target (u); `icon` = a key of ui/icons.js (ICONS); `cast` runs on the HOST inside DungeonRun.castCharm: it does the
//       damage / stun through run.hitEnemy and returns the event every screen animates ({ charm, x, z, facing, radius, hits ... }).
//       Step 59 added Frost Nova; Steps 60-61 (Ember Seed, Gust Fan) add their own entries here; a `debug` charm (Spark) is never put in a real Armory. Charm hits carry `ranged: true`
//       (a hovering flyer cannot dodge a charm).
//   charmCooldown(member, time)   -> { ready, left, frac }   frac 0..1 = how recharged the held charm is (1 = ready, also 1 with no charm)
//   charmButtonShown(inArea, armoryCount, heldId)   the touch Charm button shows only inside a combat area AND (the Armory has a charm OR the player holds one)
//   actionsWithCharmRouting(actions, inCombat, homesteading)   outside combat areas Charm is a second Jump (so the button is never dead); Step 86c: for a player in Homesteading mode it is SHAPE instead
//                                                    (actions.shapePressed / shapeHeld; Jump stays on Space / pad Y). Combat areas always win: inCombat leaves Charm alone.
//   rackPedestals(area, charmIds) / areaPedestals(area)   the pedestal records of a run: the Armory rack in the first safe start + each section's own `pedestals`
//   partyPedestals(area, current, members)                 the section pedestals a party of that size gets (one per friend; playtest 0.60.0)
//
// A pedestal is `{ id, x, z, charm: id | null, rack, section }` in WORLD coordinates. Rack pedestals are an unlimited supply (taking a charm copies it; the one you
// held is simply put back in the Armory), so four friends can all carry Frost Nova. Pedestals found inside a section are a SWAP: you take its charm and yours stays on it.
import { CHARM } from '../config.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export const CHARMS = {
  // The test charm (behind ?testcharm / __game.dungeon.debug.giveCharm only): a small burst around the caster.
  spark: {
    id: 'spark', name: 'Spark', color: '#ffd45e', icon: 'charm-spark', debug: true,
    cooldown: CHARM.spark.cooldown, reach: CHARM.spark.radius, desc: 'A small burst of light around you. Test charm.',
    cast(run, key, facing, positions) {
      const p = positions[key], s = CHARM.spark, hits = [];
      for (const e of run.enemies) {
        if (e.hp <= 0 || dist(e, p) > s.radius + 0.4 || !run.g.sight(p, e)) continue;
        run.hitEnemy(key, e, s.damage, s.stun, p, 0.5, { move: 'charm', ranged: true }); hits.push(e.id);
      }
      return { charm: 'spark', facing, x: p.x, z: p.z, radius: s.radius, hits };
    },
  },
  // Step 59: FROST NOVA, the first real charm (learned in Glimmerfrost Caves; from then on every area's Armory rack offers it). A ring burst around the caster: every guardian inside is
  // hit for a little and FROZEN (cannot move or act; a boss or mini-boss only briefly, and chilled); a charged hit or a special on a frozen guardian SHATTERS it (bonus damage, cracks shells and
  // ice armor); cast next to the Frozen Ford and the water freezes into an ice bridge. Flyers cannot hover out of it (charms are ranged).
  'frost-nova': {
    id: 'frost-nova', name: 'Frost Nova', color: '#8fdcff', icon: 'charm-frost-nova',
    cooldown: CHARM.frostNova.cooldown, reach: CHARM.frostNova.radius,
    desc: 'A ring of frost around you freezes nearby guardians for a couple of seconds (bosses only briefly). Hit a frozen guardian with a charged attack or a special to SHATTER it for extra damage. Cast beside dark water to freeze it into an ice bridge.',
    cast(run, key, facing, positions) {
      const p = positions[key], s = CHARM.frostNova, hits = [], frozen = [];
      for (const e of run.enemies) {
        if (e.hp <= 0 || dist(e, p) > s.radius + 0.4 || !run.g.sight(p, e)) continue;
        run.hitEnemy(key, e, s.damage, 0, p, 0.3, { move: 'charm', ranged: true }); hits.push(e.id);
        if (e.hp > 0 && run.freezeEnemy(e, key)) frozen.push(e.id);
      }
      const ford = run.freezeWater(p);
      return { charm: 'frost-nova', facing, x: p.x, z: p.z, radius: s.radius, hits, frozen, ford };
    },
  },
  // Step 60: EMBER SEED (learned in Cinder Tubes): a thrown fireball that arcs ~6 u ahead (onto the nearest guardian in front of you, if there is one) and bursts there after a short flight: it hurts
  // and sets guardians BURNING, leaves a burning patch for a few seconds (gentle damage to anyone crossing it, friends too) and burns bramble walls away. Fire meets water (douse) and frost (steam): see
  // game/reactions.js. The burst is a pending impact on the host (`run.bursts`); the cast event only carries the flight for the screens to animate. Cooldown 8 s.
  'ember-seed': {
    id: 'ember-seed', name: 'Ember Seed', color: '#ff8a3d', icon: 'charm-ember-seed',
    cooldown: CHARM.emberSeed.cooldown, reach: CHARM.emberSeed.range,
    desc: 'Throw a glowing seed about six steps ahead. It bursts into flames, sets guardians burning and leaves a fire on the floor for a few seconds (careful: it burns friends a little, too). It burns bramble walls away. Fire and water put each other out; fire and frost make steam.',
    cast(run, key, facing, positions) {
      const p = positions[key], s = CHARM.emberSeed;
      let want = s.range;
      for (const e of run.enemies) {                                // land ON the nearest guardian in front of you when there is one in range
        if (e.hp <= 0 || !run.g.sight(p, e)) continue;
        const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
        if (d > 0.3 && d <= s.range + 0.5 && Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - facing), Math.cos(Math.atan2(dx, dz) - facing))) < 0.4) want = Math.min(want, d);
      }
      const end = run.lobAlong(p, facing, want);
      run.bursts.push({ id: ++run.nextFX, kind: 'ember', owner: key, x: end.x, z: end.z, at: run.time + s.flight, radius: s.radius });
      return { charm: 'ember-seed', facing, x: p.x, z: p.z, tx: end.x, tz: end.z, flight: s.flight, radius: s.radius };
    },
  },
};
export const charmInfo = (id) => (typeof id === 'string' && Object.hasOwn(CHARMS, id) ? CHARMS[id] : null);
export const knownCharms = (ids = []) => ids.filter((id) => !!charmInfo(id));

export function charmCooldown(m, time) {
  const info = charmInfo(m?.charm);
  if (!info) return { ready: true, left: 0, frac: 1 };
  const left = Math.max(0, (m.charmReady || 0) - time);
  return { ready: left <= 0, left, frac: Math.max(0, Math.min(1, 1 - left / info.cooldown)) };
}

export const charmButtonShown = (inArea, armoryCount, heldId) => !!inArea && (armoryCount > 0 || !!charmInfo(heldId));

/** Outside combat areas Charm acts as a second Jump (islands: the hop; storybook pages: the jump); in Homesteading mode (`homesteading`, Step 86c) it is the Shape button instead. Mutates and returns `actions`. */
export function actionsWithCharmRouting(actions, inCombat, homesteading = false) {
  actions.shapePressed = false;
  actions.shapeHeld = false;
  if (!inCombat && homesteading) {
    actions.shapePressed = !!actions.charmPressed;
    actions.shapeHeld = !!actions.charmHeld;
  } else if (!inCombat) {
    actions.jumpPressed = !!actions.jumpPressed || !!actions.charmPressed;
    actions.jumpHeld = !!actions.jumpHeld || !!actions.charmHeld;
  }
  return actions;
}

export const RACK_MAX = 8;
/** Where the Armory's charm pedestals stand: `area.rack` {x, z, dx} (local), else beside the first section's start. World coordinates. */
export function rackSpot(area, i) {
  const r = area.rack || { x: (area.sections[0]?.start.x ?? 0) + 3, z: (area.sections[0]?.start.z ?? 0) - 3.5, dx: 2.2 };
  return { x: area.origin.x + r.x + i * (r.dx ?? 2.2), z: area.origin.z + r.z };
}
/** The Armory rack in the first safe start: one pedestal per charm the island's Armory knows (+ debug extras). Unknown ids are skipped. */
export function rackPedestals(area, charmIds = []) {
  return [...new Set(knownCharms(charmIds))].slice(0, RACK_MAX).map((charm, i) => ({ id: `r${i}`, ...rackSpot(area, i), charm, rack: true, section: 0 }));
}
/** Pedestals an area's sections define themselves (`section.pedestals: [{ x, z, charm }]`, local coordinates): swap pedestals. `ord` = its place in the section's list: a run only shows
 *  the first <party size> of them (`partyPedestals`), so list them centre-out. */
export function areaPedestals(area) {
  return area.sections.flatMap((s, si) => (s.pedestals || []).map((p, n) => ({ id: `s${si}-${n}`, x: area.origin.x + p.x, z: area.origin.z + p.z, charm: charmInfo(p.charm) ? p.charm : null, rack: false, section: si, ord: n, orig: charmInfo(p.charm) ? p.charm : null })));
}
/** The run's pedestals for a party of `members`: the rack, plus each section's first `members` pedestals (one charm per friend, no spare pile). A pedestal beyond the party
 *  size stays only while it holds something other than its original charm (a charm somebody left there is never thrown away). Keeps existing records (their charms). */
export function partyPedestals(area, current, members) {
  const n = Math.max(1, members | 0), have = new Map(current.map((p) => [p.id, p]));
  const keep = current.filter((p) => p.rack || p.ord === undefined || p.ord < n || p.charm !== p.orig);
  for (const p of areaPedestals(area)) if (p.ord < n && !have.has(p.id)) keep.push(p);
  return keep;
}
/** Every pedestal interactable position an area needs registered up front (interactables are spatially hashed, so they are static): the rack slots + the section ones. */
export function pedestalSlots(area) {
  return [...Array.from({ length: RACK_MAX }, (_, i) => ({ id: `r${i}`, ...rackSpot(area, i), rack: true })), ...areaPedestals(area).map(({ id, x, z }) => ({ id, x, z, rack: false }))];
}

/** One swap at a pedestal. Rack: copy its charm (the held one returns to the Armory). Section pedestal: exchange. Returns { took, left } or null when nothing would change. */
export function swapAtPedestal(member, ped) {
  if (!member || !ped) return null;
  const held = member.charm || null, there = ped.charm || null;
  if (ped.rack) { if (!there || there === held) return null; member.charm = there; member.charmReady = 0; return { took: there, left: held }; }
  if (!held && !there) return null;
  member.charm = there; ped.charm = held; member.charmReady = 0;
  return { took: there, left: held };
}
