import { PARTY } from '../../public/js/config.js';
import { mulberry32 } from '../../public/js/utils/rng.js';
import * as MS from '../../public/js/game/party/marlosaysLogic.js';
import * as HU from '../../public/js/game/party/huddleLogic.js';
export const KID = { react: 0.55, noise: 0.12, miss: 0.06, fool: 0.15, shell: { lead: 0.33, after: 0.28 } };
// one whole game on the real rules; skills[slot]; returns placing
export function play(G, seed, skills, rngSeed = 1) { return playFull(G, seed, skills, rngSeed).placing; }
// (Step 80e: the soak also wants the final state and the time the game ended)
export function playFull(G, seed, skills, rngSeed = 1) {
  const roster = skills.map((_, i) => ({ slot: i, bot: true, name: 'b' + i }));
  const g = G.init(seed, roster), rng = mulberry32(rngSeed), mems = skills.map(() => ({}));
  const hold = skills.map(() => false), dt = 1 / 60, mem = {}; let t = 0;
  const emit = (recs) => recs.forEach((r) => G.apply(g, r));
  for (let n = 0; n < 60 * 90 && !g.done; n++) {
    t += dt;
    emit(G.step(g, { t, slack: PARTY.slack, lag: G.GAME.lag, pos: () => null }, dt, t));
    if (g.done) break;
    const v = G.view(g, t);
    skills.forEach((sk, slot) => {
      const it = G.bot(v, { slot, mem: mems[slot] }, sk, rng);
      if (G.GAME.id === 'marlosays') {
        const flag = MS.flagFromInput({ interactPressed: it.interact, cancelPressed: it.cancel });
        if (flag) { const o = G.request(g, slot, { flag, t }, { t }); if (o.rec) G.apply(g, o.rec); }
      } else {
        const on = !!(it.hold && it.hold.interact);
        if (on !== hold[slot]) { hold[slot] = on; const o = G.request(g, slot, { on, t }, { t }); if (o.rec) G.apply(g, o.rec); }
      }
    });
  }
  return { g, t, placing: G.placing(g) };
}
export const rate = (G, mine, others, n = 200) => { let win = 0; for (let i = 0; i < n; i++) { const p = play(G, 1000 + i * 7919, [mine, ...others], i + 1); if (p.find((r) => r.slot === 0).place === 1) win++; } return win / n; };
if (process.argv[1].endsWith('sim80b.mjs')) {
  const B = PARTY.bots;
  for (const [name, G] of [['marlosays', MS], ['huddle', HU]]) {
    console.log(name, 'kid vs easy', rate(G, KID, [B.easy, B.easy, B.easy]), 'kid vs normal', rate(G, KID, [B.normal, B.normal, B.normal]), 'kid vs hard', rate(G, KID, [B.hard, B.hard, B.hard]));
  }
}
