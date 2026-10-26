# Steps 80–84: Party Games

Moved verbatim from PLAN.md on 2026-10-22: the spec first, then the progress lines. The index of every step is [PLAN.md](../PLAN.md).

## Spec

### Steps 80–84 — Party Games: Mario Party / Pokémon Stadium style minigames on the islands (80a implemented 0.80.0, 80b 0.80.1, 80c 0.80.2, 80d 0.80.3, 80e done: version set by the main session)

**Decisions (user, 2026-10-15):** a suite of short 4-player minigames inspired by Mario Party and Pokémon Stadium, **reimagined in our world
with our characters and places**. The first eight are based on **Hot Rope Jump, Bumper Balls, Shy Guy Says, Hot Bob-omb** (Mario Party 1),
**Rock Harden, Sushi-Go-Round** (Pokémon Stadium) and **Clear Cut Challenge, Egg Emergency** (Pokémon Stadium 2). It is a **party mode for
kids**: an adult starts it with a debug command (or URL flag) and leaves it running; the kids play game after game without adult help.
**Games can be switched on and off for the Random mode. Each game has its own music track. Bots can fill the empty seats up to 4 players.**
(Numbering: the pet quest lines on home / Frostpine / Emberleaf keep Steps 74–79; party games are 80–84, so the version goes to 0.80.x.)

**The eight games (in-world names; the inspiration only lives in this plan, never in the UI):**

| # | Game (id) | Inspired by | Where (themed stage) | Host character | Players do | Win |
|---|---|---|---|---|---|---|
| 1 | **Vine Skip** (`vineskip`) | Hot Rope Jump | Emberleaf garden terrace at night, glowing Night-Bloom vine | Im Nabong + Mokuring swing the vine | Jump | last one standing |
| 2 | **Puffball Bumpers** (`bumpers`) | Bumper Balls | the top of a Duskcrown titan cap over the marsh | Capray circles as the bell | steer a rolling spore puffball, Jump = hop | last on the cap |
| 3 | **Marlo Says** (`marlosays`) | Shy Guy Says | Skipper's Cove, players on tide-pool posts | Skipper Marlo + Biscuit with signal flags | raise the red or the blue flag | last one dry |
| 4 | **Sizzle Seed** (`sizzle`) | Hot Bob-omb | the home campfire clearing | Dub Nyangee lights the fuse | run, bump a friend to pass the seed | whoever is NOT holding it at the pop |
| 5 | **Pinecone Huddle** (`huddle`) | Rock Harden | a Frostpine pine grove, one stump per player | Myodette calls it calmly | hold to curl into a pinecone shell | survive with the most shell left |
| 6 | **Feast-Go-Round** (`feastround`) | Sushi-Go-Round | a bamboo flume by the Emberleaf hot spring | Son Chaetty the hungry chef | grab dishes off the flume, mash to chew | most feast points |
| 7 | **Timber Trim** (`timber`) | Clear Cut Challenge | a log chute at the home bridge landing | Bramble the beaver judges | chop at the berry-paint mark | closest cuts |
| 8 | **Egg Scramble** (`eggs`) | Egg Emergency | the Frostpine critter camp, grouse in the pines | Shyam Shyam throws prank pinecones | run in your lane, stack eggs on your head | most eggs |

Every Tdoong host speaks lines that fit their **Personalities** (Steps 64–66; `game/tdoongzScript.js` header): Nabong comes running and
cheers first, Mokuring loves everything, Shyam Shyam pranks, Dub Nyangee is gentle and dependable, Myodette is calm and graceful, Son Chaetty
naps then eats. Marlo and Bramble keep their existing voices.

**Why stages in a pocket, not on the real islands:** each game is played on a small **themed copy** of its place (a dressed stage built from
the islands' cached assets: titan cap, basalt terrace, cove posts, pines, the campfire ring), all in ONE pocket like the combat areas and
storybook pages. So nothing touches the islands' seeded placement / pinned hashes, nothing in the world can wander in, and a kids' party can
never break a save. The pocket is the **Party Glade** at a pocket origin chosen clear of every island rectangle, `PAGE`, the area pockets
and `TEST_ORIGIN` (a test pins it; for example (-2400, 0)); each game's stage sits at its own offset inside it. Terrain uses a
`partyAt / inParty` hook like `areaAt` (flat walkable ground per stage shape; reuse `areaLogic.createGrid` + `mapFloor('arena')` shapes).

**80a — the party framework, bots, the lobby + Vine Skip + Timber Trim**
- **Opening the party (adult only):** `__game.party.open({mode, games, rounds, bots, difficulty})` and URL `?party` (with optional
  `&mode=random|party|pick`, `&games=vineskip,timber`, `&bots=fill|0..3`, `&difficulty=easy|normal|hard`). Refused (with the reason) during
  a cinematic, feast, combat run, storybook page or crossing (reuse the `boatSail` busy rule). The whole roster moves to the Party Glade
  behind a confetti curtain (like `pageFold`); held items are tucked away and returned on exit; the follow camera, tether, regroup, travel,
  Bag, Options' Join / travel rows and every world interaction are off while the party runs. `party.close()` (or the kiosk exit: hold
  Cancel + Interact on the keyboard for 3 s, a ring fills) returns everyone to where they stood (`playerMemory`-style restore).
- **Modes:** `random` (default; endless: a shuffle bag of the ENABLED games, no repeat until each was played, never the same game twice in a
  row), `party` (N rounds, default 6, then the trophy ceremony, then a new party), `pick` (the lobby board chooses the next game).
- **Toggling games:** the lobby has a **Game Board** (an interactable noticeboard, one icon tile per game with an on / off check, a "Play
  this one next" row) and the debug API `party.toggle(id, on)` / `party.enabled()` / `party.games()`. At least one game must stay on (the
  last one cannot be switched off; Random with one game simply repeats it). Preferences are per host screen: `infiniteIsland.party`
  `{enabled: [ids], mode, rounds, bots, difficulty}` (`?newgame` does not clear it, like the comfort settings).
- **Game flow** (pure state machine `game/party/flowLogic.js`, Node-tested): `lobby` -> `pick` (a roulette of the enabled games' tiles
  lands on the bag's next pick, 3 s) -> `howto` (title, the host character's one-line pitch, an icon card of the buttons it uses per device:
  keyboard / standard pad / GameCube / phone, and **10 s of practice** on the real stage where nothing scores; ends when every human holds
  Interact ("Ready!") or the timer runs out, so idle kids never stall it) -> `countdown` (3, 2, 1, Go!) -> `play` -> `results` (winners
  hop, losers clap, confetti, +stars) -> next. Kids-proofing: every phase advances on its own; no menus need reading; a player who stops
  pressing anything is still played for (they just lose); a game never waits for input.
- **Contestants and bots:** the party roster = this host's players + online players + bots, up to 4. **A bot is a real `Player` on the host
  screen driven by a `BotSource` that implements the input contract** (`poll()` -> `{x, y, interact, cancel, jump}`), so every game, sync
  path and animation treats bots exactly like people (same physics, same timing rules, no cheating code paths). Bots take free global slots
  (slot table entries carry `bot: true`; replicas see them as ordinary remote avatars through poses) and **give their slot up at the next
  `pick` when a human joins**; `bots: 'fill'` keeps the table at 4. Each game exports `bot(view, me, skill, rng)` that reads only what a
  player can see, with a human-like reaction delay and aim noise from `PARTY.bots[difficulty]` (easy is what a 5-year-old can beat).
  Bots are named after Tdoongz ("Nabong", "Chaetty", ...), wear that friend's colours (`setColors`) and a party-hat version of their ears
  (bunny ears, puppy ears, bear ears, horn, ...: new hat models in the `hats.js` style, 1 draw call each). Debug: `party.bots(n | 'fill',
  difficulty)`.
- **Game module contract** (`game/party/registry.js`; every game = a pure logic file + a world file):
  `{id, name, host, stage, track, players: [min, max], kind: 'ffa' | 'lanes' | 'elim', duration, howto: {pitch, buttons}, init(seed,
  roster), step(state, inputs, dt, t), request(state, actor, req) -> rec | reject, view(state), placing(state) -> ranks, bot(...)}` in
  `game/party/<id>Logic.js` (pure, deterministic from the host's seed and clock, Node-tested), and `world/party/<id>.js` (stage dressing,
  props, presentation of recs, camera shot). Tunables in `PARTY.<id>` in config.
- **Sync:** host-authoritative **`party` domain** (session-only, never saved): phase, mode, bag, game id, seed, roster (slot, bot, eliminated,
  score), stars, the game's `snapshot()`; `hashView` = all of that but timers. Two patterns, chosen per game: (1) **own-body games** (each
  screen moves its own players as today; actions like jump / chop / grab are host requests stamped with the screen's sim clock and re-judged
  with `slack`, like fishing's `reel`), and (2) **host-simulated games** (Puffball Bumpers, the Sizzle Seed carrier, flume dishes: the host
  steps the bodies from streamed inputs and broadcasts motion at 20 Hz, replicas interpolate, like the page world's 10 Hz motion). The
  target is ONE screen with gamepads / phone controllers (zero latency); online replicas must work and keep equal hashes.
- **Presentation:** a fixed stage camera per game (the cinematic camera override, no follow cam; fits 4 players at 16:9 and portrait
  phones), a Mario-Party-style **corner scoreboard** (four chips in the player colours: name, bot mark, stars, the game's live score /
  "OUT"), a big centred countdown / "Finish!", a results card and the podium. Inline-SVG icons only (a game icon per game + button icons
  in `ui/icons.js`). Sounds: countdown blips, whistle, elimination boing, win fanfare (synth in `sfx.js`).
- **The lobby (Party Glade):** a meadow with bunting, a small stage with the Game Board, a podium and the star tally, and **three Tdoongz
  cheering at a time** (rotating; `createTdoongModel` clones without the wander runtime: about 11 draw calls each). Players can run around
  between games.
- **Music:** each game gets its own procedural track in `audio/music.js` (indices continue after 17; every older track's events stay
  SHA-256 pinned), plus a lobby track and two short jingles (round won, party trophy). New: `REGION_TRACKS['party']` = lobby,
  `music.party(id)` plays the game's track from bar 1 at Go!, and `music.setTempo(k)` (a scheduler time scale, used by games that speed up;
  1 = the written tempo). 80a adds **Glade Jamboree** (lobby: calypso bounce, steel-drum lead, 120 bpm), **Vine Skip** (jungle log-drum
  samba, 126 bpm, tempo follows the vine), **Timber Trim** (hoedown: plucked fiddle lead, washboard, 138 bpm) and the jingles.
- **Vine Skip** (`vineskip`, Hot Rope Jump): Nabong and Mokuring stand on two basalt posts and swing a long glowing Night-Bloom vine around
  in a full circle at ankle height over a round terrace; players stand in the middle (they may walk a little) and Jump over it. The swing
  speeds up in steps; from 30 s **Mokuring's surprises** (a pause-and-go, a reverse) are telegraphed by her face and a chime. Touching the
  vine while not airborne = a tumble off the terrace into the warm pool (soft splash, the player then cheers from the rim). Last one
  standing wins; if two or more last 60 s, all of them win. Judging on the host from the vine's angle at the player's position and the
  dodge-style airborne window (`[jump.at, jump.at + air)`, never raw y). Bot: jumps when the vine's ETA < reaction + noise.
- **Timber Trim** (`timber`, Clear Cut Challenge): four lanes side by side; Bramble sends a log (pine, birch, palm, breadfruit) sliding
  up out of a chute in each lane; a berry-paint ring marks the cut line; press Interact once to chop as the log passes your axe. Score = how
  close the cut is (shown in "beaver bites"; dead on = "Bramble's Bite!" + sparkle). 5 logs each, later logs faster and some wobble; the
  same log sequence for every lane (same seed) so it is fair. Highest total wins. The host judges from the press time on the presser's
  clock + `slack`. Bot: presses at the mark's ETA + noise.
- **Debug:** `__game.party = {open, close, play(id), next(), skip(), toggle, enabled, games, bots, summary(), state, debug: {win(slot),
  end(), seed(n)}}`; `__game.world.goto('party' | 'party:<id>')`.
- **Tests** (`test/party.test.js`, `test/partyVineSkip.test.js`, `test/partyTimber.test.js`): flow transitions and timeouts with no input,
  the shuffle bag (no repeats, never back to back, respects toggles, never empty), bots yield to joiners, BotSource matches the input
  contract, pocket clear of everything, both games' rules (deterministic replays, judging windows, ties), bot win rates per difficulty
  over seeded runs (easy loses most games to a scripted "average kid" input, hard wins most), a host + replica pair with equal hashes
  through a whole game.

**80b — Marlo Says + Pinecone Huddle (button timing, everyone on their own spot)**
- **Marlo Says** (`marlosays`, Shy Guy Says): players stand on four tide-pool posts in front of Marlo's wreck; Marlo shouts and raises
  the **red** or **blue** signal flag (left / right); copy him before the beat ends: red = Interact or stick left, blue = Jump or stick
  right (both work, so little kids can use either the stick or the buttons). A wrong flag or too slow = splash into the tide pool (the
  hop-course splash), then cheer from the beach. Beats get faster; **Biscuit** sometimes squawks a fake call (the flag is what counts, the
  shout can lie after 40 s). Last one dry wins; all who last 75 s win. Track **Signal Flags** (sea shanty, concertina-like square lead,
  6/8, 104 bpm, tempo follows the beat).
- **Pinecone Huddle** (`huddle`, Rock Harden): each player on a stump in a snowy pine grove; pinecones and snow clumps drop from the
  canopy at random times (a growing shadow + a whistle per player, independent schedules from one seed so it stays fair over the round).
  Hold Interact to curl into a pinecone shell (a shell mesh closes over the character); the shell meter drains while held and never
  refills. Hit while open = dazed and snow-covered, OUT. Survivors at 60 s win, ranked by shell left. Myodette's calm countdown lines.
  Track **Pinecone Waltz** (Frostpine 3/4 music box with celesta and soft timpani; steady tempo so the music never gives the drops away).
- Tests: beat / call schedules, fake calls only after 40 s, both input styles, drop schedules fair across lanes, shell meter rules, bots.

**80c — Sizzle Seed + Egg Scramble (running around)**
- **Sizzle Seed** (`sizzle`, Hot Bob-omb): around the home campfire ring (benches as obstacles), Dub Nyangee hands a sizzling Ember Seed
  to a random player; run into a friend to pass it (host-judged touch, 0.6 s "no pass back"); the seed glows brighter and its fuse sparkles
  faster but the pop time is hidden (12-25 s from the host's rng). POP = a confetti / soot puff, the holder gets a sooty face and loses,
  everyone else wins. Party variant toggle `PARTY.sizzle.rounds` (default 1; >1 = repeated pops until one player is left). The carrier is
  host-simulated (pattern 2) so a pass is never disputed. Track **Fuse Box** (ticking pizzicato, tense bass ostinato, hi-hat that speeds up
  with the fuse sparkle, not with the real timer).
- **Egg Scramble** (`eggs`, Egg Emergency): four lanes at the critter camp; grouse in the pines drop eggs; players run left / right in
  their lane and the eggs stack on their head (the head socket; a wobbling stack); golden eggs = 3. **Shyam Shyam** giggles and lobs prank
  pinecones: one on your head knocks the stack off (you lose half). Same egg / pinecone sequence in every lane. 45 s, most eggs wins. Track
  **Henhouse Polka** (chirpy polka, bird-whistle lead, 150 bpm).
- Tests: pass rules and pass-back lockout, hidden timer only on the host (never in a replica-readable event before the pop), fair lane
  sequences, stack / knock-off maths, bots (bot carriers chase the nearest non-holder, bot eggs track the shadow under noise).

**80d — Feast-Go-Round + Puffball Bumpers (shared moving things, the hardest sync)**
- **Feast-Go-Round** (`feastround`, Sushi-Go-Round): players sit along a bamboo flume by the hot spring; Son Chaetty (awake for once)
  sends dishes floating past: every dish from the catalog's RECIPES (their real icons as floating plates) worth 1-5 points, a rare golden
  Lantern Supper worth 10, and **chilli peppers** that make you hop up and fan your mouth for 2 s if you grab one. Interact grabs the dish in
  front of your seat (only with an empty plate), then mash Interact to chew (bigger dishes need more chews). The flow reverses at half time
  so no seat is always upstream. Most points wins. Track **Flume Swing** (swing shuffle, walking bass, muted-trumpet lead, 132 bpm).
- **Puffball Bumpers** (`bumpers`, Bumper Balls): each player rides a big glowing spore puffball on top of a titan mushroom cap; steer to
  roll, Jump for a small hop; balls bounce off each other by mass and speed (host-simulated circle physics, pattern 2, inputs streamed
  from replicas). Off the edge = drift down on spores into the marsh glow and watch. At 30 s the cap's rim pores dim and the cap shrinks.
  Last one on wins. Capray glides round the rim and rings the bell at the start. Track **Spore Bounce** (wobbly glass marimba + theremin
  bass march in Duskcrown's palette, 112 bpm).
- Tests: flume schedule fairness and reversal, grab / chew / pepper rules, collision maths (momentum conserved, no tunnelling at max speed,
  deterministic from the seed), edge-off rules, replica inputs at 100 ms simulated latency with equal hashes.

**80e — the full party: stars, the trophy, kiosk polish and balance**
- **Party mode scoring:** winners of each game get a star (plus a bonus star for "most hops", "best cut", ... per game); after N rounds
  the **trophy ceremony** on the lobby podium (1st / 2nd / 3rd, a gold Tdoong-shaped trophy, all nine Tdoongz cheer in a cut, the trophy
  jingle), then a fresh party starts. Ties share a place.
- **Kiosk polish:** `?party&kiosk` (title card skipped, Options locked except volume, no Join / New game / travel, the 3 s keyboard exit
  only), a quiet **attract mode** after 2 minutes with no human input (bots play a game on their own with music at half volume; any
  button jumps back to the lobby), devices that join mid-party queue for the next `pick` and replace a bot.
- **Balance pass:** a seeded 4-bot soak of every game (thousands of rounds in Node: no game takes longer than its cap, no seat / lane
  wins more than its fair share by a margin, easy bots beat by the scripted kid input), and a browser playtest list for the user.
- Budget for every stage: <= ~140 draw calls with 4 players at 1280x720, no new lights, at most +3 shader programs for the whole suite.

**Hand-off.** One sub-agent per substep (80a first; 80b-d each add two games on the 80a contract and can run one after another; 80e last).
Read first: this section, CLAUDE.md "Architecture" + "Testing technique", `players/playerManager.js` + `players/slotTable.js` +
`input/*Source.js` (devices, the input contract, debug players), `game/dungeon.js` + `game/areaLogic.js` (pocket + whole-roster teleport +
restore), `game/storybook.js` + `ui/pageFold.js` + `game/pageWorld.js` (session-only domain, camera override, host motion broadcast),
`game/fishing.js` (requests judged on the sender's clock with slack), `game/hopLogic.js` (splash / respawn), `npc/tdoongz.js`,
`game/tdoongzScript.js`, `world/marlo.js`, `world/npcs.js` (Bramble), `game/cinematic.js`, `audio/music.js` (track format, pins),
`ui/icons.js`. 80a = 0.80.0, 80b-e = 0.80.1-0.80.4. Update README (party flags, controls per game, how to leave) + CLAUDE.md; say what
was and was not verified (audio by ear, real pads / phones, kids' feel are the user's).


## Progress

## Steps 80–84: Party Games — Mario Party / Pokémon Stadium style minigames

- [x] Step 80a — Party framework (Party Glade pocket, `party` domain, flow lobby -> pick -> howto/practice -> countdown -> play -> results, Game Board toggles + `infiniteIsland.party`, `?party` / `__game.party`, BotSource bots as Tdoong-themed players, corner scoreboard, lobby track + jingles) + Vine Skip + Timber Trim (0.80.0, done). Built as specified: the pocket at (-2400, 0) with stage offsets +90 / +180 (a test pins it clear of every island, the page lane, the area pockets and `TEST_ORIGIN`; `world/terrain.js` answers for it, islands untouched); `?party[&mode=&games=&rounds=&bots=&difficulty=]` / `__game.party.{open, close, play, next, skip, toggle, enabled, games, bots, summary, state, debug}` and `__game.world.goto('party' | 'party:<id>')`, refused while busy, a confetti curtain in / out, held tools tucked away, the kiosk exit (hold Cancel + Interact 3 s); the pure flow (`game/party/flowLogic.js`: every phase advances by itself, a shuffle bag that never repeats back to back, toggles that never leave zero games, normalised prefs `infiniteIsland.party`), the registry contract, the host-authoritative session-only `party` domain (records applied on every screen so hashes match, stamped presses re-judged with `PARTY.slack`), BotSource bots that are real Players (slot table `bot: true`, Tdoong names / colours / party-hat ears, they yield to a joiner at the next pick, `bots: fill`), the HUD (corner chips, banner, roulette, per-device how-to + 10 s practice, results), the lobby (bunting, stage with three rotating cheering Tdoongz, Game Board, podium), three new music tracks + `music.party(id)` / `setTempo(k)` + the sounds, Vine Skip and Timber Trim as specified. Deviations: the registry contract gained `apply` (state changes only through records: a replica replays them), `press`, `lag`, `tail`, `howto.verbs` and an optional `debugWin`; the round-won / trophy jingles are synth sounds in `sfx.js`, not music tracks; the Game Board is a dialog menu (an icon per game, on / off, "Play this one next", mode, bots, bot skill) rather than a tile wall, the star tally is the HUD chips (the podium is lobby decor, winners are not placed on it); the how-to card shows keyboard / controller (A / Y / B, which is also the GameCube labelling) / phone icons; Vine Skip's hosts ride the turning vine rig; the host also sends a `tick {gt}` beat so a replica's game clock follows a slow host tab; practice is local and never scored. **994 -> 1047 tests / 91 files** per file. Verified in the Browser pane (host, 1280x720): lobby, roulette, how-to (practice), countdown, both games in play, results, real keys (Ready hold, Space jump request, Q + E exit restoring the player), the Game Board via a real Interact, a host + `?join` WS replica (moved in, bots as avatars, equal hashes, a replica jump judged on the host); draw calls with 4 players: lobby 120, Vine Skip 134, Timber Trim 117 after trims (155 before). NOT verified: audio by ear (music + sounds), real pads / phones / the GameCube adapter, PeerJS, the portrait phone HUD, the feel and balance for real kids (bot numbers come from Node win-rate runs), a screenshot of Timber Trim after the final draw-call trims, 80b-e. Review fixes (main session): default bot skill is easy (normal bots scored ~98% in Timber Trim, unbeatable for kids), the Bag button and Tab / B stay shut during a party, Timber Trim labels wrap so neighbouring lanes no longer overlap.
- [x] Step 80b — Marlo Says + Pinecone Huddle, tracks Signal Flags / Pinecone Waltz (0.80.1, done). Built as specified: stages at offsets +270 / +360 (`game/party/partyArea.js` pads + spectator spots, LOOKS `snow`), pure `marlosaysLogic.js` / `huddleLogic.js`, `world/party/marlosays.js` / `huddle.js`, red = Interact or stick left, blue = Jump or stick right (`flagFromInput`), Biscuit lies after 40 s but the raised flag counts (60% Biscuit calls, 70% of those lie), fair per-player drop schedules (same 11 gaps, shuffled, jittered starts), a shell HOLD with a 9.5 s meter that never refills, survivors ranked by shell left, bots with reaction delay / forgetting / wrong flag / fooled by the squawk (`PARTY.bots[d].fool`, `.shell`), tracks 21 / 22 (new voices concertina, celesta, timpani, pinned), sounds flag / squawk / dropwhistle / shell, icons, host lines, `world.goto('party:marlosays' | 'party:huddle')`, `debugWin`. Deviations: the registry gained `hold: true` and `act(actor, t, extra)` carries `{flag}` / `{on}`; the 40 s lie is Biscuit's shout while the flag stays honest; huddle has no spectator teleport (the dazed player lies under a snow heap on the stump); bot difficulty tuning kept the 80a table and added fields. Bot win rates of a scripted average kid (`test/fixtures/sim80b.mjs`): vs 3 easy bots ~62% Marlo Says / ~78% Huddle, vs 3 hard bots ~6% / 0%. **1047 -> 1061 tests / 93 files.** Verified in the Browser pane (host, small viewport): both stages render, a real Space press judged by the host (splash, beach teleport), real KeyE hold curls and releases; Marlo Says 114 draw calls / 14 programs with 4 players, Huddle about 115; no console errors. NOT verified: audio by ear (tracks and sounds), real pads / phones / stick presses, a two-screen browser run, the portrait phone HUD, kids' feel and balance, the practice demos by eye, Huddle at 1280x720 with shells closed. Review fix (main session): on short screens (height <= 420 px, e.g. a landscape phone) the party cards sit below the top button row at 0.74 scale instead of under it. Playtest fixes (user, 2026-10-16): Marlo Says uses big RED (left, Cancel / B) and GREEN (right, Interact / A) flags to match the GameCube pad; the stick never raises a flag and walks you about on your post; Pinecone Huddle's shell shuts the instant you press (close 0) and a tap still blocks for a 0.3 s parry (and costs 0.3 s); Timber Trim marks the chop with a red stripe on every log and a red cut line + arrow posts per lane, and Bramble stands on an open, roofless lookout on the left; Vine Skip's hop is higher and longer (take-off 8.2, ~0.68 s in the air, judged window 0.05-0.62 s; `player.setHopSpeed` so avatars match); the lobby has a dress-up corner (hat stand, tail stump, garland frame cycling the unlocked hats / tails / garlands) and lasts 12 s between games. Timber Trim follow-up: the score was judged with the log 1.66 u past the drawn line (a hard-coded `markFrac` 0.62), so the log's END scored best; the judged point now comes from the stage numbers (`MARK_FRAC`, `markFracOf(stripe)`); seven waves (was five), each with its stripe at 1/4, 1/3, 1/2, 2/3 or 3/4 from the front (the five shuffled per game, then two more; the same for every lane); after a cut the stripe stays on its half, a perfect cut removes it and the halves sparkle; labels rise over the chopper's stump, not over the cut. The open ritual portal's menu has a "Party Glade" row (confirm, then `party.open()`; host screen only, a joined screen gets a toast).
- [x] Step 80c — Sizzle Seed + Egg Scramble, tracks Fuse Box / Henhouse Polka, plus two more lobby tracks (0.80.2, done). Built as specified: stages at +450 / +540, pure `sizzleLogic.js` / `eggsLogic.js`, `world/party/sizzle.js` / `eggs.js`, hosts Dub Nyangee and Shyam Shyam (lines, howto pitches, icons, sounds, `PARTY.sizzle` / `PARTY.eggs`, `goto('party:sizzle' | 'party:eggs')`, `debugWin`), tracks 23 Fuse Box and 24 Henhouse Polka, lobby tracks 25 Sunny Skip (ukulele + marimba skip) and 26 Bubblegum Shuffle (synth-pop shuffle) with a rotation (Glade Jamboree first, then each in turn, never the same twice in a row; `nextLobbyTrack`). Sizzle Seed: host-simulated holder, touch pass with a 0.6 s no-pass-back (plus "must have parted"), a hidden pop time (a WeakMap on the host, never in state / recs / snapshot / hash; the glow follows the seed's age only), the seed drawn over the holder's head. Egg Scramble: one drop sequence for every lane, the host settles an item when the drawn egg meets the drawn stack (itemPose), golden = 3, a full stack of 8 banks into the henhouse, a pinecone knocks off the top half. Deviations: Sizzle plays 2 pops by default (`rounds` 2; the plan said 1) so a game lasts about 40 s instead of about 20; the registry accepts `press: []` for stick-only games and bots get `me.others`; eggs bank at 8 eggs (new, keeps the stack on screen); bot sticks use a `pace` floor so easy bots still move. Bot win rates of a scripted kid: vs 3 easy ~96% / ~94% (Sizzle / Eggs), vs hard ~9% / ~13%. **1061 -> 1094 tests / 95 files.** Verified in the Browser pane (host, 800x556): both stages with real Players and bots, no console errors. NOT verified: audio by ear, real pads / phones, a two-screen browser run, kids' feel, the soot cloud look.
- [x] Step 80d — Feast-Go-Round + Puffball Bumpers, Flume Swing / Spore Bounce (0.80.3, done, user review applied). Built: stages +630 / +720, all eight games / board, host rules, inputs, music / sounds / icons / tunables, goto/debugWin and practice. Feast now has 18 cached chunky 3D prototypes (all16 RECIPES, chilli, golden Lantern Supper), merged food/plate/dark hull on shared VERTEX_TOON and instanced per kind for both flume and carried plates. Players freely walk the inner floor (4.5 u radius, clear of counter), start facing out, and grab the nearest dish in real forward reach; bots walk to meals too. Original scoring / peppers / continuous half-time reversal / 54 s cap remain. Bumpers now broadcasts eased facing, signed gait, bump lean and a world rolling quaternion integrated from actual travel / radius; existing Player limbs treadmill / backpedal on top and patterned balls visibly roll identically on replicas. Original 2D mass collisions / centre-off / 30 s shrink / drift / 60 s cap remain. Choices: four-copy symmetric flume waves, Bumpers hop remains visual with 2D collisions, survivors tie at the cap. Verified: 1126 tests / 97 files, all per-file after npm test spawn EPERM; includes 32 Step 80d tests for real-position grabs, inner-floor movement, model cache / active instance limits (four flowing + up to four held kinds), moving fairness / all starts, independent walking kid balance, real Player rigs, facing / backpedal / bump lean, roll distance / radius and replica render-rate independence, momentum / no tunnelling, whole-game host/replica hashes including 100 ms Bumpers input latency, unchanged old music pins and audio graphs. Feast camera projection contains the counter / inner floor at 16:9 and 9:16. Moving-kid Feast easy/normal/hard wins 100% / 90% / 0% (40 seeds); Bumpers rates remain 98.75% / 48.75% / 11.25%. Sampled stage + four-player mesh/shadow counts 106 / 104 before common overhead, conservative total estimates 125-140 per stage; no new lights or shader code. NOT verified for the follow-up: browser visuals / dish recognition / animation feel, real two-screen browser play, measured 1280x720 GPU draw / program counts, portrait phone HUD/touch, audio by ear / waveform levels, real controllers or kids' feel (browser inventory empty). Version remains 0.80.3; endings preserved, scratchpad untouched, no git index/history changes. Review (main session, browser): the dish plates were blank because the catalog icons are inline-HTML SVG (no xmlns, sized 1em) and failed to load as images; the earlier stage added the namespace and a pixel size (superseded by the 3D models below). Verified in the Browser pane: both stages render, real-key grab + chew in Feast-Go-Round, real-key rolling in Puffball Bumpers, both play to results, no console errors. The 80a test "open is refused while busy" failed once in a full `npm test` run and passed in the next three (intermittent). Latest follow-up: fallen players now land at four clear spots and walk with ordinary own-body input on a bounded marsh patch (centre 0,8, r3, y-8.2); bots stroll, replicas follow owner poses, and neither spectator input nor cross-layer body pushing affects the balls / hashes. Stage/terrain/colliders share floor/prop numbers; floor boundary plus heads and riders pass frustum checks at 16:9, 9:16 and 19.5:9. Drift finishes during results, then own bodies are unpinned. Shrink/dim starts at 30 s with a gentle cubic tightening curve to retain about 45-60 s average play. All games show howto/practice only on first play per host page: domain seenHowto snapshot/hash memory survives close/open, never prefs; a fresh domain forgets; countdown resets starts / Timber axes even on repeats. Verified 1139 tests / 99 files per-file after npm test spawn EPERM, including 13 new spectator/session checks (clear landings, real second-player walking, bots / remote avatars, physics/hash isolation, no cross-layer pushes, all-game repeat setup and host/replica/late-join memory). No new lights or mesh batches; draw estimate still about 125-140 per stage. NOT verified for the latest follow-up: browser visuals / occlusion / feel or actual two-screen browser play, phone HUD / touch, GPU draw/program counts, hardware, audio by ear, kids' feel. Version still 0.80.3, endings preserved, scratchpad untouched; no git index/history changes.
- [x] Step 80e — Party mode stars + trophy ceremony, kiosk + attract mode, 4-bot balance soak (0.80.4 / see main session, done). Built: a bonus star per game for one feat (`game/party/bonusLogic.js`, ties share, a feat everybody shares is none: Vine Skip most hops, Timber Trim closest cut, Marlo Says quickest flag, Huddle most dodges, Sizzle most passes, Eggs golden eggs, Feast most dishes, Bumpers most bumps, Glowcap bullseye feet, Cast biggest find, Tilty fast starter, Bonk closest call; `results.bonus` + a line on the results card); the trophy ceremony after the last round of a party (a lobby with `ceremony: { places }`, host-timed 18 s, one `cinematic` cut on every screen: podium places with ties, a gold Tdoong trophy, all nine Tdoongz as baked two-pose crowd (`world/party/ceremony.js`, `npc/models.js setLowDetail`), jingle, confetti; hold Cancel on any screen skips it for everybody; then a FRESH party); `?party&kiosk` (no title card, Options = sound only, no Join / pair panel / split, the 3 s keyboard exit) and the attract mode (kiosk or `?attract`: 120 s idle -> only the bots play, music ducked to 0.5, "Press any button to play!", any human input -> fresh lobby; joined screens send `touch`); a mid-party joiner who found the island full is queued (150 s) and takes the seat a bot gives up at the next lobby / pick by himself; the seeded 4-bot soak `test/fixtures/soak80e.mjs` (+ `test/party80e.test.js`, 19 tests). Deviations: the ceremony is NOT a new flow phase (`PHASES` stays six: it is the lobby with `ceremony`), 3+ ties share the first block shoulder to shoulder, the attract mode is off in an ordinary `?party` (opt-in `?attract`) so long idle tests and living-room parties never switch to demos by themselves. NOT verified: audio by ear (jingle, ducking), real pads / phones / a second real screen, the cut on a 1280x720 GPU, kids' feel. See the soak table and the playtest checklist below.


## Browser playtest checklist (Step 80e, for the user)

Nobody but a person can judge these: tick them on a real screen with real controllers / phones. Every line says how to get there.

**Bonus stars**
- [ ] Play each of the twelve games once (`?party&games=ID&bots=3`, or `__game.party.play('ID')`) and read the results card: the line "Bonus star: <feat> <names> (<what>)" appears under the ranking and matches what happened (Vine Skip: who hopped most; Timber Trim: whose cut was closest; Marlo Says: whose flag was quickest; Huddle: most cones dodged; Sizzle: most passes; Egg Scramble: most golden eggs; Feast: most dishes; Bumpers: most bumps; Glowcap: whose feet stayed nearest the glow; Cast: biggest find; Tilty: most tiles by 10 s; Bonk: narrowest escape). The chip star count goes up by two for a winner who also did the feat.
- [ ] Does a bonus feel EARNED (not random) to a child? Is "who did the feat" ever a surprise nobody understands? Note any feat to rename or swap.

**The trophy ceremony** (`?party&mode=party&rounds=2&games=vineskip`, or play two quick rounds)
- [ ] After the last round's results card (8 s) the picture cuts to the lobby: letterbox bars, "Party over! <names> win(s) the trophy!", the trophy jingle (is it grand, is it too loud under the ducked music?), confetti all the way.
- [ ] Every seat stands on its step: 1st on the tall middle block, 2nd on the left, 3rd on the right, 4th on the grass; ties share. Their feet touch the blocks (no sinking, no floating), they hop, the name strip fills in from last place up to the winner.
- [ ] The golden Tdoong trophy rises with a bounce; the crowd of nine (Nabong, Mokuring, Nyangee, Chaetty, Shyam, Bbui, Myodette, Zyoni, Tzukumi) is on the stage and cheers (arms swapping high / wide, bouncing). Zyoni (the unicorn) should rear, not wave. Do any of the nine look wrong in the low-detail bake (ears, tails, eyes)?
- [ ] The camera: wide, pushes in on the stage and trophy, closes on the podium, swings back over the crowd, pulls out. Nothing is hidden behind a tree or the board. Portrait phone as a joined screen: the framing still holds the podium.
- [ ] Hold Cancel (Q / B) for one second on ANY screen (host, a joined screen, a phone): the cut ends everywhere and a fresh lobby ("Round 1", 0 stars) starts. A short tap does nothing.
- [ ] Nothing saved: reload afterwards; the island is where you left it, no new files in the save, the Game Board choices are the only thing remembered.
- [ ] Two real screens (host + `?join=CODE`): both run the cut at the same moment, hashes equal (`__game.sync.hashes()`), the replica's own player stands on its step.

**Kiosk and attract mode** (`?party&kiosk`)
- [ ] No title card; the party opens by itself; no "+" Join button, no pair panel on P, no J split, no fullscreen prompt on a phone / tablet; the "..." Options menu holds only the music and sound buttons; Tab / B (Bag) stay shut. Hold Cancel + Interact on the keyboard for 3 s: the ring fills and the party closes (the ONLY way out).
- [ ] Leave it alone for 2 minutes (also `?party&attract` without the locks): the next lobby turns into the demo: only the bots play, the human sits out on the rim, "Press any button to play!" at the bottom, the music clearly quieter (half). Is half the right level in a loud room?
- [ ] Press any button on the keyboard, a pad, or touch a phone controller: the demo stops, a fresh lobby (0 stars, round 1) appears, the music comes back up, your player is back in the roster.
- [ ] A friend's phone joins in the middle of a game while four seats are taken: they see "You are next!", the running game is not disturbed, and at the next lobby a bot leaves and the friend is in (no extra button press). They play the following pick.

**Balance, for children** (numbers from the Node soak are in plan/CHANGELOG.md; only kids can say if it is fun)
- [ ] With the default (easy) bots does a child win a fair share, and do the hard bots feel unfair or just right? Note games where an easy bot still wins nearly always or never.
- [ ] Is every game over in about the time the table says (average seconds in the soak)? Any game that drags or ends before the kids understood it?
- [ ] Is the first how-to of each game understood without help (it is shown once per host session)?

**Budgets on the real GPU** (open the Browser pane at 1280x720, `__game.renderer.info`)
- [ ] Lobby during the ceremony: draw calls and triangles (measured in a 569x355 pane on 2026-10-25: about 106-109 calls / 287-325k triangles, the ordinary lobby 144 / 311k, 27 programs both); at 1280x720 the numbers should be about the same (calls <= ~140, triangles < 400k, programs unchanged).
