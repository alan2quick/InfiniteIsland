// Step 80b: Marlo Says. Pure rules (schedule, judging windows and slack, both input styles, the 40 s lie rule, ties, bot win rates per difficulty) and a host + replica pair through a whole game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PARTY } from '../public/js/config.js';
import * as MS from '../public/js/game/party/marlosaysLogic.js';
import { validateGame } from '../public/js/game/party/registry.js';
import { KID, rate, play } from './fixtures/sim80b.mjs';
import { pair } from './fixtures/partyPair.js';
import { installDom } from './fixtures/domStub.js';

installDom();

const M = PARTY.marlosays, B = PARTY.bots, GAME = MS.GAME;
const roster = [0, 1, 2, 3].map((s) => ({ slot: s, bot: false, name: 'P' + s }));
const ctx = (t) => ({ t, slack: PARTY.slack, lag: M.lag });
const other = (c) => (c === 'red' ? 'green' : 'red');

test('the game honours the contract; its schedule is deterministic, shrinking, and lies only after 40 s', () => {
  assert.deepEqual(validateGame(GAME), []);
  const a = MS.buildCalls(77);
  assert.deepEqual(a, MS.buildCalls(77)); assert.notDeepEqual(a.map((c) => c.color), MS.buildCalls(78).map((c) => c.color));
  assert.ok(a.length >= 25 && a.length <= 60, `calls ${a.length}`);
  for (let i = 1; i < a.length; i++) assert.ok(a[i].at > a[i - 1].at + a[i - 1].dur && a[i].dur <= a[i - 1].dur);
  assert.ok(a[0].dur >= 1.9 && a.at(-1).dur < 1.1, 'the beats get faster');
  assert.ok(a.at(-1).at + a.at(-1).dur < M.cap);
  const late = [];
  for (let s = 0; s < 40; s++) {
    const calls = MS.buildCalls(s);
    for (const c of calls) if (c.at < M.lieFrom) assert.deepEqual([c.who, c.lie], ['marlo', false]);
    late.push(...calls.filter((c) => c.at >= M.lieFrom));
    for (let i = 3; i < calls.length; i++) assert.ok(!(calls[i].color === calls[i - 1].color && calls[i].color === calls[i - 2].color && calls[i].color === calls[i - 3].color), 'no long streaks');
  }
  assert.ok(late.some((c) => c.lie) && late.some((c) => c.who === 'biscuit' && !c.lie) && late.every((c) => !c.lie || c.who === 'biscuit'), 'only Biscuit lies, and not always');
});

test('buttons only: Cancel (B) = red, Interact (A) = green; the stick and Jump never raise a flag (kids wander about)', () => {
  assert.equal(MS.flagFromInput({ cancelPressed: true, move: { x: 0 } }), 'red');
  assert.equal(MS.flagFromInput({ interactPressed: true, move: { x: 0 } }), 'green');
  assert.equal(MS.flagFromInput({ jumpPressed: true, move: { x: 0 } }), null);
  assert.equal(MS.flagFromInput({ move: { x: -1 } }), null);
  assert.equal(MS.flagFromInput({ move: { x: 1 } }), null);
  assert.equal(MS.flagFromInput({}), null);
  assert.deepEqual(MS.GAME.press, ['cancel', 'interact']);
});

test('judging: right colour in the window is safe, wrong is out, before / between does nothing, a stale stamp is clamped by the slack, a late press inside the lag counts', () => {
  const g = MS.init(9, roster), c0 = MS.buildCalls(9)[0];
  assert.deepEqual(MS.request(g, 0, { flag: 'red', t: c0.at - 0.3 }, ctx(c0.at - 0.3)), { ignore: true }, 'too early');
  assert.equal(MS.request(g, 0, { flag: 'blue', t: c0.at }, ctx(c0.at)).reject, 'bad-request');
  const ok = MS.request(g, 0, { flag: c0.color, t: c0.at + 0.4 }, ctx(c0.at + 0.4));
  assert.equal(ok.rec.k, 'ok'); assert.equal(ok.rec.rt, 400); MS.apply(g, ok.rec);
  assert.deepEqual(MS.request(g, 0, { flag: other(c0.color), t: c0.at + 0.5 }, ctx(c0.at + 0.5)), { ignore: true }, 'already safe: mashing is harmless');
  const bad = MS.request(g, 1, { flag: other(c0.color), t: c0.at + 0.2 }, ctx(c0.at + 0.2));
  assert.deepEqual([bad.rec.k, bad.rec.why], ['out', 'wrong']); MS.apply(g, bad.rec);
  assert.equal(MS.request(g, 1, { flag: c0.color, t: c0.at + 0.3 }, ctx(c0.at + 0.3)).reject, 'out');
  // a remote stamp from long ago is clamped into the host's recent past (ctx.t - slack), never earlier
  const g2 = MS.init(9, roster), now = c0.at + 0.1, r = MS.request(g2, 0, { flag: c0.color, t: c0.at - 5 }, ctx(now));
  assert.deepEqual(r, { ignore: true }, 'clamped to before the flag went up: too early');
  const r3 = MS.request(g2, 0, { flag: c0.color, t: c0.at + 0.1 }, ctx(c0.at + 0.1 + PARTY.slack - 0.01));
  assert.equal(r3.rec.rt, 100, 'a stamp inside the slack is trusted');
  const g3 = MS.init(9, roster), closeAt = c0.at + c0.dur;
  assert.deepEqual(MS.step(g3, ctx(closeAt + 0.1), 0.016, closeAt + 0.1), [], 'the lag keeps the call open');
  assert.equal(MS.request(g3, 2, { flag: c0.color, t: closeAt - 0.05 }, ctx(closeAt + 0.1)).rec.k, 'ok', 'a press stamped inside the window that arrives just after it');
});

test('slow = out when the call ends (plus lag); the last one dry wins; ties; everybody dry at the cap wins', () => {
  const g = MS.init(3, roster), c0 = MS.buildCalls(3)[0];
  for (const s of [0, 1, 2]) MS.apply(g, MS.request(g, s, { flag: c0.color, t: c0.at + 0.5 }, ctx(c0.at + 0.5)).rec);
  const t = c0.at + c0.dur + M.lag + 0.02, recs = MS.step(g, ctx(t), 0.016, t);
  assert.deepEqual(recs.map((r) => r.k), ['out', 'res']); assert.deepEqual([recs[0].slot, recs[0].why], [3, 'slow']);
  recs.forEach((r) => MS.apply(g, r));
  assert.equal(g.resolved, 1); assert.equal(g.alive[3], false); assert.equal(g.done, false);
  // two players, both slow: they fell in the same call = a tie for first
  const g2 = MS.init(3, roster.slice(0, 2));
  MS.step(g2, ctx(t), 0.016, t).forEach((r) => MS.apply(g2, r));
  assert.equal(g2.done, true); assert.deepEqual(MS.placing(g2).map((r) => r.place), [1, 1]);
  // one wrong, one right: the right one wins at once
  const g3 = MS.init(3, roster.slice(0, 2));
  MS.apply(g3, MS.request(g3, 1, { flag: other(c0.color), t: c0.at + 0.1 }, ctx(c0.at + 0.1)).rec);
  MS.apply(g3, MS.request(g3, 0, { flag: c0.color, t: c0.at + 0.2 }, ctx(c0.at + 0.2)).rec);
  const r3 = MS.step(g3, ctx(t), 0.016, t);
  assert.ok(r3.some((r) => r.k === 'end' && r.why === 'last')); r3.forEach((r) => MS.apply(g3, r));
  assert.deepEqual(MS.placing(g3).map((r) => [r.slot, r.place]), [[0, 1], [1, 2]]);
  // a perfect field lasts to the cap and everybody wins
  const g4 = MS.init(5, roster);
  for (let tt = 0; tt < 80 && !g4.done; tt += 1 / 60) {
    const v = MS.view(g4, tt);
    if (v.current && tt > v.current.at + 0.05) for (const s of [0, 1, 2, 3]) if (g4.ok[s] !== v.current.i) { const o = MS.request(g4, s, { flag: v.current.color, t: tt }, ctx(tt)); if (o.rec) MS.apply(g4, o.rec); }
    MS.step(g4, ctx(tt), 1 / 60, tt).forEach((r) => MS.apply(g4, r));
  }
  assert.equal(g4.done, true); assert.ok(g4.endAt >= M.cap && g4.endAt < M.cap + 0.1); assert.deepEqual(MS.placing(g4).map((r) => r.place), [1, 1, 1, 1]);
});

test('bots: never instant, fooled by a lying squawk far more on easy than on hard; the average kid beats easy bots most of the time and hard bots beat the kid', () => {
  const fooled = (skill) => {
    let n = 0, total = 0;
    for (let s = 1; s <= 30; s++) for (const c of MS.buildCalls(s).filter((x) => x.lie)) {
      const g = MS.init(s, roster), mem = {};
      let k = s * 31 + c.i; const rng = () => ((k = (k * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
      let pick = null;
      for (let t = c.at; t < c.at + c.dur && !pick; t += 1 / 60) {
        const it = MS.bot(MS.view(g, t), { slot: 0, mem }, { ...skill, miss: 0 }, rng);
        if (it.cancel) pick = 'red'; else if (it.interact) pick = 'green';
      }
      total++; if (pick === c.says) n++;
    }
    return n / total;
  };
  const e = fooled(B.easy), h = fooled(B.hard);
  assert.ok(e > h + 0.25 && e > 0.35, `easy ${e} hard ${h}`);
  const c0 = MS.buildCalls(4)[0], g = MS.init(4, roster), mem = {};
  let first = null;
  for (let t = c0.at; t < c0.at + c0.dur && first === null; t += 1 / 60) { const it = MS.bot(MS.view(g, t), { slot: 0, mem }, { ...B.hard, miss: 0 }, () => 0.5); if (it.interact || it.cancel) first = t - c0.at; }
  assert.ok(first >= 0.12, 'a bot never reacts instantly');
  const easy = rate(MS, KID, [B.easy, B.easy, B.easy], 120), hard = rate(MS, KID, [B.hard, B.hard, B.hard], 120);
  assert.ok(easy > 0.55, `the kid beats easy bots ${easy}`); assert.ok(hard < 0.3, `hard bots beat the kid ${hard}`);
  assert.deepEqual(play(MS, 5, [B.easy, B.easy]), play(MS, 5, [B.easy, B.easy]), 'deterministic from the seed');
});

test('a host + replica pair keep equal hashes through a whole game (a replica press is judged on the host from its stamp)', async () => {
  const w = pair();
  w.host.open({ games: ['marlosays'], bots: 0 }); w.flush();
  w.host.debug.play('marlosays'); w.flush();
  let pressed = 0, hostPressed = 0;
  w.run(120, 1 / 60, () => {
    const s = w.host.state;
    if (s.phase === 'play' && s.g && !s.g.done) {
      const gt = w.host.gameTime(), v = MS.view(s.g, gt);
      if (v.current && gt > v.current.at + 0.25) {
        const fl = (c) => (s.g.ok[1] !== c.i ? c.color : null);
        if (s.g.ok[w.rSlot] !== v.current.i && s.g.alive[w.rSlot]) { w.replica.act(w.rActor(), w.replica.gameTime(), { flag: v.current.i % 7 === 6 ? other(v.current.color) : v.current.color }); pressed++; }
        void fl;
        if (s.g.ok[0] !== v.current.i && s.g.alive[0]) { w.host.act(w.host.hostActor(0), gt, { flag: v.current.color }); hostPressed++; }
      }
    }
    if (s.phase === 'results') return false;
    return true;
  });
  w.flush();
  assert.ok(pressed > 3 && hostPressed > 3);
  assert.equal(w.host.state.phase, 'results'); assert.equal(w.replica.state.phase, 'results');
  assert.equal(w.replica.state.g.alive[w.rSlot], false, 'the replica fell for a wrong flag (judged on the host)');
  assert.equal(w.host.state.g.alive[0], true); assert.equal(w.host.state.results.winners.includes(0), true);
  w.equal('after the game');
  assert.deepEqual(w.replica.state.g, w.host.state.g);
});

// ---------------------------------------------------------------------------------------------------------------- music, sounds, icons, stage geometry (Step 80b)
import { createHash } from 'node:crypto';
import { Music, PARTY_TRACKS, TRACK_TITLES, getTrack, trackInfo } from '../public/js/audio/music.js';
import { Sfx } from '../public/js/audio/sfx.js';
import { ICONS } from '../public/js/ui/icons.js';
import { partyWalkable, marlosaysPads, huddlePads, stageCentre, stageSpawns, spectatorSpot } from '../public/js/game/party/partyArea.js';
import { hostFor } from '../public/js/game/party/botRoster.js';

test('Step 80b music: Signal Flags (21) and Pinecone Waltz (22) come after the 21 older tracks, whose events are pinned', () => {
  assert.equal(TRACK_TITLES.length, 33); assert.deepEqual(TRACK_TITLES.slice(21, 23), ['Signal Flags', 'Pinecone Waltz']);
  assert.deepEqual(PARTY_TRACKS, { vineskip: 19, timber: 20, marlosays: 21, huddle: 22, sizzle: 23, eggs: 24, feastround: 27, bumpers: 28, glowcap: 29, cast: 30, tilty: 31, bonk: 32 });
  const pins = { 18: '72252c4ee94b91f2f3707d905e5119d1b47c4ecb76c945de4be04d096b009b96', 19: '4d3fc0756319c61a120fdd7f5b7216e4d34db1b1c46d83aeec4679c7c5848352', 20: '2052bfd4251653b846d1a9c9bd8e6d020f403bee9995b4ab85d86d3cb11c382f',
    21: '4a63ab2d0d1fc9ac87829ae4ba3576be3f77c303998c7a66c5015f6ddee403e1', 22: '57aa4ca6c20f32589fb9e3976f509e99ada01093abdb3d4c51f36e6e87f24a97' };
  for (const [i, h] of Object.entries(pins)) assert.equal(createHash('sha256').update(JSON.stringify(getTrack(Number(i)).events)).digest('hex'), h, `track ${i}`);
  const info = trackInfo();
  assert.deepEqual([info[21].meter, info[21].bpm, info[21].bars], ['6/8', 104, 24]); assert.deepEqual([info[22].meter, info[22].bpm, info[22].bars], ['3/4', 90, 24]);
  for (const i of [21, 22]) {
    const tr = getTrack(i); assert.deepEqual(tr.events, tr.def.build().events); let prev = 0;
    for (const e of tr.events) { assert.ok(e.s >= prev && e.s < tr.steps && e.d > 0 && e.v > 0 && e.v <= 1); prev = e.s; for (const n of Array.isArray(e.m) ? e.m : [e.m]) assert.ok(Number.isFinite(n)); }
  }
  assert.ok(getTrack(21).events.some((e) => e.k === 'concertina' && Array.isArray(e.m)) && getTrack(21).events.some((e) => e.k === 'concertina' && !Array.isArray(e.m)), 'concertina stabs and lead');
  assert.ok(getTrack(22).events.some((e) => e.k === 'celesta') && getTrack(22).events.some((e) => e.k === 'timpani') && getTrack(22).events.some((e) => e.k === 'bell'), 'music box, celesta, timpani');
  const m = new Music({ onChange() {} }); m.party('marlosays'); assert.equal(m.partyTrack, 21); m.party('huddle'); assert.equal(m.partyTrack, 22);
});

test('Step 80b sounds, icons, hosts and the stage geometry', () => {
  const sfx = new Sfx();
  for (const n of ['flag', 'squawk', 'dropwhistle', 'shell']) assert.doesNotThrow(() => sfx.play(n), n);
  for (const k of ['party-marlosays', 'party-huddle']) { assert.ok(ICONS[k].startsWith('<svg') && ICONS[k].endsWith('</svg>')); assert.doesNotMatch(ICONS[k], /[\u{1F300}-\u{1FAFF}]/u); }
  assert.match(hostFor('marlosays').lines.welcome, /crew/); assert.match(hostFor('huddle').name, /Myodette/);
  for (const id of ['marlosays', 'huddle']) {
    const c = stageCentre(id); assert.ok(c.x > stageCentre('timber').x);
    for (const s of stageSpawns(id, 4)) assert.ok(partyWalkable(s.x, s.z), `${id} spawn`);
    for (let k = 0; k < 4; k++) { const s = spectatorSpot(id, k); assert.ok(partyWalkable(s.x, s.z), `${id} spectator ${k}`); }
  }
  assert.equal(marlosaysPads().length, 8); assert.equal(huddlePads().length, 8);
  assert.equal(partyWalkable(stageCentre('marlosays').x, stageCentre('marlosays').z - 8), false, 'the pool and Marlo rock are not walkable');
});
