// Step 80e: the balance soak. Every party game played start to finish on its REAL rules by four bots (kinematic bodies, no renderer), seeded, thousands of rounds when asked. For each game it checks
//   1. it ends by itself, inside its cap (the flow cuts a game at GAME.duration + 4);
//   2. no seat wins more than its fair share (a quarter) beyond a margin (ties split a win);
//   3. the scripted "average kid" beats three EASY bots most of the time (the default bot skill) and does worse against hard ones;
//   4. the bonus feat (bonusLogic.js) names real seats and is given in a sensible share of the games.
// test/party80e.test.js runs it with a SMALL count (fast); run it yourself for the big numbers:
//   node test/fixtures/soak80e.mjs [rounds per game = 300] [kid rounds = 120] [game id]
import { PARTY } from '../../public/js/config.js';
import { mulberry32 } from '../../public/js/utils/rng.js';
import { getGame, GAME_IDS } from '../../public/js/game/party/registry.js';
import { bonusFor } from '../../public/js/game/party/bonusLogic.js';
import { stageSpawns } from '../../public/js/game/party/partyArea.js';
import * as VS from '../../public/js/game/party/vineskipLogic.js';
import * as TM from '../../public/js/game/party/timberLogic.js';
import * as MS from '../../public/js/game/party/marlosaysLogic.js';
import * as HU from '../../public/js/game/party/huddleLogic.js';
import * as BU from '../../public/js/game/party/bumpersLogic.js';
import { playFull as playB, KID as KID_B } from './sim80b.mjs';
import { playSizzle, playEggs, KID as KID_C } from './sim80c.mjs';
import { playFeast } from './sim80d.mjs';
import { playGlowcap, playCast, KID as KID_81A } from './sim81a.mjs';
import { playTilty, playBonk, KID as KID_81B } from './sim81b.mjs';

// ---- the games without an exported simulation (their own tests keep a private copy of these loops)
const roster = (n) => Array.from({ length: n }, (_, slot) => ({ slot, bot: true, name: `b${slot}` }));
const KID_VINE = { react: 0.42, noise: 0.12, miss: 0.1 }, KID_TIMBER = { react: 0.4, noise: 0.14, miss: 0.1 };

function playVine(seed, skills, rngSeed = 1) {
  const n = skills.length, g = VS.init(seed, roster(n)), spawns = stageSpawns('vineskip', 4);
  const mem = skills.map(() => ({})), rngs = skills.map((_, s) => mulberry32((seed * 8191 + s * 131 + rngSeed) >>> 0)), dt = 1 / 30;
  const at = (s) => ({ x: spawns[s].x, z: spawns[s].z });
  let t = 0;
  while (!g.done && t < 90) {
    t += dt;
    const ctx = { t, pos: at, slack: PARTY.slack, lag: VS.GAME.lag };
    for (const s of g.slots) {
      if (!g.alive[s]) continue;
      if (VS.bot(VS.view(g, t), { slot: s, ...at(s), mem: mem[s] }, skills[s], rngs[s]).jump) { const r = VS.request(g, s, { t }, ctx); if (r.rec) VS.apply(g, r.rec); }
    }
    for (const rec of VS.step(g, ctx, dt, t)) VS.apply(g, rec);
  }
  return { g, t, placing: VS.placing(g) };
}

function playTimber(seed, skills, rngSeed = 1) {
  const n = skills.length, g = TM.init(seed, roster(n)), mem = skills.map(() => ({})), rngs = skills.map((_, s) => mulberry32((seed * 7919 + s * 101 + rngSeed) >>> 0)), dt = 1 / 60;
  let t = 0;
  while (!g.done && t < 70) {
    t += dt;
    const ctx = { t, slack: PARTY.slack, lag: TM.GAME.lag };
    for (const s of g.slots) {
      if (TM.bot(TM.view(g, t), { slot: s, mem: mem[s] }, skills[s], rngs[s]).interact) { const r = TM.request(g, s, { t }, ctx); if (r.rec) TM.apply(g, r.rec); }
    }
    for (const rec of TM.step(g, ctx, dt, t)) TM.apply(g, rec);
  }
  return { g, t, placing: TM.placing(g) };
}

// Puffball Bumpers: the kid aims for the middle, brakes late and sometimes rolls at a friend (the same script as test/partyBumpers.test.js)
function bumperKid(v, slot, mem, rng) {
  if (v.t < (mem.next ?? 0)) return mem.intent;
  mem.next = v.t + 0.4;
  const b = v.balls[slot]; let x = -b.x * 0.6 - b.vx * 0.8, z = -b.z * 0.6 - b.vz * 0.8;
  const target = v.slots.filter((s) => s !== slot && v.alive[s]).map((s) => v.balls[s]).sort((a, c) => Math.hypot(a.x - b.x, a.z - b.z) - Math.hypot(c.x - b.x, c.z - b.z))[0];
  if (target && Math.hypot(b.x, b.z) < 4) { const d = Math.hypot(target.x - b.x, target.z - b.z) || 1; x += (target.x - b.x) / d * 4; z += (target.z - b.z) / d * 4; }
  x += (rng() - 0.5) * 0.8; z += (rng() - 0.5) * 0.8;
  const d = Math.max(1, Math.hypot(x, z));
  return mem.intent = { x: x / d * 0.8, y: -z / d * 0.8 };
}
const KID_BUMPER = { kid: true };
function playBumpers(seed, skills, rngSeed = 1) {
  const n = skills.length, g = BU.init(seed, roster(n)), rng = mulberry32(seed + 2 + rngSeed), mem = skills.map(() => ({}));
  let t = 0;
  while (!g.done && t < 66) {
    t += 1 / 30;
    for (const s of g.slots) {
      const v = BU.view(g, t), i = skills[s] === KID_BUMPER ? bumperKid(v, s, mem[s], rng) : BU.bot(v, { slot: s, mem: mem[s] }, skills[s], rng);
      const a = BU.request(g, s, { x: i.x, z: -i.y, jump: false, t }, { t }); if (a.rec) BU.apply(g, a.rec);
    }
    for (const r of BU.step(g, {}, 1 / 30, t)) BU.apply(g, r);
  }
  return { g, t, placing: BU.placing(g) };
}

// Feast-Go-Round has a one-seat kid (sim80d): four bots = seat -1; the kid test takes every seat in turn
const playFeastBots = (seed, skills) => { const r = playFeast(seed, skills.diff, -1); return { g: r.g, t: r.t, placing: r.placing }; };

/** id -> { play(seed, skills, rngSeed) -> { g, t, placing }, kid } ; `skills` = one entry per seat (a bot skill from PARTY.bots, or the kid) */
export const SIMS = {
  vineskip: { play: playVine, kid: KID_VINE },
  timber: { play: playTimber, kid: KID_TIMBER },
  marlosays: { play: (seed, skills, r) => playB(MS, seed, skills, r), kid: KID_B },
  huddle: { play: (seed, skills, r) => playB(HU, seed, skills, r), kid: KID_B },
  sizzle: { play: (seed, skills, r) => playSizzle(seed, skills, r), kid: KID_C },
  eggs: { play: (seed, skills, r) => playEggs(seed, skills, r), kid: KID_C },
  feastround: { play: null, kid: null },
  bumpers: { play: playBumpers, kid: KID_BUMPER },
  glowcap: { play: (seed, skills, r) => playGlowcap(seed, skills, r), kid: KID_81A },
  cast: { play: (seed, skills, r) => playCast(seed, skills, r), kid: KID_81A },
  tilty: { play: (seed, skills, r) => playTilty(seed, skills, r), kid: KID_81B },
  bonk: { play: (seed, skills, r) => playBonk(seed, skills, r), kid: KID_81B },
};

const share = (placing, seat) => { const win = placing.filter((r) => r.place === 1); return win.some((r) => r.slot === seat) ? 1 / win.length : 0; };

/** Four bots of one difficulty, `rounds` games: the time, the cap, each seat's share of the wins, the bonus feat. */
export function soakBots(id, difficulty, rounds, seed0 = 1) {
  const sim = SIMS[id], game = getGame(id), skill = PARTY.bots[difficulty], cap = game.duration + 4;
  const out = { id, difficulty, rounds, seats: [0, 0, 0, 0], maxT: 0, sumT: 0, over: 0, notDone: 0, bonus: 0, badBonus: 0, bonusBySeat: [0, 0, 0, 0], ties: 0 };
  for (let i = 0; i < rounds; i++) {
    const seed = seed0 * 100003 + i * 7919 + 17;
    const r = id === 'feastround' ? playFeastBots(seed, { diff: difficulty }) : sim.play(seed, [skill, skill, skill, skill], i + 1);
    for (let s = 0; s < 4; s++) out.seats[s] += share(r.placing, s);
    out.maxT = Math.max(out.maxT, r.t); out.sumT += r.t;
    if (r.t > cap + 1e-6) out.over++;
    if (!r.g.done) out.notDone++;
    if (r.placing.filter((p) => p.place === 1).length > 1) out.ties++;
    const b = bonusFor(id, r.g);
    if (b) { out.bonus++; for (const s of b.slots) { if (!(s >= 0 && s < 4)) out.badBonus++; else out.bonusBySeat[s]++; } }
  }
  out.shares = out.seats.map((w) => w / rounds);
  out.avgT = out.sumT / rounds; out.cap = cap;
  return out;
}

/** The scripted kid in every seat in turn against three bots of one difficulty: the share of games it wins (ties count as wins, like the other bot tests). */
export function soakKid(id, difficulty, rounds, seed0 = 1) {
  const sim = SIMS[id], skill = PARTY.bots[difficulty];
  let win = 0;
  for (let i = 0; i < rounds; i++) {
    const seat = i % 4, seed = seed0 * 100003 + i * 7919 + 29;
    if (id === 'feastround') { win += playFeast(seed, difficulty, seat).win ? 1 : 0; continue; }
    const skills = [skill, skill, skill, skill]; skills[seat] = sim.kid;
    if (sim.play(seed, skills, i + 1).placing.find((p) => p.slot === seat).place === 1) win++;
  }
  return win / rounds;
}

/** The pass / fail rules (margin = 3 standard errors + 3 points: a quarter share is exact only in the long run). */
export function judge(bots, kid) {
  const bad = [], n = bots.rounds, tol = 0.03 + 3 * Math.sqrt(0.1875 / n);
  if (bots.over) bad.push(`${bots.over} game(s) ran past the cap (${bots.cap}s)`);
  if (bots.notDone) bad.push(`${bots.notDone} game(s) never finished`);
  bots.shares.forEach((p, s) => { if (Math.abs(p - 0.25) > tol) bad.push(`seat ${s} wins ${(p * 100).toFixed(1)}% (fair 25% +- ${(tol * 100).toFixed(1)})`); });
  if (bots.badBonus) bad.push('a bonus star went to a seat that is not playing');
  if (kid) {
    if (!(kid.easy > 0.5)) bad.push(`the kid wins only ${(kid.easy * 100).toFixed(0)}% against easy bots`);
    if (!(kid.easy >= kid.hard)) bad.push(`the kid does better against hard bots (${(kid.hard * 100).toFixed(0)}%) than easy ones (${(kid.easy * 100).toFixed(0)}%)`);
  }
  return bad;
}

export function soak({ rounds = 300, kidRounds = 120, only = null, difficulties = ['easy', 'normal'], seed = 1 } = {}) {
  const rows = [];
  for (const id of (only ? [only] : GAME_IDS)) {
    const bots = difficulties.map((d) => soakBots(id, d, rounds, seed));
    const kid = kidRounds ? { easy: soakKid(id, 'easy', kidRounds, seed), normal: soakKid(id, 'normal', kidRounds, seed), hard: soakKid(id, 'hard', kidRounds, seed) } : null;
    rows.push({ id, bots, kid, problems: bots.flatMap((b) => judge(b, null).map((m) => `${b.difficulty}: ${m}`)).concat(kid ? judge(bots[0], kid).filter((m) => m.startsWith('the kid')) : []) });
  }
  return rows;
}

if (process.argv[1] && process.argv[1].endsWith('soak80e.mjs')) {
  const rounds = Number(process.argv[2]) || 300, kidRounds = process.argv[3] !== undefined ? Number(process.argv[3]) : 120, only = process.argv[4] || null;
  const t0 = Date.now();
  const rows = soak({ rounds, kidRounds, only });
  let total = 0, bad = 0;
  console.log(`game        diff    rounds  avg s  max s   cap  over  ties  bonus  seat shares (%)             kid easy/normal/hard`);
  for (const r of rows) {
    for (const b of r.bots) {
      total += b.rounds; bad += b.over + b.notDone;
      console.log(`${r.id.padEnd(11)} ${b.difficulty.padEnd(6)} ${String(b.rounds).padStart(6)} ${b.avgT.toFixed(1).padStart(6)} ${b.maxT.toFixed(1).padStart(6)} ${b.cap.toFixed(1).padStart(5)} ${String(b.over).padStart(5)} ${String(b.ties).padStart(5)} ${(b.bonus / b.rounds * 100).toFixed(0).padStart(5)}%  ${b.shares.map((s) => (s * 100).toFixed(1).padStart(5)).join(' ')}   ${b === r.bots[0] && r.kid ? [r.kid.easy, r.kid.normal, r.kid.hard].map((x) => (x * 100).toFixed(0)).join(' / ') : ''}`);
    }
    total += r.kid ? kidRounds * 3 : 0;
  }
  const problems = rows.flatMap((r) => r.problems.map((m) => `${r.id}: ${m}`));
  console.log(`\n${total} rounds in ${((Date.now() - t0) / 1000).toFixed(1)} s; ${problems.length} problem(s)${bad ? `; ${bad} game(s) over the cap / unfinished` : ''}`);
  for (const p of problems) console.log('  PROBLEM', p);
  process.exitCode = problems.length ? 1 : 0;
}
