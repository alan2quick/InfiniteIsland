# Step 85: The Crownlands

The sunlit plateau on top of Duskcrown Isle, above the Glowcap Marsh. The index of every step is [PLAN.md](../PLAN.md). Duskcrown's own spec
(layout, cliff, cloud lid, the three marsh waterfalls) is [plan/69-duskcrown.md](69-duskcrown.md); read it first.

## Spec

### Step 85 — The Crownlands: a lush alien savanna under floating islands (planned; terrain, water and trees first)

**Decision (user, 2026-10-22):** build out the Crownlands, the plateau that is the north half and east arm of Duskcrown Isle (Step 69 left
it as a flat placeholder at y 46 under a cloud lid).
- It is a lush, Serengeti-like savanna: open grassland and lone umbrella trees, with richer strips along the rivers.
- Floating islands hang above it, like Pandora's in *Avatar*. Their pools spill as waterfalls that fill the plateau's pools and rivers.
  The rivers then run off the edges, either into the sea or down the three existing Glowcap Marsh waterfalls.
- The trees are **acacia- and baobab-like, in unnatural alien colours**.
- The player never needs to see the floating islands themselves, but must see their waterfalls coming down.
  The islands must still exist as real places, because a later quest may reach some of them (a jumping puzzle, or something that unlocks flight).
- **This pass is the terrain, the water and the trees only.** It has no grass and flower cover, critters, gatherables, NPCs, quests,
  music, way up from the marsh, or travel to the floating islands. Those are listed under "Later" below.

**Inspiration** (the user's images, in their private folder; they are described here so no one needs to open it):
- Painted mountains with several tall, thin white waterfalls dropping from high rims into misty green valleys.
- A wide green valley under a bright sky. Ragged floating rocks with grassy tops hang high above, each trailing a few hair-thin falls
  straight down, and stacked layered rock outcrops stand in the grass.
- A lone wide-crowned tree on a grassy rise, with a mossy floating rock behind it whose falls pour from its grassy top.
- Close-ups of floating rocks: rust-brown stone, green tops, long hanging vines, and very long thin white falls. There is a pale
  flock of birds.

The take-aways for this game's look are:
- Thin, bright, very tall falls that read as vertical white strokes and end in mist.
- Ragged, upside-down-cone floating rocks with flat green tops and hanging vines.
- Open grass and lone wide-canopy trees.
- Stacked granite outcrops (Serengeti "kopjes") as landmarks.

#### What the camera can and cannot see (this drives the whole design)
- The follow camera sits about 8.5 u above and 13.5 u behind a player (19 u at the widest zoom) and looks about 45 degrees down. So the top of
  the frame still points downward: **nothing much higher than the camera is ever in frame**.
- A floating island whose underside is more than about 40 u above the plateau ground is therefore never seen in play. Only the lower
  part of its waterfall is seen, falling into frame from above and plunging into a pool. That matches the brief exactly.
- Trees follow Duskcrown's rule: anything taller than about 9 u near the player is cut off by the top of the frame. A canopy between the camera
  and a player hides them, so canopies use the existing screen-door canopy fade (`duskFade.js`).
- The boat voyage, the far mesh and a future flight quest DO see the floating islands. So they are real meshes in the world, not a
  painted backdrop.

#### Layout (pure, deterministic `world/islands/crownLayout.js`, island-local like `duskLayout.js`)
The Crownlands are everything on the plateau side of `L.cliffC` and inside the coast: about 300 x 95 u across the north, plus the east arm
(about 70 x 80 u). In island-local coordinates, x points east and z points south.
- **The rim band is untouched.** Within about 8 u of the marsh cliff edge, and of the sea cliffs, the top stays exactly at
  `PLATEAU_TOP` (46). So the cliff faces, cliff shelves, cloud-lid footprint and every marsh view are unchanged.
  The only exception is the small lip notches where rivers spill over (below).
- **Relief:** the land rises gently from the rim (46) to a low northern upland (about 52-54), with long soft swells.
  The plains are fully walkable, with slopes under `MAX_WALK_SLOPE`.
- **Kopjes:** 6-9 stacked granite outcrops, 6-14 u across, rising 5-12 u above the grass. Their faces are sheer and unwalkable, made of
  rounded stepped blocks. One or two have a walkable ramp of boulder steps up to a flat top, for views and later quests.
- **Crown Rock:** the biggest kopje, near the middle of the north plain and the Crownlands' landmark. It is reserved for a future quest
  hub and stays clear of trees within 14 u.
- **Rivers:** the water network runs downhill in this order:
  1. Floating-island falls drop into plunge pools on the upland.
  2. Pools feed streams, and streams join into 3-4 rivers.
  3. The rivers run south to the three **existing marsh falls**, which are pinned at x -96, -30 and +9 on the north cliff (`L.falls`).
     A short spill north or east goes over the sea cliffs into the sea.
  - Every river is designed *backward from its outlet*, so the marsh layout and its pinned hashes do not change.
  - Wading channels are 2.5-4 u wide, with the floor about 0.6 u below the water surface; they are walkable, like the marsh streams.
  - The deep middle of each plunge pool is unwalkable, like a marsh pond.
  - At each marsh-fall outlet the river cuts a lip notch about 3 u wide and 0.6 u deep into the rim. The marsh fall's top must line up
    with the river's surface there.
- **Sea-cliff falls:** two or three spill points on the north coast and one on the east arm's east coast, falling into the sea. They are
  seen from the boat and the coast.
- **Reserved spots** (keep-clear for flora, flat ground):
  - the top of the reserved way up (`L.notch`, local (-58, 7));
  - a crown landing / spawn spot near it, for `goto`;
  - Crown Rock;
  - four 4 u walking lanes, kept like the marsh's reserved lanes for later paths.
- **Floating islands** (data in the same pure plan):
  - **Big islands:** 5-7 of them, tops 18-45 u across, hanging 45-90 u above the plateau ground. Each has a stable id, a centre, a top
    height, a radius and an underside depth. Each has one or two summit pools and 1-3 spill points; every spill point lines up over a
    plateau plunge pool.
  - **Small rocks:** 8-14 flying rocks of 3-8 u, with no water. They are stepping-stone candidates for a future jumping puzzle; their
    tops stay within plausible jump spacing of each other in at least one chain (planned, not playable yet).
  - At least one island chain must be reachable later from a kopje top. Record which in the plan data, without building any way up.

#### Terrain (`world/islands/duskcrown.js` gains the plateau-top branch; ground types like the other islands)
- The height module answers the plateau top from `crownLayout.js` instead of the flat `PLATEAU_TOP`. Everything off the plateau stays
  **bit-identical**: the marsh heights, the ground types, the 69a BFS and the marsh placement hashes (69c `duskPlacement`, 69d flora `dc5f974e`).
- **Ground types:**
  - `savanna`: walkable, painted lush green-gold with alien tints.
  - `riverbank`: the wet shelf along rivers and pools.
  - `kopje`: rock, unwalkable on steep faces.
  - `rock` (the cliffs) and `water` are unchanged.
  - Unknown strings are already treated as ordinary dry ground everywhere.
- **Ground paint** (vertex colours in the existing terrain shader):
  - Base grass is lush chartreuse-lime `#a6e35a`, drifting to golden `#e8c95a` on the upland swells.
  - Rivers have a teal-mint fringe `#5fd6b0`.
  - Soft lavender patches `#b9a3e8` hint that the place is alien.
  - Kopjes are warm sandstone-granite `#d9b48a`, with `#a8865e` lower bands.
- **Floating islands are NOT terrain in this pass.**
  - The heightfield has one height per (x, z), so it cannot stack an island above the plateau.
  - Each island's top is authored as a small pure height function (`topHeight(lx, lz)`, `walkable(lx, lz)`) beside its mesh, so the later
    travel step can plug it in.
  - That step will need either a layered height query (pick the surface under the player's feet by their y) or a pocket. Decide it there.
  - Here, the islands are visual only and have no colliders.

#### Water (reuse `water.js` ribbon / disc helpers and the 69d inland-water look)
- **Elevated water.** The marsh ponds are filled by the ocean plane, but the plateau water is up at 46-54 u. So it needs its own
  surfaces: flat discs for pools, and ribbons for rivers that step down at small riffles (a short white ribbon at each step).
  Merge them into a few chunked meshes on one shared program. The 69d still-water look applies, tinted brighter and clearer up here
  (`#4fd8e8` shallow, `#2a8fd0` deep).
- **Falls.** One shared ribbon builder makes three kinds:
  - **Sky falls:** from an island's spill point down to its plunge pool. They are thin (0.6-1.4 u), bright and very tall, with a soft fade
    near the bottom into a foot mist puff, and a slow down-scrolling streak texture.
  - **Rim falls:** the plateau rivers feeding the three marsh falls. These extend the existing marsh fall meshes upward to the lip; they do
    not replace them.
  - **Sea-cliff falls.**
  All falls are built once, unlit, and reuse the 69d fall program where it fits (one new program at most).
- **Floating island meshes:**
  - Shape: chunky low-poly upside-down cones with ragged lobes, a flat grassy top, a rust-to-lavender rock underside and dangling
    vine strands.
  - The mesh is built at one level of detail, with a far simplification for the far mesh. All islands go into one or two merged meshes.
  - There are no colliders, and nothing on top in this pass except the pools.

#### Trees (the only flora in this pass; ambient, with trunk colliders)
Built like Duskcrown's mushrooms:
- `crownPlacement.js`: pure, deterministic, Node-tested, with hash-pinned placement.
- `crownAssets.js`: cached geometry.
- `crownVisuals.js`: chunked instanced layers in `propChunks`.
- Colliders are registered ONCE in `duskWorld.js`, so a visual rebuild adds or loses nothing.
- Shading uses toon materials with the dark `#2b2340` outline hulls and the screen-door canopy fade.

- **Acacia** (the umbrella thorn, the main tree):
  - A thin trunk forks into 2-4 crooked limbs under 1-3 flat, stacked, slightly domed canopy plates.
  - Size: 5-9 u tall, canopy 6-11 u wide.
  - Variants: the classic flat-top, a tiered two-plate, and a small bushy young tree.
  - Seen from above, the canopy reads as a big flat plate of colour with a lighter rim and darker under-shadow. So the plates get a
    two-tone top and a soft cast shadow (the existing shadow map, no decals needed).
- **Baobab** (the landmark tree):
  - A fat bottle or tapered trunk (radius 1.4-2.6 u) with a ring of stubby root-like branches, each ending in a small tuft cluster.
  - Size: 7-10 u tall. One or two "elder" baobabs reach 12-14 u but stand only at Crown Rock's foot and near the edges, where the camera never
    passes under them (like Duskcrown's titans).
  - Its trunk is the feature, so it gets a gentle vertical bark-groove normal and a two-tone gradient.
- **Alien colours** (unnatural, but saturated and cute, within the game's palette). Each tree picks one family, seeded:
  | Family | Canopy / tufts (top, rim) | Trunk / bark |
  |---|---|---|
  | Magenta | `#ff5fa8`, `#ffb3d9` | lilac-grey `#c7b8e8` |
  | Teal | `#36d6c3`, `#a8f5e6` | slate blue `#6f84c8` |
  | Violet | `#9a6cff`, `#d4bfff` | bone `#efe3cf` |
  | Tangerine | `#ffa23b`, `#ffe08a` | dusky violet `#7a5aa8` |
  | Baobab bark only | | dusty rose `#e3a3a0` or lavender `#a99ad6` |
  - About 45 % of acacias are magenta or teal, so these read as the zone's signature. Baobabs are mostly rose or lavender trunks with
    teal or violet tufts.
  - **The night tie-in to the marsh:** canopy rims and baobab tufts get faint bioluminescent speckles, driven by `duskUniforms.uGlow`
    scaled by darkness. They are invisible by day and softly glowing at night, so the two halves of the isle feel related.
- **Distribution (savanna, not forest):**
  - **Plains:** lone acacias on wide Poisson spacing (18-30 u), with an occasional pair or trio.
  - **Riverine strips:** denser groups 8-14 u apart along the rivers, and more teal and violet.
  - **Baobabs:** 8-12 on the whole plateau, mostly on swells and kopje feet.
  - **Kept clear:**
    - water and riverbanks;
    - kopje faces;
    - the rim band (6 u: canopies must not overhang the cliff, as seen from the marsh);
    - fall feet (6 u);
    - reserved lanes and spots;
    - slopes above walkable.
  - Rough totals: 90-140 acacias and 8-12 baobabs. Tune to the budget.
- Gentle wind sway, using the existing props-wind uniform (canopy plates only).

#### Lighting: the plateau is sunlit, not dusk
- Step 69b mixes the whole island toward `DUSK_LIGHT` by `0.92 * w`. Add a **crown weight `cw`**, eased like `w`, that is 1 when the
  screen's camera target is on the plateau top (above about 40 u and on the plateau side of the cliff) and 0 in the marsh.
- The dusk mix becomes `0.92 * w * (1 - cw)`. Up top, the day/night clock shows normally, with sunsets that suit a savanna.
- Add a small `CROWN_LIGHT` grade blended by `cw`: a slightly warmer, higher-key sun, a clear sky with a faint lavender horizon (the alien
  hint), and lighter, farther fog so the plains feel open.
- `DUSK_CAMERA` also blends out by `cw`, so the normal camera is used up top. Daytime spores and fireflies are off up top, and a few
  fireflies come out at night.
- **The cloud lid becomes per-screen.** It is drawn unless a local player of this screen is on the Crownlands, or `?crown` is set. With
  the lid on, the crown's visual layers (trees, elevated water, sky falls, floating islands) are not drawn, and the lid is raised just
  enough to cover the new relief and kopje tops. Re-check the 69b overhead and oblique ray tests against the new top.
  So the marsh and the boat keep the secret, and nothing in a marsh view changes.
- No new lights. Everything new stays within about 200 draw calls at a gameplay view on the plateau.

#### Debug and tests
- **Debug hooks:**
  - `__game.world.goto('duskCrown' | 'crownRock' | 'crownFalls')`.
  - `?crown` reveals the plateau.
  - `__game.dusk.crown.{summary, layout, rivers, skyIslands, trees}`.
- **Node tests** (`test/crownlands.test.js`):
  - Every new plan is deterministic, with hash pins.
  - The marsh terrain, the marsh placement hashes and the old islands' terrain hashes are unchanged.
  - The rim band height is exactly `PLATEAU_TOP`.
  - A BFS from the crown spawn reaches the plains and every kopje ramp top. It never reaches the marsh, deep pool middles or kopje faces.
  - The 69a landing BFS still never reaches the plateau.
  - Every river runs strictly downhill (non-increasing surface height) from its source pool to its outlet. Each outlet sits at an
    existing marsh fall x (+- 1 u) or at a sea-cliff spill.
  - Every sky fall's spill point is directly above a plunge pool, and every island underside is at least 40 u above the ground below it.
  - The tree keep-clear rules hold, and no canopy overhangs the rim band.
  - Colliders are registered once across a `world.rebuild('duskcrown')`.
  - Crown weight and lid visibility switch cleanly between the marsh and the plateau.
- **Browser checks:**
  - Screenshots at 1280x720 on the plains, at a riverine strip, at a plunge pool with a sky fall entering the frame, at Crown Rock, at a rim
    outlet looking at the marsh fall below, and at night.
  - A marsh view before and after, which must be pixel-identical.
  - Draw calls, triangles and programs at each spot.
  - No console errors.

#### Substeps (show each to the user with screenshots before the next)
- **85a: Layout and terrain.**
  - Build `crownLayout.js` (relief, kopjes, Crown Rock, river beds, plunge pools, rim notches, reserved spots, floating-island data).
  - Add the plateau branch of the height module, ground types and paint.
  - Add the `goto` / `?crown` hooks and lid hiding.
  - Write the BFS and pin tests.
  - Use plain colours: no water surfaces and no trees yet.
- **85b: Sunlit lighting.** Add the crown weight, the dusk-mix cut, `CROWN_LIGHT`, the camera blend, spores and fireflies off up top,
  and the per-screen lid with its raised envelope. Check the transition by walking with noclip off the rim and back.
- **85c: Water, falls and floating islands.** Build the elevated pool and river surfaces, riffles, sky falls, rim falls joined to the marsh
  falls, sea-cliff falls with foot mist, and the floating-island meshes (full and far). Then run the budget checks.
- **85d: Trees.** Build acacias and baobabs in the alien colour families, the night speckle glow, savanna and riverine placement, trunk
  colliders, canopy fade and sway. Then run the budget and frame checks.

#### Later (not this step; each gets its own step when the user asks)
- Ground cover: tall savanna grass that sways, alien flowers, termite-mound-like spires, river reeds.
- Critters (grazing herds of something alien and cute, birds circling the falls), gatherables, and fishing in the plateau pools.
- The way up from the marsh (the reserved notch at local (-58, 7)), plus a quest and the first reveal moment, including what the lid
  does after that.
- Travel to the floating islands: a jumping puzzle on the small rocks and / or a flight unlock. This needs the layered-height or pocket
  decision.
- Crownlands music (Step 69e's "Under the Crown" already hints at it), NPCs and quests at Crown Rock.

**Open questions (defaults in use until the user says otherwise):**
- Does the day/night clock show up top, or is it always sunny? The default is that the clock shows.
- Should a fourth fall drop from the east arm into the lagoon? It would show the water network from the marsh. The default is no,
  because it would change a marsh view.

## Progress

- [x] Step 85a — Crownlands layout and terrain — implemented 0.85.0: `crownLayout.js` (hash `454a657d`): relief 46 rim band to ~54 upland, 8 kopjes (Crown Rock top 61.6 and kopje-4 with ramps), 8 plunge pools, 3 rivers to the marsh falls + 2 joining streams + 3 sea spills, 6 floating islands (undersides 96-122) + 12 small rocks in 2 chains; savanna / riverbank / kopje ground and paint; lid follows the new relief and hides on `?crown` / crown gotos. 1383 tests pass; marsh heights and placement hashes unchanged. Browser: the three crown spots render, 67-70 draw calls up top, no console errors. Tune later: the mint river fringe is very wide around pools, lavender patches read as puddles under the dusk light, Crown Rock's ramp is a long plain wedge.
- [ ] Step 85b — Sunlit lighting: crown weight, dusk-mix cut, `CROWN_LIGHT`, camera blend, per-screen cloud lid
- [ ] Step 85c — Elevated water, sky / rim / sea-cliff falls, floating-island meshes, budget checks
- [ ] Step 85d — Acacia and baobab trees in alien colours, night glow, savanna placement, colliders, canopy fade
