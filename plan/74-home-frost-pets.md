# Step 74: Home and Frostpine pets

Step 73 opened one pet quest line per island once the first pet (Capray) is unlocked. This arc adds the home island's pet and Frostpine's
pet. The index of every step is [PLAN.md](../PLAN.md).

## Spec

**Decisions (user, 2026-10-26):** the models come first, on their own, before any quest or runtime work. The pets are NOT added to the
game in 74a: they are not in `PET_IDS`, the stable, pose packets or saves. They can only be seen through a debug viewer.

- **The home island pet** starts as a **caterpillar**, becomes a **cocoon**, and ends as a very **multicoloured butterfly**. The styling
  is inspired by Eric Carle's *The Very Hungry Caterpillar* (the two reference images the user shared on 2026-10-26). Its id is `carle`
  (named by the user, 2026-10-26).
- **The Frostpine pet** is a **wolf** coloured as a cross between a grey wolf and an arctic wolf. Its id is `snowsong` (named by the user, 2026-10-26).

### Step 74a — the models (caterpillar, cocoon, butterfly, wolf) and the pet lab viewer

**Shared rules (the Step 73a pet kit, `npc/pets.js`).**
- **Build like Capray:** merged `Baker` meshes, vertex colours, the `#2b2340` outline hull baked in, and the shared `petMaterial()`
  (`aGlow` can stay 0 for these pets; give them a faint glow role only where it helps, such as the wolf's eyes at night). The models
  write stencil 1 like every character material (petMaterial already does this).
- **Each model returns the same shape** as `createPetModel` does today: `{ root, rig, meshes, drawCalls, length, height, wingspan?,
  update(dt, t, opts), dispose() }`, plus named pivots for whatever it animates (see each model). The root origin is at the FEET for the
  ground pets (caterpillar, wolf, cocoon at its hanging point) and at the centre for the butterfly (it flies, like Capray). They face +Z.
- **Where the code lives:** new files, so the registry and wire format stay untouched: `npc/petsHome.js` (the three home stages) and
  `npc/petsFrost.js` (the wolf), each exporting builders, and a small `PET_MODELS_WIP` table (in a third file or in `npc/pets.js`, but NOT
  in `PETS`) mapping `carle:caterpillar`, `carle:cocoon`, `carle:butterfly` and `snowsong` to their builders. Pure helpers that can be
  Node-tested (palettes, segment layouts, gait phase maths) go in plain functions in those files or in `game/petLogic.js` if they are
  runtime rules for later.
- **Budget per model:** aim for 4 draw calls, at most 8 (including the shadow pass, counted like Capray's `drawCalls`). At most +1
  shader program across ALL the new pets (zero is better: group pivots on the shared material). No per-frame geometry rebuilds: animate
  with group rotations / positions, instance matrices, or a shader attribute on the shared material. If the shared shader is extended,
  Capray must look and move exactly as before (an attribute that is missing on Capray's geometry reads as 0). Keep each model under
  about 20k triangles. No lights.
- **Scale:** the player is 1.65 u tall. Caterpillar about 0.75 u long and knee high; cocoon about 0.45 u tall; butterfly about 1.0 u
  wingspan; wolf shoulder at about the player's hip (~0.6 u), about 1.1 u nose to tail tip. Chunky and cute, with a big head, like the
  Frostpine critters (`npc/critters.js`).

**The caterpillar (`carle:caterpillar`).** From the book cover: an arched, segmented body of about 10 to 12 round segments (bigger in the
middle, smaller at the tail). Each segment is a different green (yellow-green, grass, emerald, a dark green), mottled so it looks like
painted tissue paper, with teal-blue streaks on some. Every segment has a fringe of short fine hairs around its edge in yellow, orange
and pale blue (thin cones or flat spikes). A small brown stub foot under each segment. The **red head** is bigger than a segment, with
two big **yellow oval eyes with green centres and a dark pupil dot**, a small dark nose, and two **purple-to-blue antennae** (thick
stalks with a lilac tip, standing up and out). Animation: an **inch-worm crawl** (the arch rises and travels from tail to head while
the head moves forward) for walking, and an idle that looks around and nibbles. Expose `headPivot` and whatever drives the segments.

**The cocoon (`carle:cocoon`).** A plump brown teardrop cocoon in Carle's collage style: several browns (chestnut, umber, a little ochre
and olive) in torn-paper bands, hanging by a short silk thread from a small twig with one green leaf. The origin is at the thread's top.
Animation: a slow sway, an occasional **wiggle** (something is moving inside), and a `crack(k)` progress 0..1 that splits the top open
for the hatch (group rotations of two or three shell pieces, not geometry edits). Expose `shellPivot` / the pieces.

**The butterfly (`carle:butterfly`).** From the book's butterfly: four big wings, each a **collage of flat colour panels**. Forewings:
deep blue / teal on the outer half, a navy band near the leading edge with small round dots (pink, orange, yellow), green and yellow
**rays fanning out from the body** with dark lines between them, and one large **pink-orange circle** near each tip. Hindwings: green
and yellow ray panels with violet / purple at the bottom, and a long **purple lobe** ending in a **yellow eye spot with a red centre**.
Small coloured dots scattered over the wings. Build each wing as layered thin panels (a slight offset between layers so the collage reads
in toon shading) with mottled vertex colours; the outline only on the wing silhouette. A thin olive-yellow segmented body, the same
**red head with yellow-green eyes** as the caterpillar (so you can tell it is the same pet), and two thin dark antennae with small knobs.
About 1.0 u wingspan. Animation: wings flap on `wingL` / `wingR` pivots (a slow glide flap and a fast flutter), the body bobs, and a
rest pose with the wings folded up together over the back. The origin is at the body's centre.

**The wolf (`snowsong`).** A chunky, cute wolf pup-proportioned (big head, fluffy chest ruff, thick legs, a big bushy tail), coloured as a
**grey wolf crossed with an arctic wolf**: a cream-white base (muzzle, cheeks, throat, chest, belly, the insides of the legs and the
paws), a soft grey saddle over the back and shoulders that fades into the white on the flanks, a darker charcoal-grey stripe down the
spine and a dark tip on the tail, grey ears with white insides, a light grey forehead with a white mask around the eyes, a black nose,
and **warm amber-gold eyes** with a white highlight. A slightly frosty pale-blue tint in the white is fine but subtle. Animation: a
**trot** (diagonal legs together), a sit, a head tilt, an ear twitch, a tail wag, and a howl pose (head up, mouth a little open).
Expose `headPivot`, `tailPivot`, four leg pivots (`legFL`, `legFR`, `legBL`, `legBR`), `earL` / `earR` and a `jawPivot` if the howl
needs it.

**The pet lab viewer (debug only).** `world/petLab.js` and `__game.petLab`:
- `show(id, opts)` places one model about 2.5 u in front of P1 on whatever island they stand on (on the terrain height), facing the
  camera; `opts.anim` picks the animation (`'idle' | 'walk' | 'crawl' | 'flap' | 'glide' | 'rest' | 'wiggle' | 'hatch' | 'trot' | 'sit'
  | 'wag' | 'howl'`, whichever the model has), and `opts.spin` turns it slowly on a turntable.
- `lineup()` stands the caterpillar, the cocoon (on a small stand or hung from a post so the twig is at a sensible height), the butterfly
  (hovering) and the wolf in a row beside P1 for one screenshot; `clear()` removes them all.
- `summary()` lists each shown model's draw calls, triangles, size (bounding box) and current animation.
- It is updated from `tick` only while something is shown, never touches saves, sync, colliders or interactables, and costs nothing when
  empty.

**Tests** (`test/petModels74.test.js`): each model builds in Node, its draw calls and triangles are inside the budget, its size is in
the ranges above, every listed pivot exists, `update` runs for each animation without throwing and moves the pivots it should, `dispose`
frees the geometries, and `PET_IDS` / `PETS` are unchanged (`['capray']`). Capray's existing tests still pass unchanged.

**Not in 74a:** the quest lines, the stable entries, unlocking, following behaviour on the ground, pose packets and saves.

### Steps 74b-c — "The Very Hungry Visitor": Carle's quest line

**Decisions (user, 2026-10-26):** the caterpillar first appears on the home island **after Capray is obtained**. It must be **fed a
variety of items from the first three islands** (home, Frostpine, Emberleaf), and then there is a **passage of time** while it stays in
the cocoon before the butterfly comes out.

**The shape of it, after the book.** The book's caterpillar eats one more thing each day for five days, has a feast on the sixth that
gives it a stomach ache, eats one nice green leaf on the seventh, then builds a cocoon and comes out a butterfly. The quest follows that
week, using our islands' items. It **only borrows the book's rhythm**: no text, names or pictures from the book.

**Where and when it appears.**
- When the `pets` domain unlocks its first pet (`pets.onUnlock`, or `questlinesOpen` already true at load), a small caterpillar appears
  on a low branch / big leaf of a fruit tree next to the **home campfire** (the stable's hint already says "Something small watches the
  home campfire..."). A live unlock pops it in (`world/popIn.js`); a load or late join shows it silently.
- The placement is a pure, deterministic plan (`world/islands/homeCarle.js`): the nearest suitable apple / peach tree to `FIRES[0]` that
  is not inside the campfire's clear radius, plus a perch point on it. It never changes placement elsewhere; if that tree is felled, the
  caterpillar hops to a fixed fallback perch (a big leaf on a small stump prop, never felled).
- It is decoration plus one interactable (`carle`, "Hungry..." / "Offer ..."), registered once like the critters (never added or lost by
  `world.rebuild('home')`). A thought bubble shows the icon(s) of what it wants today (`ui/thoughtBubble.js`).
- On first sight, when a player comes within 6 u, a short beat: it looks up, a "?" bubble, then the hunger bubble. Stage 0 -> 1.

**Time keeps passing while the game is closed (74b, a general system; decision: user, 2026-10-26).** Until now the clock only runs while
the page runs ("No wall-clock catch-up while away", `world/dayNight.js`). From 74b the game clock **catches up** by the real time that
passed, at the normal rate (1 real second = 1 simulation second; one full day = 630 s, config `DAY_PHASES`). Cheating by changing the
device clock does not matter.
- The time save `infinite-island.time.v1` gains a wall-clock stamp: `{ v: 2, hour, savedAt }` (`Date.now()` at each save, which
  already happens every ~5 s and on `pagehide` / hidden). A v1 save loads as before with no catch-up the first time.
- **At load** (host only, not with `?newgame`, `?daylock` or `?time`): `away = clamp((Date.now() - savedAt) / 1000, 0, OFFLINE.maxAway)`
  (a clock that went backwards counts 0). A pure helper in a new `game/offlineTime.js`, `advanceClock(hour, seconds) -> { hour, entered }`,
  walks the phases at their configured rates (whole cycles in one step, so a month away is not a long loop) and returns the new hour and
  the phase boundaries crossed (`entered`, with a count per phase: `{ dawn: n, day: n, dusk: n, night: n }`). The clock starts at that
  hour and keeps `clock.away = { seconds, entered }` for this load.
- **A hidden tab** (rAF stops, so the simulation stops) counts the same way: on `visibilitychange` back to visible the host's clock
  catches up by the hidden time, if it was hidden longer than `OFFLINE.minGap` (a few seconds; shorter gaps are ignored).
- **Who listens:** `clock.onCatchUp(fn({ seconds, entered }))`, fired once at load (after the domains are created) and after each
  hidden-tab catch-up, on the host only. Replicas get the new hour through the existing `daynight` sync (they snap when more than 0.25 h
  off). Nothing else is changed by default: the Emberleaf garden keeps "no offline catch-up" (its `reconcilePhase` already adopts a
  jumped clock without counting), and timed world events keep using `elapsedHours`, which does not jump. Whether the garden should also
  grow while away is a separate later decision.
- Tunables `OFFLINE = { maxAway: 30 days of seconds, minGap: 5 }` in config. Debug `?away=900` pretends 900 s passed since the last
  save (host, once at load); `__game.dayNight.catchUp(seconds)` runs the catch-up path live.
- **Docs:** update the dayNight file header, docs/ARCHITECTURE.md (the clock contract and the `time.v1` row of the Persistence table) and
  README (what happens to the time while the game is closed).

**The hungry week (74b).** One offering per in-game **day**. A day is counted on the host's clock: each **dawn** boundary the host
crosses moves the quest to the next day, whether it was crossed while playing (the `phase` events, `phasesEntered` / `reconcilePhase`
from `game/gardenLogic.js`, reused, not copied) or while the game was closed or hidden (the `entered.dawn` count from
`clock.onCatchUp`). So: feed, close the game for 15 minutes (more than one 630 s day, so at least one dawn), reopen, and the next feeding
is open. `?daylock` stops counting, and a debug `dayNight.set` that jumps over a dawn counts it. Once today's food is given, the caterpillar is full: a "Zzz" bubble and "Full! Come back tomorrow" until the next
dawn. The menu (`TALK` style, like the critters / Capray) is "Offer N x Item" when the shared bag has enough, otherwise a hint line saying
where it grows. Items come out of the shared bag through a host request (`feed {day}`; the host checks the count, the day and that today
is not done yet, so two players can never spend the same items twice).

| Day | It wants | From | Why |
|---|---|---|---|
| 1 | 1 Apple | home | the book's first day, our first fruit |
| 2 | 2 Lingonberries | Frostpine | |
| 3 | 3 Bananas | Emberleaf | |
| 4 | 4 Peaches | home | |
| 5 | 5 Pineapples | Emberleaf | one more each day, like the book |
| 6 | **The feast:** one dish cooked at each island's campfire: Berry Jam (home), Lingonberry Tart (Frostpine), Grilled Banana (Emberleaf) | all three | uses cooking on every island |
| 7 | 1 Mint | Frostpine | a soothing green leaf for the tummy ache |

The table lives in config (`CARLE.days`) so the list and counts can be tuned without code changes. Each item id must exist in
`game/catalog.js` and have the right `islands` (a test pins this).

**What the player sees during the week.**
- Each feeding: the caterpillar munches through the item (the item's pickup model floats in front of it and a bite-shaped chunk
  disappears per nibble, then it is gone), hearts, and it **grows a little** (root scale 1.0 on day 1 up to about 1.35 after day 7).
- Day 6, after the feast: a **tummy ache**: a green-tinted face (vertex-colour swap on the head role), a wobbly "ugh" bubble and a slow
  roll, until the mint. The mint on day 7 cures it: a happy wiggle and a big stretch.
- After day 7 it says goodbye in bubbles (a heart, then a "cocoon" icon) and the cocoon beat (74c) starts.

**The cocoon and the passage of time (74c).**
- Right after day 7, a short host-timed beat (on `game/cinematic.js`, about 5 s, shared skip): the big fat caterpillar climbs to a
  sheltered branch of the same tree, spins (a swirl of silk particles), and the cocoon model replaces it, hanging from the branch. Stage 3.
- The cocoon needs **`CARLE.cocoonDays` in-game days** (**3**, counted by dawns exactly like the week, including dawns that pass
  while the game is closed: about half an hour, whether playing or away), during which it sways and wiggles more often as the day nears. Interact: "Listen" plays a soft tapping sound and a bubble that
  shows how close it is without numbers (one, two or three little "zz" marks fading).
- When the days are up it is **ready**: it wiggles hard, glows faintly and a sparkle bubble points at it, and a toast tells every screen
  "The cocoon on the home island is wiggling!". The hatch only plays when a player interacts ("Watch"), so somebody is always there to
  see it.
- **The hatch** (host-timed cinematic, about 7 s, shared skip): the cocoon cracks (`crack(k)` from 74a), the butterfly unfolds its wings
  (rest -> flap), flutters a loop around the watcher and lands on their head for a moment; then **three more butterflies** come out of the
  tree's leaves (the reason every player can have one, like Capray's pod). Banner "Carle wants to come with you!". The host calls
  `pets.unlock('carle')`; every screen asks its local players once "Bring Carle along?" (Yes / Not now), like Capray. Stage 5.
- After the hatch the tree is just a tree again; Carle rests at the **pet stable** (on Duskcrown) when nobody brings it, fluttering
  around the stable's basin. The stable's first locked silhouette is replaced by Carle.

**Carle as a pet (74c).** The butterfly flies, so it reuses Capray's **flying follower** (`game/petLogic.js` glide / heel / swoop /
poof); no ground following is needed. `PET_IDS` becomes `['capray', 'carle']` (pose id 2 = Carle; older packets still decode),
`npc/pets.js` `PETS` gains Carle, built from the 74a butterfly model (`createWipPetModel('carle:butterfly')` becomes the real builder;
the runtime must drive its `update(dt, t, { anim })` and skinned material). It glides lower and bobs more than Capray, flaps in bursts
between glides, and has its own idles: rest on the owner's head with folded wings, flutter a loop around the owner, land on the nearest
flower for a moment (home and Emberleaf flowers), and sleep on the owner's shoulder at night with folded wings.

**Sync and saves.**
- A host-authoritative `carle` domain (pure rules in `game/carleLogic.js`, runtime `game/carle.js`, world `world/carleWorld.js`), state
  `{ stage 0..5, day 0..7, fedToday, cocoonDays, phase }` (stages: 0 unseen, 1 sighted, 2 feeding, 3 cocoon, 4 ready, 5 hatched). The
  hashView leaves out `phase` (the host's private day counter, like the garden).
- Saved by the HOST in a new home-island file `infinite-island.home.v1` through `game/homeSave.js` (cached, one key per module, like
  `emberSave.js`). Add the key to the docs/ARCHITECTURE.md "Persistence" table. `?newgame` wipes it; replicas never save.
- The quest does nothing until `pets.questlinesOpen`. A save from before 74b with Capray already unlocked starts at stage 0 with the
  caterpillar present.

**Debug:** `__game.carle.{ summary(), stage(n), feed(), nextDay(), cocoonDays(n), ready(), hatch(), reset(), goto() }` (`goto()` =
teleport to the tree); `?testcarle` = Capray counts as unlocked for this quest only and nothing is saved.

**Tests:** offline time (`advanceClock` against stepping the real clock for many random hours / durations, whole-cycle shortcut,
`maxAway` clamp, a backwards device clock, the v1 -> v2 time save, no catch-up with `?newgame` / `?daylock` / `?time` or on a replica,
the hidden-tab catch-up and `minGap`, and the user's example: feed, 900 s away, the next feeding is open); the stage / day machine (order, one feeding per day, the day counter vs replayed boundaries, clamps, save normalisation),
feed validation (wrong day, not enough items, already fed, remote reach), every `CARLE.days` item exists in the catalogue on the right
island, the placement plan vs real home terrain and trees (and the felled-tree fallback), and a host + replica pair (replica feed,
shared hatch skip, equal hashes).

**Decided (user, 2026-10-26):** in-game time that also passes while the game is closed (above); one feeding per in-game day; 3 cocoon
days; the menu as in the table; the stable hint plus a first-time toast on the home island point players to it.

### Later sub-steps

- 74d — the Frostpine wolf quest (Snowsong), and adding `snowsong` to the registry. To design.
- 74e — ground-pet following (walking on the terrain, going round colliders) for Snowsong. Carle never needs it because it flies.

## Progress

- [x] Step 74a — Models: caterpillar, cocoon, Carle-style butterfly, grey / arctic wolf, and the `__game.petLab` viewer (0.85.4: one skinned mesh each, 2 draw calls, +1 shader program (skinned pet-toon); browser look not verified, see the changelog)
- [x] Step 74b — Offline time (the clock catches up while closed / hidden) and Carle's hungry week: the caterpillar appears after Capray, seven days of feeding from the three islands (on its own sapling near the fire; stops at the placeholder cocoon after day 7; `clock.flushCatchUp()` fires the load catch-up; 45 new tests; browser look NOT verified, see the changelog)
- [ ] Step 74c — Carle's cocoon days, the hatch, and Carle as a flying pet
- [ ] Step 74d — The Frostpine wolf quest, Snowsong (to design)
- [ ] Step 74e — Ground-pet following (to design)
