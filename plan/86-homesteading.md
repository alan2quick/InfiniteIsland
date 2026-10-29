# Step 86: Homesteading (the customisable home island)

Once the player unlocks Homesteading, they can rearrange the home island's gathering spots. They can chop a tree down for good, break a
rock for good, and plant a birch or a breadfruit tree where there was nothing. Everything stays within a budget, so the island never
gets crowded. Later phases do the same for decorations and grow the island itself. The index of every step is [PLAN.md](../PLAN.md).

> **Status: Step 86 DONE (0.86.0, 2026-10-28); Steps 87 and 88 are later phases.** Originally: **SPEC (2026-10-28).** The user answered the first round of questions and picked budget model B (size points). The smaller
> open questions at the end can be settled during 86a–86d.

## Spec

**Brief (user, 2026-10-28):**
- An extensive feature: an expanding, customisable home island. Everything interactable on it can be customised: trees, rocks, dig spots,
  flowers and so on.
- **Unlock:** find all the home island's Journal items (the 6 home entries in `game/collection.js`), then speak to Im Nabong. After
  that, the mode is entered from the home campfire.
- **In the mode,** the special button changes the island's arrangement. This is the combat Charm button: R / pad X; outside combat it is
  currently a second Jump.
  - Walking up to a tree with an axe and pressing it chops the tree down **permanently**. It never grows back, and the layout is saved in
    the game file.
  - Pressing it with **no target** places an object in the empty space, with a preview. The object can be any harvestable thing.
- **Budget:** the total amount of interactables on the home island stays the same as today. To plant a tree, something else must go
  first.
- **Native protection:** the last instance of a native home kind can never be removed, so cherries, mushrooms, apples, herbs and so on
  can never vanish from the game.
- **Costs:** placing something costs the materials related to it.

**Decisions (user, 2026-10-28, first round of answers):**
1. **Name: Homesteading.** Nabong's reward is the **watering can**. It joins the tool rack at the **home campfire only**, because it has
   no use in the other zones yet.
   - **Placed trees grow in stages:** planted as a **sprout** → watered once → **sapling** → watered again → the **full tree**. The full
     tree behaves exactly like a native one.
   - Each growth stage needs a **satisfying** animation / effect **and a sound effect**.
   - Every other gatherable (rocks, bushes, herbs, mushrooms, flowers, dig spots) is placed fully grown and can be used right away.
2. The 20 interactable home **flowers are part of this plan.**
3. **Budget: model B, size points** (user's pick from the five options, 2026-10-28). Trees and palms cost 3 points (sprouts and
   saplings included), rocks and bushes 2, and herbs, mushrooms and dig spots 1. Flowers are not in this budget (see 10).
4. **Removing** gives exactly what fully harvesting that thing in the world gives, nothing more. **There is no moving** an object.
   - **Placing costs about 5× the yield of one harvest of it.** For example, an herb gives 1 mint, so planting one costs 5 mint.
5. **Every harvestable kind from every island is placeable, rocks included.** ~~A kind unlocks once the bag holds enough
   materials to place it.~~ Superseded by decision 13 (a kind is unlocked with its island).
   - A snowy dig spot digs truffles, and so on: a placed thing gives its own island's loot.
   - Models may need tweaks so each kind is easy to recognise at home (snowy versus home dig spots, mint versus herb, granite versus a home
     rock).
6. **A dig spot placed by hand is a fixed patch**, like a garden bed: it re-fills where it was placed and does not wander.
7. **Expanding is a later phase.** The island grows to the **south and south-east**, where there are no bridges today, and the
   **budget grows** with it (Step 88 below).
8. **Only the host can Homestead.** Online guests can't; see "Who can Homestead".
9. **Every permanent removal asks for confirmation.** There is no undo and no "restore the original island" for now.

**Decisions (user, 2026-10-28, second round of answers):**
10. **Flowers are decorations.** They have their **own, separate decoration budget** and **cost nothing** to place.
    - The decoration list also takes Duskcrown's decorative mushrooms (or a comparable small mushroom made for it).
    - It also takes **other decorative items that make sense from every island** (see "Decorations").
11. **Plain bushes cost nothing,** but they still count against the main budget (2 points).
12. **Watering grows a tree right away:** two waterings, no waiting.
13. **Each island's kinds become available once that island is unlocked.** Home kinds are available from the start.
    - This replaces "unlocks once the bag can afford it" in 5.
14. **"The host" means every player playing on the host's screen.** Online guests can't Homestead.
15. **A kind stays in the menu for good once it is unlocked.**

### What the home island has today (from the code, 2026-10-28)

Everything is placed by seeded rejection sampling in `world/props.js createProps` and registered once with `interactables.js` /
`colliders.js`. Harvest refers to things by interactable id and gathering by list index (home first, then Frostpine, then Duskcrown's
crumbs).

| Kind | Interactable `type` | Count | Harvest today |
|---|---|---|---|
| Green tree (apples / peaches) | `tree` | 35 trees in total, green and cherry mixed | shake, chop (axe), regrows |
| Cherry-blossom tree (cherries) | `tree` (`userData.cherry`) | (part of the 35) | shake, chop |
| Palm (coconuts) | `palm` | about 25 (measure) | shake, chop |
| Rock / boulder (stone, Spiral Fossil) | `rock` | 4 + 4 + 12 | break (hammer / pick), re-emerges |
| Berry bush | `bush` (`userData.berries`) | 7 of the bushes | rustle: berry pickups |
| Plain bush | `bush` | the rest of the bushes | rustle only |
| Herb | `herb` (instanced) | 12 | pick: +1 Herb |
| Mushroom cluster | `mushroom` (instanced) | 3 | pick: +1–2 Mushroom |
| Dig spot | `digspot` | 6, wandering (a new one appears at a random spot 40 s after one is dug) | dig (shovel): potatoes, Sand Dollar |
| Interactable flower | `flower` (instanced) | 20 of the instanced flowers | smell |
| Signpost, fallen log, campfire, hat rack, tool rack, pet stable, Carle's sapling, bridge stubs, NPCs | various | — | **never editable** |

The counts are a snapshot. 86a measures the real numbers and fixes the budget from them.

## Design

**Unlock (86b).**
- The gate is `collection.progress('home').complete` (all 6 home Journal entries) **and** talking to Nabong.
- Nabong's new dialog branch:
  - She is first to come running, with her cloud pouch of snacks (see the personalities in [plan/64-66-tdoongz.md](64-66-tdoongz.md)).
  - She sees the full album, beams that the island "could be even cosier with things we plant ourselves", and hands over the watering
    can: a showcase pose like a Journal find, plus a toast.
  - The dialog then explains: "Pick **Homesteading** at the campfire."
- The unlock is saved in the `homestead` key of `infinite-island.home.v1` (`homeSave.set`), owned by a new synced `homestead` domain.
- The home fire menu gets a **"Homesteading"** row once the unlock is set. It shows only on the host's screen (see "Who can Homestead").

**The watering can on the home rack (86b).**
- Today `TOOL_RACK.kinds` is `axe, hammer, sword, shovel, rod`, and the rack copies' reserved item ids are computed from
  `fire × 4 slots × 5 kinds` (`toolRackLogic.js`). Adding a sixth kind would shift every id.
- So the watering can is an **extra, home-only rack kind**, with 4 more reserved ids (one per slot) appended AFTER the existing 80 and
  before the dynamic records. The existing ids must not change; test this.
  - It joins the home rack's cycle at the end (after the rod), only once Homesteading is unlocked.
  - Its peg on the rack model appears then, with a pop-in.
- **Anyone** can take and use it: watering is not Homesteading, so online guests can water too.
- The watering can keeps its Step 60 combat role inside the combat areas, unchanged.

**Who can Homestead.**
- **Every player on the host's screen can Homestead** (decision 14): keyboard, gamepads and phones paired to the host.
  - Online guests' screens never show the menu row or the mode, and the host rejects their `homestead` requests.
- The mode is per player: each local player who picks the row is in it, and the others keep playing normally.

**The mode (86c).**
- It starts from the home fire menu ("Homesteading") and ends with "Done" on the fire menu, by leaving the home island, or with a
  "Leave Homesteading?" prompt on Cancel.
- While in the mode:
  - A comic-style HUD badge ("Homesteading" plus a house-and-leaf icon from `ui/icons.js`) and the budget meter show.
  - The Charm button (keyboard R, pad X, the touch Charm button) is routed to **Shape** instead of a second Jump
    (`actionsWithCharmRouting` gets a third case). Jump stays on Space / pad Y.
  - The normal Interact still works (shake, chop with regrowth, ...), so the mode never blocks play.
  - The target prompt bubble shows a second line for the Shape action, e.g. "R: Remove for good".
- On other islands the mode does not exist.

**Removing (Shape on a target, 86c).** It needs the right tool, using the same tool rules as today (`getToolAction`):

| Kind | Tool | Prompt | Drops (= one full harvest in the world) |
|---|---|---|---|
| Trees, palms (also sprouts / saplings) | axe | "Chop down for good" | the normal fell drops (logs + fruit); a sprout / sapling drops nothing |
| Rocks | hammer | "Break for good" | the normal break drops (stone, rare extras by tool) |
| Bushes | shovel | "Dig up for good" | its rustle drops if it is full (berries), else nothing |
| Herbs, mushrooms | shovel | "Dig up for good" | one pick's worth (1 herb / 1–2 mushrooms) if it is grown |
| Flowers and other decorations | shovel | "Dig up" | nothing (decorations are free; see "Decorations") |
| Dig spots (native or placed) | shovel | "Fill in for good" | one dig's worth if it is not dug |

- **Every removal asks for confirmation:** a dialog such as "Chop this cherry tree down for good? It won't grow back." with Yes / No.
  The removal starts only after Yes.
- It plays the normal fell / break / dig animation, then a pop-out poof (`world/popIn.js`). The spot then stays empty for good.
- **The last-native guard:** a kind counts as native if the home island has it today: apple tree, cherry tree, palm, home rock, berry
  bush, plain bush, herb, mushroom and home dig spot. Decorations have no guard: they are free to put back.
  - Removing the **last standing one** of a native kind is refused, counting natives AND placed copies of that kind. A line explains
    it: "That's the island's last cherry tree!"
  - Foreign kinds can be removed down to zero.

**Placing (Shape with no target, 86d).**
- A palette opens: a comic-style list or radial with inline-SVG icons, the cost and the budget weight of each kind.
  - It has two tabs: **Gathering** (the main budget) and **Decorations** (the decoration budget).
- **Which kinds are listed** (decisions 13 and 15):
  - Home kinds are listed from the unlock.
  - Each other island's kinds join the list **once that island is unlocked**, with a toast: "New for your homestead: Frostpine
    plants!"
  - "Unlocked" is the same flag the game already uses for reaching that island: Frostpine / Emberleaf by their bridges, Duskcrown by
    `boat.discovered`, the Crownlands by its own reveal. 86a names the exact flag for each island.
  - A listed kind **stays listed for good.** It is greyed out, with the reason, when the bag or the budget can't cover it right now.
- Picking a kind shows a **ghost preview** about 2 u in front of the player that moves with them: translucent toon material, green
  when valid, red with a short reason when not.
  - Reasons: water, cliff or steep slope, the wrong ground (e.g. a palm needs sand, a tree needs grass; see the kind table), too close
    to a collider / path / another interactable, inside a fire's `clear` ring, or in a reserved area (ritual annex, Rootgate, bridge
    stubs, pet stable, Carle's sapling, tool / hat racks).
- Shape places it. Cancel backs out to the palette. The rotation is random (seeded by the host).
- The host checks everything again (budget, cost, spot), takes the materials from the shared bag, and broadcasts. Every screen pops the
  object in: a dirt puff and a sound.
- **Trees and palms are planted as a sprout** (see Growth). Everything else arrives fully grown and works at once.
- A grown placed object is a **full citizen**: it shakes, chops (regrowing in normal play), drops ITS island's loot (`lootTable.js
  LOOT[variant]` / `DIG[island]`) and rolls the home Journal finds like a native.

**Growth (trees and palms, 86d; the polish in 86f).**
- The stages are `sprout` → `sapling` → `grown`. Each watering moves a tree one stage up. The watering can's Interact on a sprout or
  sapling is a new tool action, `water`, and its prompt is "Water".
  - Without the can, the prompt is "Needs water" and a toast says so.
- **Growth is instant** (decision 12): each watering grows the next stage straight away, with no waiting.
  - A short lock of about 1.5 s, while the growth effect plays, stops one held press from growing two stages.
- **The effect is the payoff:**
  - A splash arc of water droplets from the can.
  - A short squash-and-stretch "boing" as the model swaps to the next stage, scaled with an ease-out-back overshoot (like `popIn`).
  - A burst of leaf and sparkle particles and a soft green ring on the ground.
  - The full tree gets a bigger version of all of this: a camera nudge for whoever watered it, falling petals or needles to match the
    species, and a rising three-note chime.
- **Sounds:**
  - A water pour (filtered noise).
  - Growth chimes: sprout → sapling is a bright two-note pluck; sapling → tree is a three-note rising chime plus a leafy rustle.
  - They are built in the existing procedural `sfx` style. Verify them structurally (node graph, gains, offline render): an agent
    can't hear them.
- Sprouts and saplings are interactables (`sprout` type, with "Water" and in the mode "Dig up for good") and count against the budget
  from the moment they are planted. They can't be shaken or chopped for loot.
- Models:
  - The **sprout** is one shared tiny two-leaf model, tinted by species.
  - The **sapling** is the species' own model at about 0.45 scale, or the existing regrow sapling where there is one (`harvest.js`
    already grows saplings back).
  - The stage is saved and synced.

**Kinds and costs (86d home kinds, 86e every other island's).**
- The rule: **cost ≈ 5× one harvest's yield** of its signature item, plus logs for trees (5× a fell is about 12 logs, which is too much,
  so trees use 5 fruit + 4 logs).
- All numbers live in `config.js HOMESTEAD.kinds` to tune. 86a / 86e inventory every island's harvestable kinds from the code and fill
  the table. First pass:

| Kind | Island | Cost | Ground | Grows? |
|---|---|---|---|---|
| Apple tree | home | 5 Apples + 4 Logs | grass | yes |
| Peach tree | home | 5 Peaches + 4 Logs | grass | yes |
| Cherry tree | home | 5 Cherries + 4 Logs | grass | yes |
| Coconut palm | home | 5 Coconuts + 3 Logs | sand / grass | yes |
| Rock | home | 8 Stone | any dry | no |
| Berry bush | home | 12 Berries (5× 2–3) | grass | no |
| Plain bush | home | free (2 budget points) | grass | no |
| Herb | home | 5 Herbs | grass | no |
| Mushroom cluster | home | 8 Mushrooms (5× 1–2) | grass / shade | no |
| Dig spot (patch) | home | 8 Potatoes (5× 1–2) | grass / sand | no |
| Spruce / pine | Frostpine | 5 Pinecones + 4 Pine Logs | grass | yes |
| Birch | Frostpine | 10 Birch Logs (5× 2) | grass | yes |
| Lingonberry bush | Frostpine | 15 Lingonberries (5× 3–4) | grass | no |
| Mountain mint | Frostpine | 5 Mountain Mint | grass | no |
| Chanterelles | Frostpine | 8 Chanterelles | grass / shade | no |
| Snowy dig spot (digs truffles) | Frostpine | 8 Snow Truffles | any | no |
| Granite rock | Frostpine | 8 Stone + 1 Crystal | any dry | no |
| Banana tree | Emberleaf | 15 Bananas (5× 3) | grass | yes |
| Breadfruit tree | Emberleaf | 5 Breadfruit + 4 Breadfruit Logs | grass | yes |
| Jungle tree | Emberleaf | 16 Logs (5× 3–4) | grass | yes |
| Bamboo | Emberleaf | 12 Bamboo (5× 2–3) | grass | yes |
| Basalt rock | Emberleaf | 8 Ash + 1 Obsidian | any dry | no |
| Taro dig spot | Emberleaf | 8 Taro | any | no |
| Glowcap clump | Duskcrown | 8 Glowcap Crumbs | grass / shade | no |
| Acacia / baobab (if choppable) | Crownlands | from their loot, 86e | grass | yes |

- **Recognisable at home** (86e): each foreign kind keeps its home island's look, with tweaks where two kinds would be confused:
  - The snowy dig spot is a white mound with a few ice glints and keeps a little snow ring around it on grass.
  - The taro spot is a dark volcanic mound.
  - Mint is the paler, rounder leaf.
  - Granite is a grey-blue speckled rock, basalt a dark one with an orange crack.
  - The prompt names the kind: "Dig (snowy spot)".

**The budget (model B: size points).**
- Weights (`HOMESTEAD.weights` in config):
  - Trees, palms and bamboo: **3**. A sprout or sapling already weighs 3, so the room is reserved when it is planted.
  - Rocks and bushes (berry, plain, lingonberry): **2**.
  - Herbs, mushrooms, glowcap clumps and dig spots: **1**.
- `HOMESTEAD.budget` = the measured native total **in points** at 86a, fixed in config. It is never computed at runtime, so a content
  change can't silently change saves.
  - A rough guess from today's counts: about 60 trees and palms ×3, plus about 40 rocks and bushes ×2, plus 41 small things ×1, which
    is about 300 points.
- **Used** = the natives still standing + every placed object (sprouts included), each times its weight.
- The palette shows each kind's weight as leaf pips. A kind that doesn't fit the free points is greyed out with the reason ("Needs 3
  free spots, you have 1: remove something first").
- Temporary harvest states (felled and regrowing, dug, picked) still count. Only a permanent removal frees budget.
- The HUD meter shows `used / budget` (e.g. a row of leaf pips, or "84 / 112").
- Step 88 raises the budget when the island grows. Raising it never invalidates a save.

**Decorations (decisions 10 and 13; 86d for home, 86e for the other islands).**
- **Decorations are free** and sit under their **own budget**, `HOMESTEAD.decoBudget`. It is a count, every decoration is 1.
  - Proposed: the 20 native interactable flowers, plus a starting allowance of about 40. Until Step 87 the island's other native
    decorations can't be removed, so placing needs room of its own.
  - Tune it in config. Step 88 raises it with the island.
- **The native interactable flowers** can be dug up (no confirm needed: nothing is lost), which frees their room. There is no
  last-native guard. A removed flower's instance is hidden for good.
- **Placed decorations** are small interactables, like the flowers today: "Smell" or "Boing" (Frostpine's flowers boing). In the mode
  they show "Dig up". They don't collide.
- **Draw cost:** each decoration kind is ONE instanced layer on the home island, sharing its island's existing geometry and program.
  - A whole decoration list in use adds about one draw call per kind in use.
  - Measure it in 86e, and cap the number of kinds per tab if it gets close to the budget.
- **The decoration list** (first pass from the islands' current props; 86e checks each against its asset builder and picks the ones
  that read well at home):

| Decoration | Island | From | Ground |
|---|---|---|---|
| Flower, each of the 4 home colours | home | `props.js` flowers | grass |
| Lily pad | home | `props.js` pond lilies | pond water only |
| Reed clump | home | `props.js` reeds | shore / water edge |
| Edelweiss | Frostpine | `frostAssets` `edelweiss` | grass |
| Gentian | Frostpine | `frostAssets` `gentian` | grass |
| Heather tuft | Frostpine | `frostAssets` `tuft` | grass |
| Ice spire (small) | Frostpine | `frostAssets` `spire`, scaled down | any dry |
| Snowman (3 scarf colours) | Frostpine | `snowman0..2` (decorative only, NOT the breakable one) | any dry |
| Hibiscus | Emberleaf | ember placement `hibiscus` | grass |
| Plumeria | Emberleaf | ember placement `plumeria` | grass |
| Fern | Emberleaf | ember placement `fern` | grass / shade |
| Tiki torch (unlit) or tiki statue | Emberleaf | ember placement `tiki` | any dry |
| **Small glowing mushrooms** | Duskcrown | `duskSmallAssets` `mushroom` | grass / shade |
| Glow bulbs | Duskcrown | `duskSmallAssets` `bulb` | grass / shade |
| Moss mound | Duskcrown | `duskSmallAssets` `moss` | any dry |
| Marsh flower | Duskcrown | `duskSmallAssets` `flower` | grass |
| Crownlands plants | Crownlands | 86e looks for a fitting small prop (e.g. a savanna grass clump); if none fits, skip it | grass |

- The Duskcrown mushrooms glow with their island's emissive program. At home they should glow softly only at night (like the
  campfire night factor), so the home island isn't neon in daytime. 86e checks how that looks.
- If the marsh mushrooms don't read well at home size, make a comparable small "glowcap sprout" decoration from the same program.
- Big or solid props (logs, stumps, the canoe, the giant mushrooms) are not decorations here: they need colliders and belong to
  Step 87.

**Saving and sync (`homestead` domain).**
- It is host-authoritative. Only the host's own players may act (see "Who can Homestead").
- Requests: `remove {id}`, `place {kind, x, z}`, `water {pid}`. Watering may come from any screen, so the host range-checks it and
  checks the can.
- Events: `removed {id}`, `placed {pid, kind, x, z, rot, stage}`, `grew {pid, stage}`, `unlocked`.
- The snapshot is `{unlocked, removed: [nativeId...], placed: [{pid, kind, x, z, rot, stage}], nextPid}`, with a `hashView` of the
  same.
  - Removed native flowers are in `removed`, and decorations are in `placed`. Each kind's table entry says which budget it uses.
- The palette needs no state of its own. Its list comes from the islands' existing unlock flags, which are already synced and saved
  and never turn off again.
- It is saved under the `homestead` key of `infinite-island.home.v1`. Add a row to the docs/ARCHITECTURE.md persistence table. Replicas
  never save.
- **Id stability (the main technical risk).** Harvest uses interactable ids, gathering uses list indices (home first, then Frostpine,
  then Duskcrown's crumbs), and the tool racks use reserved item ids. None of these may shift, or Frostpine's ids, saves and the seeded
  hash pins break. So:
  - A removed native is never taken out of the lists. It becomes a permanent tombstone that harvest / gathering skip and never regrow
    or re-show. Its id stays reserved.
  - `createProps` and every island's seeded placement run unchanged, and the layout is applied on top after load.
  - Placed objects get their own appended id range (`pid`, a host counter), registered after every island. In gathering they use
    keyed ids (`p<pid>`), not indices. 86a picks the exact scheme and pins it with a test.
- **Dig spots.** The native home spots keep wandering, as today. Removing a native lowers the number that wander, but never below one.
  A **placed** spot is a fixed patch: after it is dug it re-fills **in place** after the usual delay, like a garden bed.

**Rendering.**
- Home trees / palms / rocks / bushes are individual merged meshes (mesh + outline each). Placed home kinds reuse those shared
  geometries / tint materials (`getHomeAsset(kind)`).
- Foreign kinds reuse their islands' asset builders (`frostAssets.js`, `emberAssets.js`, `duskSmallAssets.js`, `crownTreeAssets.js`) in
  ONE instanced layer per kind on the home island, rebuilt only when the layout or a growth stage changes. Sprouts are one shared
  instanced layer.
- Because the budget caps the total, measure the draw calls and triangles with an island of all foreign kinds in 86e. Stay within about
  200 draw calls at gameplay view. Characters and hats write stencil; world props don't need to.
- The far-view canopy blobs (`homeFarBlobs`) include placed grown trees and skip removed ones (rebuilt on change).

## Progress

- [x] Step 86a — The layout layer, with no UI. **Done (0.85.12):** budget 240 points / deco 60, the `homestead` domain, tombstones, placed home kinds, `__game.homestead`, 15 new tests (1613 pass). Write-up in the CHANGELOG. For 86d: add a spawn / camera-lane / path keep-clear rule to `spotCheck`, and the far canopy blobs.
  - Measure the native counts. Inventory every island's harvestable kinds into `HOMESTEAD.kinds` (cost, ground, grows, loot source).
  - Fix `HOMESTEAD.weights` (model B) and `HOMESTEAD.budget` (the measured native total in points).
  - The `homestead` domain: tombstones for removed natives, an appended `pid` range that harvest / gathering / interactables respect,
    the save in `infinite-island.home.v1`, the last-native guard.
  - `__game.homestead` debug calls: `remove(id)`, `place(kind, x, z)`, `water(pid)`, `summary()`, `budget()`.
  - Node tests: every existing id / rack id / hash pin is unchanged, the guard, the budget, a snapshot round trip, and a reload keeps
    the layout.
- [x] Step 86b — The unlock and the watering can. **Done (0.85.13):** Nabong's "I found everything!" scene, the home-only can as 4 appended rack ids (84 in total), the "Homesteading" fire-menu row and the `setMode` / `inMode` API. 9 new tests (1622 pass). Write-up in the CHANGELOG.
  - The home album complete → Nabong's dialog branch → the watering can showcase.
  - The watering can as a home-only rack kind with 4 appended reserved ids.
  - The "Homesteading" fire menu row on the host's screen.
  - `?homestead` (debug: unlocked) and `?testhomestead` (album one find short).
- [x] Step 86c — The mode and removing. **Done (0.85.14):** the per-player mode, the badge, Shape on R / pad X, permanent removal with confirm, the normal drops and the last-native guard. 9 new tests (1631 pass). For 86d: the Shape prompt line floats too far above tall targets' bubbles. Write-up in the CHANGELOG.
  - The per-player mode on the host's screen, the HUD badge and the budget meter.
  - The Charm button routed to Shape (R, pad X, touch).
  - Permanent removal with the right tool: a confirm dialog, the normal drops, a poof.
  - The last-native guard lines.
  - Guests are refused.
- [x] Step 86d — Placing and growth (home kinds). **Done (0.85.15):** the palette (Gathering / Decorations), the ghost preview, the spawn / campfire keep-clear, costs from the bag, sprout → sapling → tree with the can (FX + sounds), the home decorations, the far-view blobs and the `line2` fix. 19 new tests (1650 pass). The tree ghost was then changed to sprout + canopy ring (main session). Write-up in the CHANGELOG.
  - The palette (both tabs; home kinds), the ghost preview with reasons, host validation, the cost from the shared bag, the
    pop-in.
  - Sprout → sapling → tree with the watering can, saved and synced.
  - Placed dig spots are fixed patches.
  - Grown placed objects behave like natives.
  - Home decorations: the 4 flower colours, lily pads and reeds; digging up native flowers; the decoration budget.
- [x] Step 86e — Every other island's kinds. **Done (0.85.16):** 30 Frostpine / Emberleaf / Duskcrown kinds and decorations, listed by bridge / boat unlocks, own-island loot, the night glow, `foreignKindCap` 12; measured +30 draw calls for 12 plantings. 15 new tests (1665 pass). For 86f: basalt too dark, the glow mushroom too dim, a cap per budget. Write-up in the CHANGELOG.
  - Frostpine, Emberleaf, Duskcrown and the Crownlands' harvestables as instanced home layers with their own loot, each listed once
    its island is unlocked.
  - Their decorations (the decoration table), including Duskcrown's small glowing mushrooms with a night-only glow at home.
  - Model tweaks so each one reads clearly at home.
  - Measure the draw calls / triangles with a fully foreign island.
- [x] Step 86f — Polish and playtest. **Done (0.86.0):** home basalt recoloured, glowcap sprouts that glow at night, `foreignKindCap` per budget (6 / 8), one-line scrolling palette rows, a shorter entry toast, gentler sounds + a `poof`, Nabong's rotating tips, full README / ARCHITECTURE. 5 new tests (1670 pass). Left: the entry toast is still clipped by the clock (general toast placement). Write-up in the CHANGELOG.
- [ ] Step 87 (later) — Native decorations: removing and rearranging the NON-interactable instanced flowers, grass tufts and plain
  props (fallen log, stumps), plus solid decorations with colliders, with the same mode and the decoration budget.
- [ ] Step 88 (later) — Expansion: the home island grows to the **south and south-east** (no bridges there today) and the budget
  increases. The new land must be a terrain annex that leaves every existing height / ground sample unchanged (the golden terrain test),
  like the ritual annex. It needs a spec of its own: what triggers each growth, how big it is, and what is on the new land.

## Open questions for the user

None right now (all answered on 2026-10-28). Each sub-step lists what it still has to measure or tune.
