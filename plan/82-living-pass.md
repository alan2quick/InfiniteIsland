# Step 82: Party Glade living pass

Moved verbatim from PLAN.md on 2026-10-22: the spec first, then the progress lines. The index of every step is [PLAN.md](../PLAN.md).

## Spec

### Step 82 — Party Glade living pass: make every stage feel alive and organic (82a-d complete)

**Decision (user, 2026-10-22):** a second pass over every finished party stage (the lobby and all minigames, including Tilty Tiles and
Bonk Burrows from 81b). The islands feel alive (grass and flowers sway in the wind, butterflies and fireflies drift, water moves and
glints); the minigame stages feel flat and stiff by comparison, and their background decorations look placed by a formula. This step
fixes the look and feel only: rules, judging, timings, controls, scores, camera framing of the play area and the sync are unchanged.

**What the audit found (main session, reading every `world/party/*.js` stage, 2026-10-22):**
- **Placement is formulaic.** Almost every stage lays its trees, rocks, torches and mushrooms on a perfect ring or arc with evenly spaced
  angles and sizes that repeat every 2 or 3 items (`(i / 16) * 2PI`, `r + (i % 3) * 1.6`, `i % 2 ? colourA : colourB`). Some are worse:
  Feast-Go-Round's 16 bamboo stalks stand in one straight row and its hot-spring stones form a perfect circle; Marlo Says lays 9 shells in
  a straight line (`-14 + i * 3.4`); Pinecone Huddle adds 7 pines in a row along the front; Puffball Bumpers scatters 28 mushrooms on a
  golden-angle spiral with radii cycling every 7. Nothing clusters, nothing overlaps, every tree is a post plus one or two spheres.
- **Almost nothing moves that is not gameplay.** Per-frame updates animate the game pieces (vines, logs, flags, caps, balls, dishes, eggs)
  and hosts, but there is no wind sway, no ambient creatures and no moving water, except Driftwood Cast's new glints / ripples / wakes.
- **The party switches the island's life OFF** (`game/party.js` hides `AMBIENT_LAYERS`: butterflies, petals, ocean glints) and puts
  nothing in its place.
- **Water is flat colour** everywhere it appears (Vine Skip's warm moat, Marlo Says' tide pool, Feast-Go-Round's flume and hot spring,
  Glowcap's lagoon, Puffball Bumpers' marsh), unlike the islands' animated water.
- **Ground is one flat colour per disc** with perfect circular edges; no tufts, pebbles, colour variation or worn paths.

**What the islands already have to reuse:** `world/wind.js` (`swayClone(material, {amp, speed})`, `wobbleGroup`, `windTime`: the
grass / flower / herb sway in `world/props.js` and Frostpine's flowers), `water.js` (`waterUniforms`, `buildRibbonGeometry` /
`makeRibbonMaterial` for moving water, foam and glints), `fx/ambient.js` (butterflies, drifting petals, glints, fireflies) and the
islands' particle effects (`fx/particles.js`: puffs, sparkles, embers).

**Shared rules for the whole pass:**
- **Never touch the play area or the readability of the game.** Decorations stay outside every stage's walkable shapes, judged circles /
  lanes / frames and their margins, and never stand between the stage camera and the play area (a test projects every decoration's
  bounding sphere against the camera at 16:9, 9:16 and 19.5:9 and checks it covers no gameplay point). Moving life (birds, butterflies,
  falling leaves) stays thin and never crosses a judged area at gameplay height; nothing ambient looks like a hazard or a pickup.
- **Drawn = judged stays true.** Ambient motion is cosmetic and never moves anything that is judged (e.g. Glowcap caps may bob a few
  centimetres only if the rim the host judges does not move; otherwise they stay still).
- **Budget:** at most about +10 draw calls per stage (instanced / pooled effects, merged scatter meshes), no new lights, and at most +2
  new shader programs for the whole step (the shared sway material and one shared stage-water material). Measure before / after. **Triangles (user, 2026-10-22): about 400k per party view** (stage + 4 players, as `renderer.info.render.triangles` reports it, shadow pass included; the heaviest island view is about 400k): low-poly backdrop pieces, low-poly flowers / tufts, no instances that are never in frame, no shadows for small pieces; a Node test estimates each stage's triangles and caps it. (82a's first lobby reached ~716k and was trimmed.)
- **Organic placement rules:** clusters of 2-5 with one big and smaller companions, varied species per biome, random yaw / scale / slight
  lean, overlapping canopies, density that thins toward the play area and thickens toward the edges of the frame, a foreground layer of a
  few big framing pieces at the frame edges (fading if they ever cover a player), a midground and a background silhouette layer.
  Deterministic from a per-stage seed so every screen sees the same scene.
- **Same feel on every screen,** including replicas and phones (portrait and landscape).

**82a — the living kit + the lobby**
- **`world/party/scatter.js` (pure, Node-tested):** seeded blue-noise / Poisson-disk scatter inside a shape (annulus sector, rectangle,
  polygon) minus keep-out shapes (play areas, paths, other pieces), with clustering (parent / child points), size falloff, density by
  distance, and a layer tag (foreground / mid / back). Returns placements; the stages turn them into merged or instanced meshes.
- **Party decor kit** (`world/party/kit.js` + a new `world/party/decor.js`): richer pieces built from the islands' cached assets where
  they exist (Frostpine pines, Emberleaf palms / ferns / bamboo / banana, Duskcrown mushrooms / reeds / lilies, home oaks / bushes /
  flowers), grass tufts, pebbles, fallen leaves, irregular ground patches (vertex-colour noise and soft blob edges instead of flat
  discs), worn paths where players walk to their spots.
- **Wind:** foliage, grass, flowers, reeds, bunting and flag cloth use `swayClone` (one shared sway material for the party); tree crowns
  get a slow `wobbleGroup`-style sway.
- **Ambient life pool** (`world/party/life.js`): one instanced draw per kind, pooled, biome presets: butterflies / dragonflies (day),
  fireflies and moths (night), birds crossing the sky now and then, falling leaves / petals, light snowfall, drifting spores, embers and
  smoke wisps, fish jumping, steam. The party shows a stage's preset instead of the island layers it hides.
- **Stage water:** one shared animated water material for party water (moving normals, glints, a soft foam edge), using the islands'
  `waterUniforms` time.
- **Hosts and spectators feel present:** idle variety (breathing, looking at whoever is closest to winning, little reactions: a cheer on a
  win, a gasp on a fall, a nod on a perfect move) for every host and the lobby's cheering Tdoongz.
- **The lobby (Party Glade):** replace the 16-tree ring with clustered groves of mixed trees and bushes at varied depths, flower patches
  in clumps with butterflies, swaying meadow grass, bunting that flutters, a little brook or pond with moving water and a frog, drifting
  cloud shadows across the meadow, petals in the breeze, and livelier cheering Tdoongz.

**82b — Vine Skip, Timber Trim, Marlo Says, Pinecone Huddle**
- **Vine Skip** (night terrace): torches no longer evenly spaced on a ring; jungle silhouettes (banana leaves, ferns, palms) framing the
  edges; fireflies and moths round the torches; ember sparks; the warm moat becomes moving water with glints; the glowing Night-Bloom
  flowers in the planter sway; a distant volcano glow with a slow smoke plume.
- **Timber Trim** (log yard): the 12-tree arc becomes a layered forest edge with clustered trees; the flume troughs carry a thin moving
  water film (logs ride on it); sawdust and chips drift after cuts; butterflies and a bird or two; leaves fall now and then; Bramble
  gnaws a stick between logs.
- **Marlo Says** (cove): palms and shells scattered in natural groups (no straight row); the tide pool and the sea get the moving water
  with waves lapping the beach (a moving foam line); seagulls wheel overhead; small crabs scuttle along the beach edge (outside the
  posts); palm fronds sway; Biscuit hops and preens between calls.
- **Pinecone Huddle** (pine grove): the pine ring and the front row become clustered pines of mixed height with snowy undergrowth; light
  snowfall; snow puffs drop from swaying branches now and then (clearly not the game's falling cones: different look, never over a
  stump); a hare or a bird peeking from the trees; frosty breath puffs from the players and Myodette.

**Fix before 82c — Driftwood Cast: press to hook again (user playtest, 2026-10-22; 0.82.2).** The 81a playtest follow-up made the cast
automatic but went too far: it also made the HOOK automatic (the hook lands wherever the marker is when the line goes out, and the nearest
find within `hookR` is hooked), so the only skill left is mashing. The user wants the game as it was before that follow-up, minus ONE
press: only the press that CASTS the rod is gone. So:
- The line goes out by itself whenever it is not out (as now: `firstCast`, then after a catch / a miss), and the bobber rests in the water.
- The aim marker sweeps up and down the lane as before (`markerDepth(t)`), and the player PRESSES Interact to strike: the press is stamped
  and judged on the host exactly like the old `judgeCast` (the hook lands at the marker's depth at the press time; the nearest unhooked
  find within `hookR` of `itemPose` at that moment is hooked; drawn = judged). A strike that hooks nothing splashes and the line resets
  after a short wait, then the player can strike again (no automatic hook, ever).
- Once hooked, the player mashes Interact to reel it in (`need` per kind), a hooked find never escapes, the catch is scored.
- Bots go back to timing their strike (the old look-ahead for the marker crossing a find, `skill.noise` timing error, skipping boots
  unless fooled) and then mash at `PARTY.bots[d].reel`. Retune `need` (doubled in the follow-up for mash-only play) and the bots so the
  scripted kid wins about 70% vs 3 easy bots and loses most vs hard, in about 50 s of play. Keep the water effects, the bigger finds,
  the facing and the label placement from the follow-up. How-to text along the lines of 'Press as the ring passes a find to hook it,
  then mash to reel!'.
- Tests: strike timing judged against the drawn marker / finds, a miss resets and allows another strike, no automatic hook ever happens,
  bots strike and reel, win rates, host + replica hashes. Also make the flaky 'the bots reeled in treasure' runtime check robust (it
  failed once with a bot at 2 points).

**Open from the 82b browser review (round 3, 2026-10-22), to look at with the user:** Timber Trim's front swung back to nearly bare
grass; Pinecone Huddle is clean but empty, and the bright radial glare in the middle of the frame is back. Marlo Says and Vine Skip look
good.

**82c — Sizzle Seed, Egg Scramble, Feast-Go-Round, Puffball Bumpers**
- **Sizzle Seed** (campfire clearing): the benches stay where they are (they are colliders), but the clearing's edge gets clustered trees
  and bushes instead of a ring; campfire smoke and floating embers; a warm flicker on the ground near the fire (emissive, no light);
  swaying grass and wildflowers round the clearing; a few butterflies.
- **Egg Scramble** (critter camp): the pine arc and snow mounds become clustered and layered; light snowfall; grouse idle variety
  (preening, ruffling, a feather drifting down when one hops); critter dens with a peeking fox or rabbit; feathers puff on a catch.
- **Feast-Go-Round** (bamboo flume): the straight row of 16 bamboo stalks becomes clumps of bamboo of different heights that sway; the
  hot spring's ring of stones becomes an irregular rocky rim; the spring and the flume get moving water (the flume visibly flows in the
  current direction and reverses with it); steam curls off the spring; flowers and ferns round the edge; Son Chaetty naps between dishes.
- **Puffball Bumpers** (titan cap over the marsh): the golden-angle mushroom spiral becomes clustered groves of mixed giant and small
  mushrooms; the marsh gets moving water with glints, lily pads and reeds that sway; layered mist drifting at different heights;
  fireflies; the cap's rim pores pulse gently (they already dim from 30 s; the pulse must not hide that signal).

**82d — Glowcap Shuffle, Driftwood Cast, Tilty Tiles, Bonk Burrows**
- **Glowcap Shuffle** (lagoon): the dark flat lagoon becomes moving water with glowing reflections of the caps and soft ripples where
  caps sink and rise; shore mushrooms in clusters instead of arcs; drifting spores, fireflies and low mist; Tzukumi's stump gets moss and
  little glowing mushrooms. Caps stay still (they are judged).
- **Driftwood Cast** (sunset jetty): already the liveliest stage; add a shimmering sun path on the water, gulls overhead, waves lapping
  the jetty posts, swaying palms in groups instead of three fixed ones, a distant sail boat drifting across, and Yu Bbui Bbui posing and
  cheering.
- **Tilty Tiles** (picnic lawn; audited in the browser 2026-10-22): today the four frames sit on one big flat bright-green lawn with
  evenly sprinkled flower dots and a single row of identical round trees along the top. Make it a real picnic spot: clustered trees and
  bushes with depth (no row), a picnic blanket and basket, bunting strung between two trees, swaying grass tufts and wildflower clumps
  in the open lawn (never under a frame), butterflies, petals drifting, cloud shadows passing over the frames, and Park Zyoni sitting
  and cheering with little reactions when a picture is finished. The frames themselves get a little wear: wood grain, corner brackets
  catching the light as they tip. Nothing may cover a frame or a coconut from the camera.
- **Bonk Burrows** (molehill meadow; audited in the browser 2026-10-22): the meadow is a perfect circle inside a perfectly round flat
  stream, with evenly sprinkled flower dots, a straight line of grey stepping stones and a row of identical trees along the top. Make it
  organic: an irregular meadow edge and stream bank, moving stream water with glints and a gentle current, stepping stones in a natural
  wobbly path, clustered trees and reeds that sway, clumps of clover and daisies instead of an even sprinkle, molehill soil that crumbles
  and puffs a little dust when the mallet lands nearby, a mole or two peeking from the molehills between slams (cosmetic, never on a
  judged spot), dragonflies over the stream, and Cobble cheering from the bridge. The mallet shadows must stay the clearest thing on
  screen.

**Tests:** `test/partyScatter.test.js` (determinism, keep-out shapes respected, clustering and density, layers), a camera test per stage
(no decoration covers a gameplay point at 16:9, 9:16 and 19.5:9), unchanged game rules and hashes for every game (the existing party
tests must pass untouched), the life pool's caps, and the draw-call / program budget per stage. Browser: before / after screenshots of
every stage at 16:9 (and one portrait phone shot each), day and night where a stage has both, no console errors.

**Hand-off.** One agent per substep, in order (82a builds the kit the others use). Read first: this section, the Step 80 / 81 sections,
the 80a-81b paragraphs at the top of CLAUDE.md, `world/party/*.js`, `game/party.js` (the hidden ambient layers, stage lifecycle),
`world/wind.js`, `world/props.js` (how the islands sway), `water.js` (`waterUniforms`, ribbons), `fx/ambient.js`, `fx/particles.js`,
and each biome's cached island assets (`world/islands/frostAssets.js`, `emberAssets.js`, `duskAssets.js`, home's `world/props.js`).
82a = 0.82.0, 82b = 0.82.1, the Driftwood Cast hook fix = 0.82.2, 82c = 0.82.3, 82d = 0.82.4. Update README + CLAUDE.md; say what was and was not verified.


## Progress

## Step 82: Party Glade living pass — every stage alive and organic

- [x] Step 82a — Living kit (seeded organic scatter, party decor kit, shared wind sway, ambient life pool, stage water) + the lobby (0.82.0)
- [x] Step 82b — Vine Skip, Timber Trim, Marlo Says, Pinecone Huddle (0.82.1)
- [x] Driftwood Cast: press to hook again, only the cast is automatic (fix before 82c, 0.82.2)
- [x] Step 82c — Sizzle Seed, Egg Scramble, Feast-Go-Round, Puffball Bumpers (0.82.3, done). **Built as specified, via `world/party/living82c.js` (per-stage specs on top of `livingStage.js`):** composed side groves / back tree lines / wildflower clumps, campfire embers + smoke + a warm unlit ground flicker, Dub's gaze; snowy wood, packed-snow apron, two dens with peeking fox / rabbit, a feather pool (laying grouse, catches), grouse preen / ruffle; bamboo clumps, ferns, hibiscus, a rocky-rim hot spring with steam, a flume on its own signed clock + foam flecks (flows with the current, reverses with it), Chaetty's nap; Bumpers' lowered marsh (moving water, lily pads, islets, reeds, mushroom groves, mist, fireflies, fish), a +-4 % rim pulse and Capray's roll. Stages stay cached; only their living scenery is built on show / freed on hide. Budgets and tests recorded in CLAUDE.md (1327 tests / 108 files); not verified: portrait / animation by eye, audio, two-screen run.
- [x] Step 82d — Glowcap Shuffle, Driftwood Cast, Tilty Tiles, Bonk Burrows (0.82.4, done). Built via `world/party/living82d.js` (four SPECS registered into living82c's): Glowcap lagoon + ripples + islets, Cast sea / sun path / waves / foam / gulls / boat / palms, Tilty picnic lawn + bunting + frame wear, Bonk irregular meadow + moving stream + moles + crumbs. Not done: cloud shadows over the frames and Zyoni's sit pose (readability / scope). 1371 tests / 109 files pass.
