# Step 68: Skipper Marlo's boat

Moved verbatim from PLAN.md on 2026-10-22: the spec first, then the progress lines. The index of every step is [PLAN.md](../PLAN.md).

## Spec

### Step 68 — Skipper Marlo's boat: hop courses and the voyage out of Emberleaf (DRAFT, not started)

Emberleaf's camp and garden are already about gathering and giving. This quest is about **moving**: short, easy hop courses that use the
Jump button, and three small hands-on repair activities. At the end a boat leaves Emberleaf for the next zone, which a later step plans.
Nothing here asks the party to collect a pile of resources.

**Story.** After the party's **first feast at the Emberleaf garden hearth**, a foghorn sounds from a hidden cove on Emberleaf's far shore. An old
sea otter, **Skipper Marlo**, washed in overnight with a storm-wrecked outrigger sailboat. The storm scattered its parts around the island: the
sail is caught high in the canopy, the rudder is stuck on a basalt column in a cooling lava pool, and the compass is on a sea-stack headland.
The party fetches each part over a hop course, helps Marlo patch the hull, plugs leaks during a test float, and reads the stars at night to
chart a course. Marlo sails the boat out in a cutscene and moors it at his dock with a "Set sail" prompt that waits for the next zone.

**Skipper Marlo (the new character).**
- **Look:** a chubby chocolate-brown sea otter with a cream face and muzzle, white whiskers, small round ears, big glossy dark eyes, a tiny pink
  nose and a flat paddle tail. He wears a knitted navy captain's cap with a yellow anchor, a faded red neckerchief and a brass spyglass on a
  rope belt. Same build style as Mossback: Baker meshes + the shared character toon program, baked hulls, **at most 8 draw calls** including shadows.
- **Personality:** unhurried and warm. He hums sea shanties, calls the players "crew", mixes up landlubber words ("the pointy end"),
  never rushes anyone ("The sea's been waiting a thousand years, it can wait for lunch"), and loves clams.
- **Idles:** floats on his back in the shallows cracking a clam on his tummy with a stone (signature), peers through the spyglass toward the
  horizon, dozes with the cap over his eyes, waves the crew over. Sleepy at night except during the star chart (he stays up for the stars).
- **Seagull sidekick, Biscuit:** a small gull that flies each fetched part from a course's goal back to the wreck (cosmetic, per screen,
  driven by the host's event). Biscuit is 1 draw call (1 merged mesh, no shadow) and is only built while Emberleaf is full detail.
- Marlo is a sibling of `world/mossback.js` (not part of `npcs.js`): `world/marlo.js`, model `npc/marlo.js`, lines in `game/marloScript.js`.
  Interactable `npc` "Talk" (a plain interact even while holding a tool), dialog `menuId` `npc-marlo`, intro heard per screen in
  `infiniteIsland.marloIntro`. Present once the quest is unlocked (synced, see below).

**Unlock: the first Emberleaf feast.** Today nothing records which fire a feast happened at (`quests.feasts` is one shared count), so:
- `feast.addReveal(fireId, api)` keeps a **list** of reveal apis per fire (today a `Map` holds one, the garland stand). The garland stand's
  behaviour, order and banner lines stay identical.
- The boat module registers a reveal for `'ember'`. Its `onFeastEnd({ n, fireId })` (host only, idempotent per feast number, skipped for
  `free` feasts like every reveal) sets `boat.unlocked = true`, saves and emits. Its banner line: "A foghorn echoes from the far shore...".
- **Old saves** that already feasted at Emberleaf cannot be detected exactly. Treat a save with any unlocked garland
  (`emberleaf.v1.garlands`) as unlocked. Every other save unlocks on the next Emberleaf feast. Say this in the README.
- Before the unlock the cove is empty beach (no wreck, no Marlo, no courses' goal parts). The unlock pops in the wreck and Marlo live on screens
  that can see the cove and is silent on load / late join (the `popIn.js` rules).
- Debug: `__game.boat.unlock()`, `?bridges=open` does NOT unlock it (use the debug hook or `?testboat`).

**The cove.** A small sandy cove on Emberleaf's far shore with tide-pool rocks, a beached outrigger (hull, outrigger float, broken mast stub),
Marlo's lean-to of driftwood and sailcloth, a short plank dock (built in 68d) and a tar seep in the back rocks (68c).
- Find a spot by probing, like the cave mouth and the lava-tube mouth: a CLEARING of Emberleaf's seeded placement, away from the bridge
  landing, the garden zone, the waterfall corridor, the Cinder Tubes mouth keep-clear and the trail. Pure keep-clear in
  `world/islands/emberCove.js` (also the course layouts, below), added to `emberForbidden` LAST so no rng stream changes. Pin Emberleaf's
  placement hashes in a test; the goal is no change. If no clearing fits, one reshuffle is allowed (Emberleaf is not saved) but the seed plan's
  ids must stay stable (`emberSeeds.js`).
- A spur of the garden trail (`PATHS` 'ember-cove', surface `sand` or `earth`) leads there, with a signpost "Skipper's Cove".

#### The hop-course system (68a, the foundation)

In the 3D game Jump is only visual today: `player.hop()` lifts the rig (`_hopY`) while movement, collision and terrain treat the player as on
the ground. Hop courses need real heights, but **only inside course zones**, so the rest of the game is byte-identical.

- **The hop it is built on** (do not change it): `HOP_SPEED` 5.6, `GRAVITY` 24, so apex = 0.65 u and airtime = 0.47 s; at run speed (7 u/s)
  a hop carries about 3.3 u. Course design limits (config `HOP_COURSE.limits`, checked by the validator): **rise at most 0.5 u per hop, gaps at
  most 2.4 u edge to edge, pads at least 0.9 u radius** (or 1.4 u wide), drops any height. These keep every course easy; a mistake is cheap.
- **Pure rules `game/hopLogic.js`** (Node-tested in `test/hop.test.js`): course data -> `courseAt(x, z)`, `padsAt(course, x, z, t)`,
  `surfaceY(course, x, z, t, fromY)` (the highest pad top under the feet that is at or below `fromY + STEP` (0.3 u), else the terrain),
  `blocks(course, x, z, footY, t)` (a pad side taller than STEP above the feet is a wall), `gapAt` (water / lava cells you may cross only in the
  air), `stepHop(body, input, course, t, dt)` = the same hop / fall numbers as `player.js`, and `validateCourse(course)` = a bot that runs the real
  step from the start to the goal along every required pad link, at the worst moment of every moving pad, with margins.
- **Pads:** `{ id, kind, x, z, r | w,d,rot, top, motion? }`. Kinds: `rock`, `stump`, `bamboo` (platform), `crust` (lava plate), `wet`
  (slippery: damping x0.35, like the storybook's ice), `deck`. Motions are pure functions of the **shared host clock** (`sync.hostNow()`, the
  clock the feast start uses; never saved or hashed), so every screen sees a pad in the same place: `sway {axis, amp, period, phase}`,
  `sink {period, phase, down, warn}` (a crust plate trembles for `warn` s, sinks under the lava, rises again; never all plates of a row at once),
  `bob {amp, period}` (the boat deck, 68c).
- **Player integration** (`player.js`, only while `hop.courseAt(position)` is set): the body keeps a standing height `this._standY` from
  `surfaceY`; walking off a pad falls with gravity; landing on a pad top within its radius stands on it; a moving pad carries the player
  standing on it (like `ridePlatforms`). The terrain walkability check lets an AIRBORNE player cross a gap cell; landing in water or lava =
  **a splash, a quick fade and a pop back at the last checkpoint pad**. No damage, no hearts, no lost items. Jump and Cancel both hop as today.
  Poses already send `y`, so remote avatars show the height with no packet change.
- **Assists for easy play:** a soft landing magnet (0.35 u toward the pad centre when the feet come down within the rim), a ground shadow under
  an airborne player (reuse the blob), and a dotted glint on the next pad of the main route. Configurable in `HOP_COURSE`.
- **Multiplayer:** movement stays per screen (as now). Players never block each other on pads. Nothing in the course is host state except the
  part pickup (below), so there is nothing new to hash per frame.
- **68a content:** the cove, Marlo, Biscuit, the unlock, the `boat` domain, and a **tutorial course**: tide-pool stepping stones from the beach
  out to the wreck's stern, where a loose **plank bundle** waits (the first "part").

#### The parts (68b)

Each part sits at a course goal. Taking it is a host request `take {part}` (lenient reach, unlocked, not yet taken); the event plays Biscuit
carrying it to the wreck on every screen. Each course has one idea and is 30-60 seconds for a first try:

| Part | Course | The one idea |
|---|---|---|
| Planks (68a) | Tide-pool stones out to the wreck | Learn to hop: still rocks, small gaps, one wide-ish gap with a shortcut stone |
| Sail | A spiral of bracket mushrooms and bamboo scaffold round a giant canopy tree | **Sway:** some platforms swing slowly; hop when they come close. At the top, the sail is a **glide** down (fall speed capped while holding Jump, like a parachute) |
| Rudder | A cooling lava pool on the volcano's lower flank, the rudder on a basalt column in the middle | **Sink:** crust plates tremble, sink and rise on the clock; there is always a still rock to rest on |
| Compass | Wet sea-stack steps up the cove's headland, spray from waves | **Slip:** wet tops are slippery; land and stop carefully. A shell bell at the top marks the checkpoint |

Each course has checkpoints at the start, the middle and before the goal, and a short "Back down" slide or ramp from the top so nobody has to
reverse the course. Taken parts stay taken (saved). A part's course stays open afterwards for fun.

#### The repair (68c)

Talk to Marlo once all four parts are back: "Let's patch her up, crew!" Three activities, any order, each finished once for the whole party:

1. **Plank nailing to a beat.** Marlo taps a beat on an upturned bucket (the beat is on the shared clock; the procedural music is ducked).
   The hull has 4 plank marks; a player standing at a mark presses Interact on the beat. A shrinking ring shows the timing, window
   `HOP_COURSE.beat.window` (+-0.14 s). **4 good hits in a row** nails that plank (a miss just resets the streak). Each screen judges its own
   players and sends `nail {plank}`; the host counts planks (8 in total; 2 per mark). Solo: one player can do all 8, four players share them.
2. **The tar run.** A tar seep in the cove's back rocks gives a **hot tar pot** (Interact). The pot rides on the offhand socket (like a
   charm gem) so a held tool stays in the hand. It cools over `tar.coolS` (tune to the walking route x 1.6 so it is comfortable; a hop shortcut
   over a little tide channel makes it relaxed). Interact at the hull's open seam before it cools seals one seam (3 seams). A cooled pot hardens:
   "Back to the seep!" Host state `tar {slotKey: {at}}` (requests `tar`, `seal {seam}`), so other screens show the pot.
3. **Leak test float.** Marlo pushes the hull into the shallows; a gangplank leads aboard. The deck is a `bob` pad set (a gentle rock; the
   physics floor stays level, only the model tilts). For 45 s leaks spring up at seeded spots on the deck (the host's schedule, more leaks
   with more players, `partyScale`-like table in config). Interact on a leak plugs it (`plug {leak}`, lenient reach). Open leaks raise the
   bilge; the test passes if the bilge stays under the line at the end. If it overflows, Marlo laughs, bails out and the test can restart at
   once. Nothing is lost.

#### The star chart and the voyage (68d)

- **Three lookouts** at the tops of the sail tree, the compass headland and a new short course on the cove's rocks (the "crow's nest", a
  driftwood pole with rope rungs as hop pads). At night (`SEEDS.times`-style hour window in config, honouring `?daylock` like the seed finds)
  a lookout's spyglass opens a **sighting view** on that screen: the camera looks up at the real sky; the stick turns a sighting ring; aligning
  it with that lookout's constellation (seeded from the 400 sky stars, brightened and joined with lines when found) for 1 s is a find.
  Host request `sight {post}` checks the hour and the reach. Three sights = the chart.
- **The voyage.** Marlo: "Ready to see what's past the horizon?" A host-timed cutscene on `cinematic.js` (the `bridgeScene` start rule: wait
  for any other cinematic; skip on one screen skips everywhere): the crew pushes off, the sail fills, the boat sails out of the cove to the
  horizon and turns back to moor at Marlo's new plank dock. Afterwards `boat.launched` is saved; the dock has a "Set sail" interactable whose
  dialog says the next tide is not ready yet (the hook the next zone's step replaces), plus a ship-in-a-bottle trophy on Marlo's lean-to.

- **Patched hull look (added 2026-10-14 after the 68c review):** the hull still shows the wreck's open ribs after all 8 planks and 3 seams are done. The hull model must follow the repair state: each nailed plank visibly closes its part of the side, sealed seams show a dark tar line, and the finished, floated boat reads as a whole, seaworthy outrigger (a mast stump becomes a mast with the sail furled once `floated`). Live changes animate on every screen; load / late join just shows the current state.

#### Sync, save, tests, budget

- **`boat` sync domain** (host-authoritative, `world/boat.js`): state `{ unlocked, parts: {planks, sail, rudder, compass}, planks: 0..8,
  seams: [..3], float: {running, t0, leaks, bilge} | null, floated, sights: [..3], launched }` plus session-only `tar`. Snapshot = state,
  `hashView` = state without `float.bilge` timing noise. Requests `take nail tar seal float plug sight voyage` and host-only debug ones;
  events per request. Pure rules in `game/boatLogic.js` (`validate*`, `apply*`, leak schedule, bilge, save normalising; Node-tested in
  `test/boat.test.js`).
- **Save:** the `boat` key of `infinite-island.emberleaf.v1` through `game/emberSave.js` (host only, replicas never write; `?newgame` wipes it).
- **Debug:** `__game.boat.{summary(), unlock(), take(part), finishRepair(), sightAll(), voyage(), reset(), goto('cove' | 'sail' | 'rudder' |
  'compass' | 'nest')}`; `?testboat` = unlocked with all parts at their goals. `syncStress` gains a `boat` action.
- **Tests:** `validateCourse` passes for every course (and fails for a course with a 3 u gap or a 0.8 u rise); hop-step parity with
  `player.js` numbers; moving pads at the shared time; unlock idempotence and the garland-save migration; every request's rejects;
  beat judging; leak schedule determinism. Existing tests and Emberleaf placement hashes unchanged.
- **Budget:** at the cove with 1 player, at most +25 draw calls over today's view there (courses are merged meshes per course; moving pads one
  InstancedMesh per kind), no new lights, no new shader program beyond one patched toon for the lava crust glow. Courses and Marlo are built
  only while Emberleaf is full detail.
- **No regressions:** outside a course zone the player code path is unchanged (a test runs a home walk and compares positions bit for bit).

**Hand-off.** One sub-agent per substep. Read first: this section, CLAUDE.md "Architecture" + "Testing technique", `player/player.js`
(`hop`, `_animate`, the movement / walkability step), `world/mossback.js` + `npc/mossback.js` (the NPC pattern), `world/garlandStand.js` +
`game/feastScene.js` (`addReveal`, `onFeastEnd`), `game/emberSave.js`, `world/islands/emberPlacement.js` + `emberGarden.js` +
`world/lavaMouth.js` / `world/islands/lavaMouth.js` (keep-clear in a clearing), `game/pageMotion.js` (clock-driven movers), `world/popIn.js`,
`game/cinematic.js` + `game/bridgeScene.js`. Each substep bumps the minor / patch version (0.68.0 for 68a, then 0.68.1...), updates README +
CLAUDE.md, keeps `npm test` green, and says what was and was not verified (audio by ear, real pads / phones, a human run of each course).

#### Step 68e–g: playtest fixes for the boat quest (added 2026-10-15; 68e implemented 0.73.2, 68f / 68g not started)

A playtester who had not seen the design played the whole Emberleaf boat quest. Their notes, and the cause found in the code for each:

| # | Note | Cause in the code today |
|---|---|---|
| 1 | The spiral climbs are too unforgiving for required content | `BOAT_COURSES.sail` / `.compass` = 24 pads each (rise 0.4 / 0.35, r 1.15) in a full spiral round a trunk (`emberParts.js spiral`); the only checkpoints are pads 0, 12 and 23; a missed hop lands on the GROUND (no water there, so no splash-respawn) and the climb starts again from the bottom. The compass pads are all `wet` (slippery). |
| 2 | You can't see behind the pillars | Half of every spiral is on the far side of a solid trunk (tree r 1.65, headland r 1.8, 6-13 u tall) from the fixed follow camera; nothing fades it. |
| 3 | The ramp-like things in the jump courses are unclear | `backDown` / `approach` ramps are plain boards with low rails (`boatParts.js rampParts`); their only label is a field nobody draws. |
| 4 | The star controls are hard | Stick left / right turns the ring and up / down aims at the same time; the hold only counts while the stick is centred, inside a 0.12 rad roll and 0.09 rad aim tolerance (`BOAT_SIGHTS`, `boatLookouts.js`). |
| 5 | The target star group is not obvious | The five target stars are ordinary sky stars until found; only dotted overlay circles mark them. |
| 6 | Waiting for night, with no easy way to leave and come back | Sights need 19.5-5.5 (`BOAT_SIGHTS.night`), the cycle is 630 s; nothing offers to skip ahead, and the cove is far from any fast way back. |
| 7 | The tar game has no effects; picking up the pot is not apparent | The pot is a small offhand model with one steam sphere; the `tar` event plays no sound or toast; the seep has no look of its own. |
| 8 | Falling into water and teleporting while tarring and while plugging | The tide-pool course zone (`emberCove.js coveCourse`, r 17 round frame (13, 1.5)) covers the wreck, the seams and the shore, so any wet cell below `gapY` there is a GAP: a splash and a pop back to `stone-1`. The deck course (r 6.6) does the same round the floating hull: a step off the deck = splash + checkpoint teleport. |
| 9 | Marlo's clues are cryptic | `marloScript.js` hints name landmarks without directions ("the sea-stack headland"), mix three hints into one page, and the next step only shows inside his menu. |
| 10 | Repair menu options still show in Marlo's talk menu after the boat is repaired, even at the next island (the tester's clarification) | `world/marlo.js mainChoices` adds the three `repairRows` (Planks x/8, Seams x/3, Leak test) whenever `boat.state.repair` is true, and that flag stays true forever: after `floated`, after `launched` and at the Duskcrown dock. |
| 11 | The boat cutscene sails through the other course's platforms | The voyage (`boatVoyageLogic.voyagePose`, straight out along t 7.6) and the Step 71 crossing (`boatSailLogic.makeRoute` from the dock at t -1.8) leave the cove across the tide-pool stones (s 3.4..25, t -1..4.6). To confirm in the Browser pane which scene / which pads. |

**Decisions in this plan (the user may change them before work starts):**
- **Courses stay after completion** (68b's design: a course stays open for fun). Note 10 was only about Marlo's leftover repair menu rows.
- **Night waiting is solved three ways (user-approved 2026-10-15):** Marlo offers to wait for the stars (skips the shared clock to dusk), the sight window opens at dusk (18.0), and Marlo's dialog says plainly you can leave and come back.

##### 68e — Easier, readable courses (0.73.2)

- **Fewer, bigger, lower steps:** the sail and compass courses become about 12-14 pads (`BOAT_COURSES.*.steps`), rise 0.3, pad radius 1.5 (landings 1.8), gaps at most 1.6 u (the validator limits stay as they are; these numbers sit well inside them). The rudder keeps its idea but the crust `period` grows (10 -> 14 s) and `warn` (1.2 -> 2 s) so the still window is long.
- **Camera-facing layout, not a full spiral:** the climb becomes a switchback on the camera side of the trunk / headland (the follow camera looks toward -Z: all pads keep `z >= anchor.z - 0.5`), a zig-zag of short arcs with broad turn landings. Nothing of the route ever stands behind the trunk.
- **Occluder fade as a safety net:** the trunk, the canopy blobs and the headland rock dither out while they cover a local player (reuse `duskFade.js capCovers` / `stepFade` and the screen-door idea of 69c's glow material; or split the trunk into its own mesh with a fade uniform). No new program if the dither can reuse the existing patched toon; at most one if not.
- **Catch, don't restart:** a fall that drops more than 1.2 u below the player's last checkpoint pad (or lands on the ground inside the zone after any checkpoint) is a gentle "poof": a short fade and a pop back onto that checkpoint (the existing `_courseRespawn` path, without the splash sound). Checkpoints every 4 pads, shown by a little flag on the pad and a soft chime on first touch.
- **Swaying pads are optional:** the required route uses only still pads; swaying caps become shortcuts beside it. Compass: only every third pad is `wet`, with a ring of moss marking the dry ones.
- **Readable ramps:** `backDown` becomes a bamboo SLIDE (curved rails, a rope rail, a downward arrow on a sign at its top reading "Slide back down") and `approach` a staircase of logs with a "Climb" sign at its foot; signs are canvas faces like the trail signposts (one merged mesh per course, no extra interactables). The next-pad glint also lights the slide once the part is taken.
- **Tests:** `validateCourse` on the new layouts; a test that no required pad lies behind the trunk from the default camera (ray from the default camera offset to each pad top misses the trunk cylinder); the catch rule with the real `Player`; Emberleaf placement / terrain hashes unchanged.

##### 68f — Star chart: simple controls, bright targets, no waiting (0.73.3)

- **Controls:** **up / down aims** (left / right does nothing), **Interact (held) turns the ring** steadily (`turnSpeed` about 1.2 rad/s), a tap turns one notch; **Cancel leaves**; the hold counts whenever the stars are inside tolerance and Interact is not held (the stick may rest anywhere). Tolerances widen (roll 0.12 -> 0.25 rad, look 0.09 -> 0.15) and a soft snap pulls the ring onto the target angle inside 0.35 rad. Hold drops from 1 s to 0.6 s. The overlay text: "Up / down: aim · Hold Interact: turn the ring · Cancel: leave", with the real button names per device (keyboard E, pad A, GameCube A, phone A).
- **Bright targets:** while a sighting view is open and also from the lookout at night, the post's five stars draw as large pulsing gold stars with a soft halo and faint dotted joining lines (one extra Points layer + one line segments mesh in `sky.js`, shown only at Emberleaf at night); the overlay ring marks become bigger gold notches that turn green as each mark lines up. Found constellations keep today's look.
- **Lookouts stay put** (sail tree top, headland top, crow's nest; user decision 2026-10-15): the easier 68e courses plus "Wait for the stars" should make the night climbs fine. Re-check after 68e / 68f.
- **Wait for the stars:** once the boat has `floated` and it is day, Marlo's menu has "Wait for the stars with Marlo". Host request `boat.wait {}` (rejects: not floated, already night, any cinematic / feast / page / combat run, actor far from Marlo): a 3 s fade with Marlo humming by a little beach fire, the host `dayNight.set(18.2)` (replicas snap as they already do on a `set`), then the fade lifts at dusk. The day clock is shared, so every screen's island goes to dusk; that is acceptable (the feast already changes the mood for everyone) and the dialog says "the whole crew rests a while". Garden growth: `set()` must not count a skipped dusk / dawn phase twice (check `reconcilePhase` / `growPhases`; only forward boundaries count, which is the intended effect of a rest).
- **Night window opens at dusk:** `BOAT_SIGHTS.night` 19.5 -> 18.0 (stars are already visible at dusk; confirm the five targets read against the dusk sky in the Browser pane).
- **Leaving is fine:** after the float, Marlo says that the stars only come out at night, that the crew can rest with him or go and do something else, and that the boat will wait; the cove signpost gains "Homeward" travel (a travel post at the cove spur using the existing `game/travel.js` far posts) so coming back later is one menu away.
- **Tests:** controls (a fake actions stream: aim + Interact turns, alignment, hold with the stick resting off-centre), widened tolerances, the `wait` request rules + host / replica clock snap, save compatibility (old saves with sights stay valid).

##### 68g — Repair comfort, Marlo's clues, cleanup and the cutscene path (0.73.4)

- **No teleports around the boat:** the tide-pool course zone shrinks to the stones' own area (a capsule along the stone line instead of the r 17 disc) so the wreck, the seams, the seep route and the shore are ordinary ground again (shallow water is wading, as everywhere else on the island). The deck course gets **rails**: the deck edge is a wall (`blocks`) except at the gangplank, so nobody walks off mid-test; if someone still ends up in the water (a hop over the rail), they wade, no splash, no checkpoint teleport. A test walks the real `Player` round the hull, along the tar route and round the deck edge and asserts no respawn.
- **Plugging comfort:** leak reach 2.8 -> 3.5 u and leaks only spawn on the deck's middle strip, so standing in the middle reaches most of them.
- **Tar effects and feedback:** the seep becomes a bubbling black pool with rising smoke puffs and a slow glug loop (pooled particles, no light); taking a pot plays a "glop" + sizzle, a pop-in of the pot, a toast "Hot tar! Carry it to a dark seam" and a cooling ring over the carrier's head (reuse the `.drop-hold-ring` style, emptying as `tarHeat` falls, red in the last 2 s). The pot gets a bigger model in the offhand with dripping tar specks and denser steam; the three open seams glow a pulsing gold outline while any local player carries hot tar. Sealing plays a hiss + a smoke burst and wipes a glossy dark stripe along the seam over 0.4 s. `coolS` 6.1 -> 10 s (the route stays the same; the timer is no longer the challenge). Remote carriers show the same pot, drips and steam (the pot is already synced), but the ring and toast are local only.
- **Marlo's clues, rewritten** (text approved by the user 2026-10-15, listed below under "Marlo's new lines"): one idea per page, plain words, a direction from the cove and a landmark. **No button names and no references to controls** (no "Space / Y", "Interact (E / A)", "the stick"); the on-screen prompts already name the action. His voice (warm, "crew", clams) stays in the first sentence. A new menu row "Where are they?" shows one page per missing part. **A boat objective in the quest tracker:** the tracker slot (the same spot the campfire quest uses, `ui/questTracker.js`) shows "Marlo's boat: <next step>" (the `nextHint` lines) while the player is on Emberleaf, the boat is not launched and no fire quest is shown there; the objective chip's edge arrows (`ui/objectiveChip.js` idea, `.hud-edge-objective`) point to the next target (the next part's course start, the seep, the hull marks, Marlo, a spyglass) after 30 s without progress.
- **Marlo's menu follows the boat** (the repair-row / "How's the boat?" part is DONE in 0.85.8, `questRowsShown`; the star-chart rows come with 68f): the three repair rows (Planks, Seams, Leak test) show only while the repair is under way (`repair && !floated`); after the float the menu has the star-chart rows ("Wait for the stars" by day, the voyage row when the chart is done); after `launched` and at the Duskcrown dock, nothing about the repair or the chart. `boatPages` / `nextHint` follow the same states. Test every state (before unlock, parts, repair, floated, chart done, launched at Emberleaf, at Duskcrown) for the rows shown.
- **Cutscene path:** both the voyage and the crossing routes get a clearance test against every course pad (tide stones included; courses stay), nest pad and cove collider: the route keeps 3 u from all of them; move the out-leg seaward of the stones (or bend the route) where it fails. Confirm in the Browser pane which scene the tester saw.
- **Tests:** the new tide zone (wreck / seams / seep outside it), deck rails with the real Player, the `tar` pickup feedback hooks (event -> toast / sound / ring on the right screen only), `coolS`, rewritten script pages (every hint names a direction; no page longer than ~200 characters; no button or control words: a test greps the script for Space / E / A / Y / stick / button), tracker row rules, Marlo's menu rows by state, route clearance.

###### Marlo's new lines (68g, approved 2026-10-15)

- **Intro, last page:** "But if you're the hopping sort of crew, I could use a few hops. My planks washed up on the big flat rock out in the tide pools, right in front of us. Hop from stone to stone. If you fall in, you just pop back to the last stone."
- **"How's the boat?", no parts back:** "She's a sorry sight, crew. Four parts are missing: planks, sail, rudder and compass." / "Start with the planks. They're on the big flat rock out in the tide pools, in front of us. Hop the stones out to it and grab them."
- **"Where are they?" (one page per missing part):**
  - Planks: "On the big flat rock out in the tide pools, right in front of the cove. Hop the stones to reach it."
  - Sail: "Caught in the giant tree south-west of here, on the south shore. Climb the steps around the front of the tree. At the top, the sail makes a fine glider for the way down."
  - Rudder: "On the far west side of the volcano, the way you came from the bridge. Look for the glowing orange pool. Rest on the dark rocks and hop across the floating crusts when they come up. A shaking crust is about to sink."
  - Compass: "Up the rocky headland north of here, along the beach. The steps are slippery, so land gently. The shell bell halfway up is your checkpoint."
- **Some parts back:** "Good hopping, crew! Biscuit stacked the [parts] by the hull." / "Still missing: [list]. Ask me 'Where are they?' and I'll tell you one at a time."
- **All parts back:** "Every part is back! Sail, rudder, compass and planks. Let's patch her up, crew!"
- **Repair rows (only while repairing):**
  - Planks x/8: "Stand on a gold mark next to the hull. I tap the bucket; hammer along with my taps, four in a row, to nail a plank. Each mark takes two planks."
  - Seams x/3: "Hot tar comes from the black bubbling pool behind my lean-to. Scoop up a pot, then carry it to a glowing seam on the hull before it cools."
  - Leak test: "Walk up the plank onto the boat to start. For 45 seconds, plug the blue water leaks as they pop up. If she fills up, we just try again."
- **After the float, before the chart:** "She floats! Now we need the stars to chart a course." / "Stars only come out at night. There are three spyglasses: at the top of the sail tree, the top of the compass headland, and the crow's nest pole here on the beach." / "You can wait here with me until dusk, or go do something else and come back later. The boat isn't going anywhere."
- **Chart done:** "Three sights, crew! That's our chart. Ready to see what's past the horizon?"
- **Next-step hints (menu line and tracker):** "Next: hop the tide-pool stones out to the big rock for the planks." / "Next: the sail, in the giant tree south-west of here." / "Next: the rudder, in the glowing pool on the volcano's west side." / "Next: the compass, up the rocky headland north of here." / "Next: nail planks, seal seams with hot tar, then start the leak test." / "Next: at night, look through the three spyglasses (or wait for the stars with Marlo)." / "Next: talk to Marlo to set sail!"
- **Toasts:** tar pickup "Hot tar! Carry it to a glowing seam." / tar cooled "The tar cooled. Get more from the black pool." / spyglass by day "Stars come out at night. Wait with Marlo, or come back later."
- The spyglass's own on-screen help (not Marlo) keeps short control hints, as 68f describes.

**Budget for 68e–g:** courses have fewer pads; new: star target layer +2 draws at night at the lookouts only, tar seep +1-2, cooling ring is DOM, signs merged into each course mesh. No new lights; at most one new program (the occluder dither) and only if the existing patched toon cannot take it.

**Hand-off.** One agent per substep (68e, 68f, 68g in that order; 68g's tide-zone fix can go first if the user wants the teleports gone soonest). Read first: this section and the Step 68 section above, CLAUDE.md "Testing technique", `world/islands/emberParts.js`, `world/boatParts.js`, `game/hopLogic.js`, `player/player.js` (`_courseRespawn`, `_switchCourse`), `world/islands/emberCove.js`, `world/boatRepair.js`, `game/boatRepairLogic.js`, `world/boatLookouts.js`, `world/islands/emberLookouts.js`, `game/boatSightLogic.js`, `world/sky.js`, `world/dayNight.js`, `game/marloScript.js`, `world/marlo.js`, `game/boatVoyageLogic.js`, `game/boatSailLogic.js`, `world/islands/duskFade.js`. Verify each substep in the Browser pane with real keys (a human-paced run of each course from a running start, a sighting with the new controls at dusk, a full tar run, a leak test walking the deck edges, both cutscenes framed at 1280x720) and say what was not verified (audio by ear, real pads / phones, a second screen).


## Progress

## Step 68: Skipper Marlo's boat — hop courses and the voyage out of Emberleaf

- [x] Step 68a (0.68.0) — Hop-course system (pure `game/hopLogic.js` + course validator, player heights only inside course zones, splash / checkpoint), the cove, Skipper Marlo + Biscuit, the `boat` domain + save, the unlock on the first Emberleaf feast, the tide-pool tutorial course and the plank bundle — Implemented 0.68.0: cove at island-local (89, 48) facing 29 deg on the south-east shore (a probed clearing: Emberleaf's placement hashes are UNCHANGED; the cove claims no solid and the 'ember-cove' trail spur has `lane: false`), `game/hopLogic.js` + validator + `HOP_COURSE`, player integration (a home walk is bit-identical), `boat` domain + save + garland migration + `?testboat`, `feast.addReveal` as a list, Marlo + Biscuit, 736 tests; verified in the Browser pane: unlock pop-in, Marlo's talk, real-keyboard hops along every link, splash / pop back, the plank take + Biscuit's flight, host + replica equal hashes, +19 draw calls; NOT verified: real pads / phones, audio by ear, a human playthrough (the sail / rudder / compass courses and moving pads in play come with 68b) Review 0.70.3: retain the vertical body beyond course zones until landing; all goal pickups share feet-height / 2.2 u reach checks and prompt eligibility.
- [x] Step 68b — The sail (sway + glide), rudder (sinking lava crust) and compass (slippery sea-stack) courses and part pickups - Implemented 0.70.1: clearing centres local (47, 88), (-39, -8), (101, 17); placement / terrain hashes unchanged, three checkpoints / return ramps, shared-clock instanced pads, sail glide / pose canopy, saved takes / Biscuit ferry / Marlo hints. Raised rudder basin plus approach preserves the slope. Verified 793 Node tests per-file with isolation disabled (plain npm test blocked by sandbox spawn EPERM): real Player vertical routes with prescribed horizontal input and actual collision, ramp clearance, lava / sea respawn, glide / slip, sink windows, broken variants, replica takes / saves / hashes, runtime lifecycle / mesh budget (Node view maxima +17 / +8 / +7, no lights). NOT verified: browser renderer draw calls, GPU / real devices, audio by ear, human feel / first-try 30-60 s timing (optimized routes ~22 / 26 / 22 s). Repair / voyage remain 68c/d. Review 0.70.3: shared host / deferred replica take result arms the carrier across body creation; standard gamepad Interact regression; 1 u sway / 12 s, broader 1.5 u caps, validator and real Player routes pass; continuous off-zone fall / glide tests.
- [x] Step 68c — The repair: plank nailing to a beat, the tar run, the leak-test float — implemented 0.70.6: Marlo repair agreement; shared 0.8 s beat +/-0.14, four consecutive timed / standing hits, two nails at four marks; offhand synced session tar pot / fading steam, three sealed seams, coolS 6.1 (~1.6x a real Player 3.81 s / 24.52 u sand route around colliders; no optional hop shortcut); hull slides to shallows / gangplank / three level bob pads, model-only tilt; seeded 45 s float (6/9/12/15 leaks), exact bilge / visible line, lenient plug, overflow bailout / immediate retry, saved floated success. Host-authoritative repair/nail/tar/seal/float/plug, snapshot pots / current float, saves exclude sessions, consumed beat evidence, expanded debug / actual syncStress boat action. Verified 860 Node tests / 80 files per-file with isolation disabled (npm test blocked by sandbox spawn EPERM): pure rules / hostile normalisation, host+replica rejects and equal hashes, late snapshot, save lifetime, local / remote offhand pots preserving tools, shared-mark Interact, actual Player collision route and gangplank hop physics, seeded stress, old placement / home parity. Node solo allocation bound 12 added mesh submissions (8 repair + pot/steam 2 + deck 1 + next-pad glint 1); no new lights. NOT verified (no browser): actual renderer calls / programs / GPU, visual framing / colours, human beat feel / tar comfort / deck play, audio by ear, real network / pads / phones. Claude Browser pane review pending; star chart / voyage remain 68d.
- [x] Step 68d — Implemented 0.70.7: three night spyglasses (existing sail / compass goals plus nine-rung cove nest), local real-sky camera / stick ring / 1 s hold, seeded five-star constellations, host night / reach / duplicate gates and saved sights; separate host-timed voyage domain queues behind cinematics, shared start / skip / completion, 16 s push / sail / horizon / return / dock scene, saved launched, walkable dock next-tide hook and lean-to bottle. Hull closes each nailed board, hides completed rib bays, dark tar joins, full mast / furled sail after float and filled voyage sail; event pop / thunk, silent load. Debug / syncStress extended. Verified 883 Node tests / 83 files per-file with isolation disabled (npm test sandbox spawn EPERM): pure gates / alignment / normalisation, nest validator, real host+replica rejects / late snapshots / shared skip / hashes / saves, cosmetic crew ownership / dock finish, old placement / home tests and original star-position bytes. Node solo addition bound 9 submissions, nest/telescopes 3 draws / 4,984 triangles, no new lights. NOT verified (no browser): actual renderer calls / programs / GPU, framing / colours / star readability, human sighting / cinematic feel, audio by ear, real phones / pads / network. Claude Browser pane review pending; Set sail intentionally remains the next-tide placeholder.
- [x] Step 68e — Playtest fixes, courses: ~12-14 bigger, lower pads on a camera-facing switchback, occluder fade, catch-and-poof falls, optional swaying pads, labelled slide / stairs. Implemented 0.73.2: sail / compass = 12 pads (3 runs x 4, rise 0.3, r 1.5 / 1.7, gaps <= 0.9 u) at z >= anchor - 0.5 with the trunk / headland beside the goal; checkpoints 0 / 4 / 8 / 10 with flags + chime; `hopLogic.catchFall` (depth 1.2; never the start, the slide / stairs or a glide) + `hopEvents.onCatch`; optional sway stones (sail), wet every third step + moss (compass), rudder period 14 s / warn 2 s; bamboo slide + log stairs + one sign-face mesh per course; trunk / headland dither (alphaHash clone, `boatParts.update(dt, camera)`); 994 tests. Browser, GPU and human feel NOT verified
- [ ] Step 68f — Playtest fixes, star chart: up / down aims + Interact turns the ring, wider tolerances, bright pulsing target stars, "Wait for the stars" with Marlo, sights from dusk (18.0)
- [ ] Step 68g — Playtest fixes, repair and story: tide zone off the wreck, deck rails (no splash teleports), tar seep / pot / seal effects and pickup feedback, coolS 10 s, plain-language Marlo hints (no control words) + boat tracker row + arrows, repair rows only while repairing, cutscene route clearance
