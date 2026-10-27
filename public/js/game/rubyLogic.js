// The Shell Ladder: pure, action-only rules. Quest shells live here, never in the shared bag.
import { RUBY } from '../config.js';
export const STAGES = ['thief', 'whelk', 'turban', 'coconut', 'conch', 'home', 'befriended'];
export const SHELLS = ['cap', 'whelk', 'turban', 'coconut', 'conch', 'home'];
const integer = (n, max) => Math.max(0, Math.min(max, Math.floor(Number(n)) || 0));
export const freshState = () => ({ stage: 0, homeReady: false, shell: null, coconut: false, coconutHits: 0, crustHits: 0 });
export function normaliseState(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}, stage = integer(r.stage, 6);
  return { stage, homeReady: stage === 5 && r.homeReady === true, shell: (stage === 1 && r.shell === 'whelk') || (stage === 2 && r.shell === 'turban') || (stage === 4 && r.shell === 'conch') ? r.shell : null,
    coconut: stage === 3 && r.coconut === true, coconutHits: stage === 3 && r.coconut === true ? integer(r.coconutHits, RUBY.coconutHits - 1) : 0,
    // Crust work uses twelve units: hammer +3, axe/sword +2. Mixed tools cannot shorten the requirement.
    crustHits: stage === 4 ? integer(r.crustHits, RUBY.crustWork) : 0 };
}
export const savedView = normaliseState;
export const debugState = (stage) => normaliseState({ stage });
export const shellOf = (s) => SHELLS[Math.max(0, Math.min(5, s.stage - 1))];
export const sizeOf = (s) => RUBY.sizes[Math.max(0, Math.min(5, s.stage - 1))];
export const requestSpot = (s, kind) => kind === 'dig' ? 'dig' : kind === 'hop' ? 'goal' : kind === 'crust' ? 'crust' : kind === 'hearth' || s.stage >= 5 ? 'hearth' : s.stage === 0 ? 'thief' : 'pool';
export function validateRequest({ state: s, kind, open, busy = false, tool = null, dist = Infinity, remote = false, have = () => 0 }) {
  if (!open) return 'locked';
  if (busy) return 'busy';
  const expected = { sight: 0, dig: 1, hop: 2, coconut: 3, hit: 3, crust: 4, hearth: 5 };
  if (kind === 'offer' ? ![1, 2, 4].includes(s.stage) : expected[kind] === undefined || s.stage !== expected[kind]) return 'stage';
  const range = (kind === 'sight' ? RUBY.sight : RUBY.reach) + (remote ? RUBY.remoteSlack : 0);
  if (!Number.isFinite(dist) || dist > range) return 'far';
  if (kind === 'dig' && tool !== 'shovel') return 'tool';
  if (kind === 'hit' && !['axe', 'hammer'].includes(tool)) return 'tool';
  if (kind === 'crust' && !Object.hasOwn(RUBY.crustHits, tool)) return 'tool';
  if (kind === 'offer' && s.shell !== ({ 1: 'whelk', 2: 'turban', 4: 'conch' })[s.stage]) return 'shell';
  if ((kind === 'dig' || kind === 'hop') && s.shell) return 'taken';
  if (kind === 'hearth' && s.homeReady) return 'taken';
  if (kind === 'coconut' && s.coconut) return 'taken';
  if (kind === 'hit' && !s.coconut) return 'coconut';
  if (kind === 'crust' && s.shell) return 'taken';
  const need = kind === 'coconut' ? { coconut: 1 } : kind === 'hearth' ? RUBY.gifts : {};
  if (!Object.entries(need).every(([id, n]) => have(id) >= n)) return 'items';
  return null;
}
// Call only after validation. Every transition returns a new canonical state.
export function applyRequest(s, kind, tool) {
  let n = { ...s };
  if (kind === 'sight' || kind === 'offer') n = { ...freshState(), stage: s.stage + 1 };
  if (kind === 'hearth') n.homeReady = true;
  if (kind === 'dig') n.shell = 'whelk';
  if (kind === 'hop') n.shell = 'turban';
  if (kind === 'coconut') n.coconut = true;
  if (kind === 'hit') { n.coconutHits++; if (n.coconutHits >= RUBY.coconutHits) n = { ...freshState(), stage: 4 }; }
  if (kind === 'crust') { n.crustHits = Math.min(RUBY.crustWork, n.crustHits + RUBY.crustWork / RUBY.crustHits[tool]); if (n.crustHits >= RUBY.crustWork) n.shell = 'conch'; }
  return normaliseState(n);
}
