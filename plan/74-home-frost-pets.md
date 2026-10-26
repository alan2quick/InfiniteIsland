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

### Later sub-steps (to design with the user)

- 74b — the home island pet quest (the caterpillar's quest, the cocoon, the hatch cinematic), and adding `carle` to the pet registry with
  its stage in the save.
- 74c — the Frostpine wolf quest, and adding `snowsong` to the registry.
- 74d — ground-pet following (walking on the terrain, going round colliders), which Capray never needed because it flies.

## Progress

- [x] Step 74a — Models: caterpillar, cocoon, Carle-style butterfly, grey / arctic wolf, and the `__game.petLab` viewer (0.85.4: one skinned mesh each, 2 draw calls, +1 shader program (skinned pet-toon); browser look not verified, see the changelog)
- [ ] Step 74b — The home island pet quest (to design)
- [ ] Step 74c — The Frostpine wolf quest (to design)
- [ ] Step 74d — Ground-pet following (to design)
