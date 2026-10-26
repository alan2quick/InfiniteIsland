// Feast-Go-Round (Step 80d): pure host-owned floating plates, immediate Interact grab / chew, and pepper recovery.
// init(seed, roster), step(g, ctx, dt, t), request(g, slot, req, ctx), apply(g, rec), view(g,t), placing(g), bot().
// dishPose is the single source for drawn and judged positions. Four rotational copies of each wave give every seat
// the same menu and first opportunity; people walk freely INSIDE the counter. Grabs use real position, reach and facing. Reverse is continuous at half time.
import { PARTY } from '../../config.js';
import { RECIPES } from '../catalog.js';
import { stageCentre } from './partyArea.js';
import { mulberry32 } from '../../utils/rng.js';
const F = PARTY.feastround, TAU = Math.PI * 2;
export const ID = 'feastround';
export const seatAngle = (seat) => Math.PI / 4 + seat * TAU / 4;
export const flowAt = (t) => F.speed * (t <= F.duration / 2 ? t : F.duration - t);
export const recipeValue = (r) => Math.max(1, Math.min(5, Object.values(r.needs).reduce((a,b) => a+b, 0)));
export function buildDishes(seed) {
  const rng = mulberry32(seed), menu = RECIPES.map((r) => ({ dish: r.dish, value: recipeValue(r), kind: 'dish' }));
  for (let i = menu.length - 1; i > 0; i--) { const j = Math.floor(rng()*(i+1)); [menu[i],menu[j]]=[menu[j],menu[i]]; }
  menu.splice(4, 0, { dish: 'chilli', value: 0, kind: 'pepper' });
  menu.splice(12, 0, { dish: 'chilli', value: 0, kind: 'pepper' });
  menu.splice(7 + Math.floor(rng()*4), 0, { dish: 'lantern-supper', value: 10, kind: 'gold' });
  return menu.flatMap((d, wave) => Array.from({ length: 4 }, (_, seat) => {
    const t0 = wave * F.gap, dir = t0 < F.duration/2 ? 1 : -1;
    return { ...d, id: wave*4+seat, t0, angle: seatAngle(seat) - dir*0.45, chews: d.kind === 'pepper' ? 0 : 2+d.value };
  }));
}
export function dishPose(d, t) {
  const angle = d.angle + flowAt(t) - flowAt(d.t0);
  return { x: Math.cos(angle)*F.radius, z: Math.sin(angle)*F.radius, y: 0.9, angle, visible: t >= d.t0 && t < d.t0+F.life && t < F.duration };
}
/** Host positions / bot bodies are world coordinates; dishPose and the shared grab helper are stage-local. */
export function localActor(p, face = p?.face ?? p?.facing ?? 0) {
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z) || !Number.isFinite(face)) return null;
  const c = stageCentre(ID);
  return { x: p.x - c.x, z: p.z - c.z, face };
}

/** The nearest visible dish in the player's forward reach. There is deliberately no seat-based fallback. */
export function dishInFront(g, slot, t, actor) {
  if (!g.slots.includes(slot) || !actor || Math.hypot(actor.x, actor.z) > F.walkR + 0.02) return null;
  let best = null, distance = F.reach;
  for (const d of g.dishes) {
    if (g.taken[d.id]) continue;
    const p = dishPose(d, t), dx = p.x - actor.x, dz = p.z - actor.z, dist = Math.hypot(dx, dz);
    const forward = (dx * Math.sin(actor.face) + dz * Math.cos(actor.face)) / (dist || 1);
    if (p.visible && dist <= distance && forward >= F.frontDot) { best = d; distance = dist; }
  }
  return best;
}
export function init(seed, roster) {
  const slots=roster.map((r)=>r.slot);
  return { seed: seed>>>0, slots, dishes: buildDishes(seed), taken: {}, plates: Object.fromEntries(slots.map((s)=>[s,null])), scores: Object.fromEntries(slots.map((s)=>[s,0])), hotUntil: {}, eaten: {}, done:false, endAt:null };
}
export function step(g, ctx, dt, t) { return !g.done && t >= F.duration ? [{k:'end',t:F.duration}] : []; }
export function request(g,slot,req,ctx) {
  const t = Math.max(ctx.t - (ctx.slack || 0), Math.min(ctx.t, Number.isFinite(req.t) ? req.t : ctx.t)); // Judge the displayed plate at the stamped press, with the existing party slack.
  if (g.done || t < 0 || t >= F.duration || !g.slots.includes(slot)) return {ignore:true};
  if (t < (g.hotUntil[slot] || 0)) return {rec:{k:'fan',slot,t}};
  if (g.plates[slot]) return {rec:{k:'chew',slot,t}};
  const actor = localActor(ctx.pos?.(slot), req.face ?? ctx.pos?.(slot)?.face);
  const d=dishInFront(g,slot,t,actor);
  return d ? {rec:{k:'grab',slot,id:d.id,t}} : {rec:{k:'reach',slot,t}};
}
export function apply(g,r) {
  if (r.k==='grab') {
    const d=g.dishes.find((d)=>d.id===r.id);
    if (!d || g.taken[d.id] || g.plates[r.slot]) return g;
    g.taken[d.id]=true;
    if (d.kind==='pepper') g.hotUntil[r.slot]=r.t+F.pepperTime;
    else g.plates[r.slot]={id:d.id,dish:d.dish,value:d.value,left:d.chews};
  } else if (r.k==='chew' && g.plates[r.slot]) {
    const p=g.plates[r.slot]; p.left--;
    if (p.left<=0) {g.scores[r.slot]+=p.value; g.plates[r.slot]=null; g.eaten ||= {}; g.eaten[r.slot]=(g.eaten[r.slot]||0)+1;}      // (eaten: Step 80e's bonus feat, "Most dishes")
  } else if (r.k==='score') g.scores[r.slot]=r.score;
  else if (r.k==='end') {g.done=true;g.endAt=r.t;}
  return g;
}
export const view=(g,t=0)=>({...g,t, direction:t < F.duration/2 ? 1 : -1});
export function placing(g) { return g.slots.map((slot)=>({slot,score:g.scores[slot],place:1+g.slots.filter((s)=>g.scores[s]>g.scores[slot]).length,out:false})); }
export function bot(v, me, skill, rng) {
  if (v.done || v.t < (v.hotUntil[me.slot] || 0)) return {};
  const m = me.mem, actor = localActor(me, me.face ?? 0);
  if (!actor) return {};
  if (m.feastSeed !== v.seed || v.t < (m.feastT || 0)) { m.feastSeed = v.seed; m.feastNext = 0; m.feastThink = 0; }
  m.feastT = v.t;
  const plate = v.plates[me.slot], interval = skill.react <= 0.2 ? 0.13 : skill.react > 0.4 ? 0.7 : 0.34;
  const intent = { x: 0, y: 0 };
  if (!plate) {
    if (v.t >= (m.feastThink || 0)) {
      m.feastThink = v.t + skill.react;
      let best = null, distance = Infinity;
      for (const d of v.dishes) {
        const p = dishPose(d, v.t);
        if (!p.visible || v.taken[d.id] || (d.kind === 'pepper' && rng() > skill.miss)) continue;
        const dist = Math.hypot(p.x - actor.x, p.z - actor.z);
        if (dist < distance) { best = d; distance = dist; }
      }
      m.feastTarget = best?.id;
      m.feastAimNoise = (rng() - 0.5) * skill.noise;
    }
    const d = v.dishes.find(d => d.id === m.feastTarget);
    if (d && !v.taken[d.id]) {
      const p = dishPose(d, v.t + skill.react * 0.4), a = p.angle + (m.feastAimNoise || 0);
      // Aim just beyond the inner floor: blocked outward movement still turns the player toward their food.
      const dx = Math.cos(a) * (F.walkR + 0.25) - actor.x, dz = Math.sin(a) * (F.walkR + 0.25) - actor.z;
      const n = Math.hypot(dx, dz) || 1, pace = 0.5 + skill.walk * 0.5;
      intent.x = dx / n * pace; intent.y = -dz / n * pace;
    }
  }
  if (v.t >= (m.feastNext || 0)) {
    const d = dishInFront(v, me.slot, v.t, actor);
    if (plate || (d && (d.kind !== 'pepper' || rng() < skill.miss))) {
      intent.interact = true; m.feastNext = v.t + interval * (0.9 + rng() * 0.2);
    }
  }
  return intent;
}
export const debugWin=(g,slot)=>[{k:'score',slot,score:Math.max(...Object.values(g.scores))+10}];
export const GAME={id:ID,name:'Feast-Go-Round',host:'Son Chaetty',stage:ID,track:ID,players:[1,4],kind:'ffa',duration:F.duration,tail:F.tail,
  howto:{pitch:'A little nap, then a feast! Walk inside the ring. Press to grab a dish in front of you at the counter. Keep pressing to chew. Leave the red peppers alone! The water turns round halfway.',buttons:['stick','interact'],verbs:{stick:'Walk to dishes',interact:'Grab / chew'}},press:['interact'],lag:0,
  init,step,request,apply,view,placing,bot,debugWin};
