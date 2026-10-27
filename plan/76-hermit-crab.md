# Step 76: The Emberleaf hermit crab ("The Shell Ladder")

The third island pet: a big strawberry hermit crab on Emberleaf. Its quest line is a hunt for ever bigger shells. This step also builds
**ground-pet following** (planned as 74e), because the crab walks; Capray and Carle fly. The index of every step is [PLAN.md](../PLAN.md).

## Spec

**Decisions (user, 2026-10-26):**
- The Emberleaf pet is a hermit crab based on the **strawberry hermit crab**, but bigger. The user shared a reference photo: a bright red
  crab with white speckles in a cream, brown-striped whelk shell.
- The quest line is **option A, "The Shell Ladder"**: the crab outgrows its shells, and players find it bigger and bigger ones around
  Emberleaf.
- **No time or day/night gates:** Emberleaf already has quests that use the clock (the garden). Every stage advances only by what players
  do. Nothing waits for dawns, nights, phases, real time or offline time.
- Ground walking for land pets is built now, as part of this step.
- Working id **`ruby`**, display name "Ruby". This is a placeholder; the user may rename it.

### Step 76a — the crab model and ground-pet following

**The crab model** (`npc/petsEmber.js`, added to the pet kit like the 74a models; the shared `petMaterial()`, the skinned variant if it
needs bones, the `#2b2340` outline):
- **Size:** chunky and cute, about knee-high to the 1.65 u player. At its final size the shell top is about 0.55 u, and it is about
  0.75 u long including the shell. The quest grows it in steps (see 76b), so the builder takes a `size` and a `shell` option, or exposes
  `setSize(k)` / `setShell(id)`.
- **Body (strawberry hermit crab):**
  - The legs, claws and head are glossy **bright strawberry red** (about `#d8261c`, shading to `#b01812`), covered in many small
    **white-cream speckles**. Use a vertex-colour dot pattern from deterministic noise, like the 74a "tissue" mottling, not a texture.
  - **Two big claws**, the right one a bit bigger, held up in front of the face like little mittens. They are speckled too, with a
    darker red tip.
  - Three pairs of **walking legs**, thick, segmented and curving out to the sides.
  - Two big **eye stalks** with glossy **black eyes**, each with a white highlight. They are the cutest part, so make them prominent.
  - **Orange** mouthparts and two pairs of long thin **orange-red antennae** (one long, one short), with a gentle sway.
  - The soft **abdomen** (curled, pinkish red) hides inside the shell. It is only seen in the "no shell" moment of a swap.
- **Shells** (separate meshes, swappable, each with the outline):
  - `cap`: a bottle cap, for the start.
  - `whelk`: small, sandy.
  - `turban`: a round tide-pool shell, pale green and white.
  - `coconut`: a hollowed half coconut, brown and hairy.
  - `conch`: a big spiral, warm orange.
  - `home`: the final shell, like the photo. A **cream / ivory whelk** with fine **brown growth stripes** and a few brown speckles,
    a wide opening, and a little obsidian and bamboo trim added at the hearth.
- **Animations** (`update(dt, t, { anim, speed })`):
  - `idle`: a body bob and antenna sway, a claw clack now and then.
  - `walk`: a **sideways-capable** scuttle (the legs alternate in two groups; the shell rocks).
  - `hide`: it pulls fully into the shell and the eyes peek out.
  - `wave`: one claw up.
  - `swap`: it pops out of the shell, panics, and scuttles.
  - `dig`: it shovels sand with its claws.
- **Budget:** at most 4 draw calls per crab including shadow, under about 15k triangles, no new lights, at most +0 shader programs beyond
  the existing pet materials.

**Ground-pet following** (this was 74e; the crab is the first user, and the framework must also work for Snowsong later).
- **Pure maths:** a new `game/groundPetLogic.js`, or an extension of `game/petLogic.js`, Node-tested. A pet declares `move: 'fly' | 'ground'`
  in `PETS`. Capray and Carle stay `fly` and must behave **exactly** as before.
- **Ground movement:** the pet walks on the terrain (`getHeight`). It heads for the same per-slot heel point behind and beside its owner,
  with a walk speed and a catch-up run speed. It turns smoothly to face where it goes (the crab also sometimes walks sideways for fun).
- **Obstacles:** cheap local steering round colliders. Sample a few headings around the desired one, keep the ones that are walkable and
  free of colliders (`colliders.js` queries), and choose the closest to the target. It slides along walls. There is no global pathfinding.
- **Stuck or lost:** if it makes no progress for about 2 s while far away, or the owner is beyond `PET.lost`, or the heel is on ground it
  cannot walk (deep water, a cliff, another island), it **poofs** to the nearest walkable spot near the heel, like Capray's poof.
  Bridges must work by walking.
- **Where pets show:**
  - The **boat crossing**: a ground pet rides in the boat beside its owner, sitting; or it is hidden and poofs in on arrival. Choose
    whichever is simpler with the boat scene code, and document it.
  - **Combat areas:** it follows, cannot be targeted and never blocks.
  - **Storybook pages:** hidden.
  - **Feasts:** it sits beside its owner's seat.
  - **Downed owner:** hidden.
  - All the same as the flying pets.
- **No collider or interactable** on any pet. It never blocks players or gets targeted.
- **Idles** (per-pet tables, like Carle's): when the owner stands still the crab picks one: `hide` then peek, `wave` at the owner, `dig` in
  sand (only on sand ground), blow a little stream of bubbles near water, or a short sideways shuffle round the owner. Snowsong's idles
  are designed later, in 74d.
- **Registry:** `PET_IDS` becomes `['capray', 'carle', 'ruby']` (pose id 3; older packets still decode). `PETS` gains Ruby with
  `move: 'ground'`. **Debug unlock only in 76a:** `__game.pets.unlock('ruby')` / `preview('ruby')`. The stable lists Ruby once it is
  unlocked and replaces the "A rustle in Emberleaf's leaves..." silhouette; the crab rests in the stable's basin area when nobody brings it.
- **Snowsong check:** add a debug path to make the Snowsong WIP model follow with ground movement (for example
  `__game.petLab.follow('snowsong')`), so the framework is proven on a quadruped too. Snowsong stays out of `PET_IDS`.
- **Tests:**
  - The ground steering maths: it reaches the heel on open ground, gets round a collider, slides along a wall, and poofs when stuck,
    lost or on unwalkable ground.
  - Capray and Carle are unchanged.
  - Pose id 3.
  - Ruby builds, follows, stays inside the draw-call budget, and its `update` is driven.
  - The stable listing.

### Step 76b — "The Shell Ladder" quest line

**Gate:** the quest opens once `pets.questlinesOpen`. Skipper's Cove must be awake; it always is by then, since Capray needs the boat. It
never waits for time of day, phases, dawns or real time.

**The stages** (host-authoritative `ruby` domain; pure rules `game/rubyLogic.js`, the host side `game/ruby.js`, the world side
`world/rubyWorld.js`; saved in the existing Emberleaf file `infinite-island.emberleaf.v1` under a `ruby` key through `game/emberSave.js`).
Every swap plays a short **swap beat**: the crab pops out with no shell, panics in a little circle, dives into the new shell, then grows
one size with a sparkle and a happy claw wave.
0. **The little thief.** A tiny crab in a **bottle cap** has been snatching shiny things at Skipper's Cove. The first time a player
   comes within about 6 u, it grabs something glinting and scuttles off sideways, leaving a short trail of sideways footprints to a tide
   pool near the cove. Skipper Marlo has a line: "That little rascal's been nicking my bottle caps since the storm, crew. Lost its shell,
   poor thing." Stage 1.
1. **The whelk (digging).** It wants a real shell (a thought bubble with a shell icon). A **sparkling dig spot** appears on the Emberleaf
   beach nearby (a new `digspot`-like interactable, shovel only, using `gathering.dig`'s pattern). Dig it up to get a **Small Whelk**
   (a quest item, never cooked). Offer it to the crab: the swap beat, size 2.
2. **The turban (hop course).** It outgrows that quickly and points out to sea. Add a short, easy **tide-pool hop course** at the cove
   (`game/hopLogic.js` / `world/hopCourses.js`, the same rules and assists as the 68a tutorial course: about 6 to 8 stones, no moving
   pads, the catch-and-poof on a fall). A **Turban Shell** waits on the last stone. Bring it back: swap, size 3.
3. **The coconut (chopping).** Now it wants something roomy. Offer a **Coconut** from the shared bag. The crab sets it on the sand, and
   a player hollows it with **3 hits of an axe or hammer** (host-counted like the shade moss hits: `getToolAction` gives a chop or break
   on the new interactable). The coconut halves pop open: swap, size 4. It looks silly and proud.
4. **The conch (the volcano).** It gazes at the volcano. A big orange **Ember Conch** is stuck in a crust of **cooled lava** near the
   lava-tube mouth on the east flank (outside the combat area, on the island). Break the crust with **4 hits of a hammer** (or a sword or
   axe at 6 hits; set the counts in config). Carry the conch back: swap, size 5.
5. **The home shell (the garden hearth).** The conch is still too plain and it wants a real home. At the **garden hearth**, players bring
   **3 Obsidian, 2 Bamboo and 1 Spring Water** from the shared bag. They are given through a host request, like the other hearth gifts.
   The Hearth Spirit and the crab fit the cream, striped **home shell** with obsidian and bamboo trim.
6. **Befriended.** A short host-timed cinematic (`game/cinematic.js`, about 6 s, shared skip):
   - The crab moves into the home shell at the hearth and grows to full size.
   - **Three more crabs** scuttle out of the shells it outgrew (the whelk, the turban and the coconut, now adopted). This is why every
     player can have one.
   - A banner reads "Ruby wants to come with you!" and the host calls `pets.unlock('ruby')`.
   - Every screen asks each local player once: "Bring Ruby along?" (Yes / Not now), like Capray and Carle.
   - Afterwards the adopted crabs potter around the cove's tide pools as decoration (cheap, no interactables).

**Rules:**
- A shell can only be offered at its own stage. Quest items are not tradeable or cookable, and they are kept in the quest state, not the
  bag.
- Items come out of the shared bag through host requests, so two players never spend the same items.
- Reach slack for remote players, like Capray's.
- The crab's spot moves with the stage (the cove tide pool, then the hearth for stage 5): pure placement plans checked against the
  registries (a pattern like `world/islands/homeCarle.js`), clear of the hop courses, the wreck, the cove props and the garden.
- New interactables are registered once.

**Debug:** `__game.ruby.{ summary(), stage(n), give(), hop(), crack(), conch(), hearth(), befriend(), reset(), goto(stage?) }` and
`?testruby` (the quest is open, nothing is saved).

**Tests:**
- The stage machine: order, clamps and save normalisation.
- Each request's validation: the wrong stage, missing items, the tool kind for the coconut and the crust, hit counts, remote reach.
- The placement plans against the real Emberleaf data.
- The hop course passes `hopLogic`'s validator.
- A host + replica pair: a replica offers and hits, the shared skip, equal hashes.
- That no clock or offline-time event changes any `ruby` state.

## Progress

- [x] Step 76a — Ruby's model (strawberry hermit crab with swappable shells) and ground-pet following (replaces 74e). Built with six shells, terrain/collider steering, per-pet idles and Snowsong debug following; 130 focused Node tests pass. Browser look/gameplay review remains.
- [x] Step 76b — "The Shell Ladder" quest line on Emberleaf (no time gates). Host domain, six action beats, swaps/adoption, seven-stone course, saved hearth recovery and debug routes; Node-tested, browser review pending.
