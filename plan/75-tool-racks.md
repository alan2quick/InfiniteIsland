# Step 75: Tool racks by the campfires

A tool rack appears next to each campfire after that fire's first feast. Players take tools from it and put them back, cycling through
them the way the hat rack cycles hats. The index of every step is [PLAN.md](../PLAN.md).

## Spec

**Decisions (user, 2026-10-26):**
- A rack appears close to each campfire once a feast there is completed.
- Interacting with it rotates the player through every tool available so far, like equipping cosmetics. The tools are the basic ones
  from the first three islands, plus the fishing rod once Duskcrown is unlocked.
- If the tool in hand came from the rack, it goes back into the rack when the player rotates. If it came from the overworld, the player
  drops it.
- Every player in multiplayer gets their own cycled set.
- A rack tool dropped in the overworld stays there for the game session, but the rack no longer hands out that tool. Each player can take
  each tool out once and drop it somewhere, but cannot go back to the rack for another copy.
- **Follow-up decisions (user, 2026-10-26):** every rack has its **own separate set** per player. The cycle has **no empty step**: once a
  player has used a rack, one tool from it is always out (in their hand or in the world). A **reload resets every rack tool**: nothing
  about rack tools is saved, not even one in a player's hand.

### Step 75 — the racks, the per-player tool sets and the cycle

**Where the racks stand.**
- There is one rack per fire in `FIRES`: home `home`, Frostpine `frost`, Emberleaf `ember` and the Duskcrown marsh hearth `dusk`.
- Each fire's rack stays absent until its first feast is done (`quests.slots[fireId].last` is set; the quests domain is synced, so every
  screen derives the same answer, like the hat rack derives its unlocks from `quests.feasts`).
- When it unlocks, it pops in live with `world/popIn.js` (a poof and a jingle). On a load or late join it is simply there. A replica
  waits for the host's snapshot before deciding.
- Placement is a pure, deterministic plan (`world/toolRackPlan.js`):
  - The spot is 4.5 to 6.5 u from the fire's centre, outside its `clear` ring.
  - It must be on walkable, dry, flat ground, clear of benches, the hat rack, the stump / garland stand, the pet stable, the Carle
    sapling, colliders, interactables and paths.
  - Use a fan of candidate angles, preferring the side that faces the follow camera (+Z), like `world/islands/homeCarle.js`.
  - Seeded placement elsewhere must not change. A test pins each spot against the real island data.
- The model is a chunky wooden wall rack, about 1.3 u wide and 1.2 u tall, with a pitched little roof and five pegs. It is merged and
  vertex-coloured with the `#2b2340` outline, about 3 to 5 draw calls including the tools on display.
- The tools shown on the pegs are small merged copies of `items/models.js` models (ONE mesh, rebuilt only when what is shown changes).
  The rod peg stays empty, with a little "?" carving, until Duskcrown is unlocked.
- One collider is registered once on unlock. One interactable has type `toolrack`. Like `hatrack`, it is a plain interact even with a
  tool in hand: add it to the plain-interact list in `items/tools.js` (`getToolAction` returns null for it).

**Which tools a rack offers.**
- The rack kinds, in cycle order (config `TOOL_RACK.kinds`), are: `axe`, `hammer`, `sword`, `shovel`, then `rod`.
- The rod is included once Duskcrown is unlocked (`boat.discovered`, the same gate as the marsh hearth's quests).
- Lightsabers, the slingshot and the watering can are never on a rack. They are special or combat-area weapons.
- Every rack offers the same kinds, wherever it stands.

**Per-player tool sets (the core rule).**
- Each player slot (P1..P4, the global slot table) owns ONE copy of each rack kind **at each rack**: separate sets, so the home rack's
  axe and the Frostpine rack's axe are different copies. A copy is in one of three places:
  - `rack`: in stock at its own rack.
  - `held`: in that player's hand.
  - `out`: lying in the overworld after being dropped or tossed.
- **The cycle** ("Take" / "Swap tool" on the rack; the label names what you will get, e.g. "Take Axe" or "Swap for Hammer"). There is
  **no empty step**: once a player has used a rack they always have one of its tools out (in hand or in the world).
  - **Empty hands:** take the first kind in cycle order whose copy (for this player, at this rack) is in `rack`.
  - **Holding your own copy from THIS rack:** it goes back to `rack`, and you take the next kind AFTER it in cycle order that is in
    `rack`. The order wraps from the last kind to the first. If no other kind is in stock (all the others are out in the world), you keep
    the tool you hold, nothing changes, and a short line says: "Your other tools from this rack are out in the world!"
  - **Holding anything else** (a ground pickup, a lightsaber, a copy from ANOTHER rack, or another player's rack copy): it is **dropped
    at your feet** (the normal toss, `items.dropFor` style), and you take the first kind in stock. A dropped copy from another rack
    becomes `out` for that rack and its owner.
  - **Nothing in stock** (every copy from this rack is out): the drop still happens if you held something. The line says: "Your tools
    from this rack are all out in the world!"
- **A copy that leaves the rack system:** if a player holding their rack copy swaps it for a ground tool, the normal Animal Crossing
  swap tosses the copy onto the ground. If they leave, or the game drops it, the copy becomes `out`. It is a normal ground item that
  anyone can pick up and use.
- **Bringing a copy back:**
  - If the OWNER picks up their `out` copy and uses ITS OWN rack while holding it, it is "holding your own copy from this rack": it
    goes back and the cycle moves on.
  - At any other rack, or in another player's hands, it counts as "anything else": it is dropped at their feet and stays `out`.
- **The session rule (no saves):** rack copies are **never saved**. `out` copies lie in the world until the page reloads. A reload
  (host) resets every copy to `rack`, including one in a player's hand:
  - `game/playerMemory.js rememberedTool` must NOT remember a rack copy, so the player wakes up empty-handed.
  - Overworld tools keep being remembered exactly as today.
- Solo play: P1 simply has one copy of each tool at each rack.

**Sync (host-authoritative, inside the `items` domain).**
- Rack copies are item records with **reserved stable ids** after the existing fixed ones: 4 racks x 4 slots x 5 kinds = 80 ids, before
  the dynamic records (lightsabers and ethereal tools). This keeps every id stable across screens. Make the records lazily (a copy gets a
  mesh only when it first leaves its rack) so 80 reserved ids cost nothing up front.
- Each record carries `rack: { fire, owner: slotIndex, kind }`.
- A record in `rack` state has no mesh in the world, no interactable and no collider. It is shown only as the peg display.
- A new request `rack {fire}`: the host validates that the rack exists (that fire has feasted), the actor is within reach (remote slack
  like Capray's), and the actor is not locked. It then decides the whole swap: return, drop or take.
- One event `rack {actor, fire, put: id | null, drop: {id, spot, yaw} | null, take: id | null}` is applied by the host and every replica
  (the hand animation, the toss and the poof).
- `snapshot()` includes each rack copy's place. `hashView` includes the places, so the hashes must match across screens.
- **A slot that leaves** (the grace period ends): its held copy falls (it becomes `out`) as today. When the slot is reused by a new
  player, that player inherits the slot's copies as they are. This rule is documented and tested.

**Feel.**
- The take and return use the hat rack's hop and poof: a small sparkle at the peg and the tool flying to or from the hand. Reuse the
  item `toHand` / `tossing` states and their timings.
- A name label shows the tool taken, for example "Hammer". Use the `floatLabel` used by the hat rack.
- The peg display is per screen and follows the LOCAL view: it shows the kinds that at least one local player still has in stock, and
  dims a peg when none of this screen's players has that copy in `rack`. This keeps the shared rack readable in local multiplayer.

**Debug:** `__game.toolRacks.{ summary(), unlock(fireId), stock(player, fireId), cycle(player, fireId), goto(fireId), resetSession() }`.
`?racks` shows every rack without feasts and saves nothing.

**Tests** (`test/toolRack.test.js`):
- Pure cycle rules for every case above: empty hands, own copy from this rack, wrap-around with no empty step, the only copy left in
  stock, an overworld tool, a copy from another rack, someone else's copy, nothing in stock, and the rod gate.
- Separate sets: emptying the home rack's axe leaves the Frostpine rack's axe in stock.
- Placement against the real fire layouts (deterministic, clear of colliders and interactables, inside the distance range).
- The unlock gate per fire.
- Reserved ids stay stable and don't collide with lightsaber / ethereal ids.
- A host + replica pair: a replica cycles at a rack; a copy is tossed by a ground swap and the rack then skips it; the owner returns it;
  another player cannot return it. Hashes stay equal.
- A reload resets every copy (out and held) and the player memory never stores a rack copy.
- Existing item, harvest, fishing and combat tests still pass.

**Budget:** each rack costs 3 to 5 draw calls and only draws while its island is in full detail. No new lights. No new shader
programs (use the toon / vertex-colour materials the hat rack uses).

## Progress

- [x] Step 75 — Tool racks by each campfire: per-player, per-rack cycled tool sets


Implementation note: session-only lazy copies, host-authoritative events, pegs, pop-in, labels and debug tools are implemented. Browser review confirmed rendering, labels, wrap, rod gate and the overworld-tool drop. Follow-up fixes toss rack-dropped tools 1.6-2 u sideways/outward (wider safe search if blocked) and prioritise a reachable rack in its front approach so the next E continues cycling. Placement runs after gathering and reserves every final camp/garden stage, plots, cosmetic stands and the marsh stable/rods. It keeps >=2.5 u from other static interactables and all fixed DEFS seeds. Pinned spots (x,z,distance): home (9.060,14.600,5.5), frost (-5,-163,6), ember (204.495,86.309,8.5), dusk (870,443.75,6). Frost/Ember's larger clear rings remain camp-area reservations; full-build safety requires an 8.5 u Ember fallback beyond the original 6.5 u target. Follow-up browser review and real network play remain for the main session. Verification: 16/16 rack tests; full per-file fallback 1,526 passed, 0 failed, 1 skipped across 120 files (1,527 tests); npm test was attempted once and blocked by sandbox spawn EPERM.
