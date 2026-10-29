// Step 86f: the polish pass. The home basalt is lighter than Emberleaf's (and Emberleaf's own rock is untouched), the home glow mushroom is a brighter glowcap sprout whose emissive factor is 0 by day and clear
// at night, Nabong's Homesteading tip rotates, the remove sound exists and every Homesteading sound stays at or below the existing jingles' loudness, the palette rows are one line, the entry toast is short.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const storage = new Map();
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: (k) => storage.delete(k) };
const ctx = new Proxy({}, { get: (t, k) => (k === 'measureText' ? () => ({ width: 10 }) : /Gradient/.test(k) ? () => ({ addColorStop() {} }) : () => {}) });
globalThis.document = { createElement: () => ({ getContext: () => ctx, style: {} }) };
globalThis.window = { addEventListener() {}, innerWidth: 800, innerHeight: 600 };
import { HOMESTEAD, DUSK_FLORA } from '../public/js/config.js';
import { assetOf, HOME_BASALT } from '../public/js/world/homesteadForeign.js';
import { getAsset as emberAsset } from '../public/js/world/islands/emberAssets.js';
import { getSmallAsset } from '../public/js/world/islands/duskSmallAssets.js';
import { nightGlow } from '../public/js/game/homesteadLogic.js';
import { HOMESTEAD_TALK } from '../public/js/game/tdoongzScript.js';
import { Sfx } from '../public/js/audio/sfx.js';
import { shapeGlyph } from '../public/js/game/homesteadShape.js';

const checksum = (geo) => { const c = geo.attributes.color; let s = 0; for (let i = 0; i < c.count; i++) s += (c.getX(i) * 3 + c.getY(i) * 5 + c.getZ(i) * 7) * ((i % 13) + 1); return s; };
const lum = (geo, only = null) => { const c = geo.attributes.color; let s = 0, n = 0; for (let i = 0; i < c.count; i++) { if (only && !only(c, i)) continue; s += 0.3 * c.getX(i) + 0.59 * c.getY(i) + 0.11 * c.getZ(i); n++; } return s / n; };

test("basalt at home is a lighter slate with a bright crack; Emberleaf's own basalt keeps its exact dark colours (cached, not mutated)", () => {
  const before = checksum(emberAsset('basalt').geo), count = emberAsset('basalt').geo.attributes.color.count;
  const home = assetOf('ember:basalt');
  assert.equal(checksum(emberAsset('basalt').geo), before, "Emberleaf's geometry colours are untouched");
  assert.equal(emberAsset('basalt').geo.attributes.color.count, count);
  assert.notEqual(home.geo, emberAsset('basalt').geo, 'the home rock is its own geometry');
  const notOrange = (c, i) => !(c.getX(i) > 0.8 && c.getZ(i) < 0.3);
  const dark = lum(emberAsset('basalt').geo), light = lum(home.geo, notOrange);
  assert.ok(dark < 0.2, "Emberleaf's is nearly black: " + dark);
  assert.ok(light > dark * 2, `the home body is much lighter (${light.toFixed(3)} vs ${dark.toFixed(3)})`);
  let orange = 0; const bc = home.geo.attributes.color;
  for (let i = 0; i < bc.count; i++) if (bc.getX(i) > 0.8 && bc.getY(i) < 0.9 && bc.getZ(i) < 0.3) orange++;
  assert.ok(orange > 60, 'a wide orange crack: ' + orange);
  const shades = new Set(); for (let i = 0; i < bc.count; i += 3) shades.add(bc.getX(i).toFixed(2));
  assert.ok(shades.size > 8, 'facets differ: ' + shades.size);
  assert.ok(HOME_BASALT.body && HOME_BASALT.cracks.length === 2);
});

// the glow program: emissive = vertex colour x per-role strength x uGlow (config DUSK_FLORA.glow; role 4 = bulb, 5 = mini)
const ROLE_K = { 4: DUSK_FLORA.glow.bulb, 5: DUSK_FLORA.glow.mini };
const emissive = (geo, glowU) => { const c = geo.attributes.color, r = geo.attributes.aRole; let best = 0, sum = 0, n = 0; for (let i = 0; i < c.count; i++) { const k = ROLE_K[r.getX(i)]; if (!k) continue; const e = Math.max(c.getX(i), c.getY(i), c.getZ(i)) * k * glowU; best = Math.max(best, e); sum += e; n++; } return { best, mean: n ? sum / n : 0, n }; };

test('the home glow mushroom: no emissive by day, a clear violet / cyan emissive at night, stronger than the marsh mushroom it replaced', () => {
  assert.equal(HOMESTEAD.kinds.glowShroom.asset, 'dusk:glowcap');
  const sprout = assetOf('dusk:glowcap').geo, marsh = getSmallAsset('mushroom').geo;
  const day = nightGlow(0), night = nightGlow(1);
  assert.equal(day, 0); assert.ok(night > 0.4);
  assert.equal(emissive(sprout, day).best, 0, 'off by day');
  const s = emissive(sprout, night), m = emissive(marsh, night);
  assert.ok(s.n > 20, 'glowing vertices: ' + s.n);
  assert.ok(s.mean > m.mean * 1.15, `brighter than the marsh mushroom (${s.mean.toFixed(3)} vs ${m.mean.toFixed(3)})`);
  assert.ok(s.best >= 0.4, 'the caps clearly glow at night: ' + s.best.toFixed(3));
  const c = sprout.attributes.color, r = sprout.attributes.aRole; let blueish = 0, pink = 0;
  for (let i = 0; i < c.count; i++) if (r.getX(i) === 4 && c.getZ(i) > 0.8) { if (c.getZ(i) >= c.getX(i)) blueish++; else pink++; }
  assert.ok(blueish > 0 && pink === 0, 'violet / cyan family, never pink: ' + blueish + '/' + pink);
  assert.ok(night <= 0.7, 'still soft');
});

test("Nabong's Homesteading tip rotates through four short tips in her voice, in order, wrapping round", () => {
  const T = HOMESTEAD_TALK;
  assert.equal(T.tips.length, 4);
  const seen = [0, 1, 2, 3, 4, 5].map((n) => T.tipRow(n));
  assert.deepEqual(seen[4].pages, seen[0].pages, 'wraps');
  assert.equal(new Set(seen.slice(0, 4).map((r) => r.pages.join('|'))).size, 4, 'four different tips');
  for (const row of seen) { assert.ok(row.id && row.label === 'Homesteading' && row.icon); assert.ok(row.pages.length >= 1 && row.pages.length <= 3); for (const p of row.pages) assert.ok(p.length < 330, 'short pages'); }
  const all = T.tips.flat().join(' ');
  assert.match(all, /watering can/i); assert.match(all, /leaves/i); assert.match(all, /bridge or a boat/i); assert.match(all, /Decorations/); assert.match(all, /carrots/i);
  assert.ok(!/[^\x00-\x7f]/.test(JSON.stringify(T.tips)), 'plain ASCII');
  assert.equal(T.tipRow(-1).pages, T.tips[3]); assert.equal(T.tipRow(NaN).pages, T.tips[0]);
});

function fakeAudio() {
  const made = { tones: [], noise: [] };
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {} });
  const node = () => ({ connect(o) { return o; }, start() {}, stop() {}, frequency: param(), gain: param(), Q: param() });
  const c = { currentTime: 0, sampleRate: 8000, state: 'running', destination: {}, createOscillator: node, createGain: node, createBiquadFilter: node, createBufferSource: node, createBuffer: () => ({ getChannelData: () => new Float32Array(8000) }) };
  const sfx = new Sfx(); sfx.ctx = c; sfx.master = { gain: { value: 1 } };
  const t = sfx._tone.bind(sfx), n = sfx._noise.bind(sfx), w = sfx._sweep.bind(sfx);
  sfx._tone = (type, f0, f1, dur, vol, delay = 0) => { made.tones.push({ vol, delay }); t(type, f0, f1, dur, vol, delay); };
  sfx._noise = (dur, vol, o) => { made.noise.push({ vol }); n(dur, vol, o); };
  sfx._sweep = (dur, vol, ...rest) => { made.noise.push({ vol }); w(dur, vol, ...rest); };
  return { sfx, made };
}
const voices = (name) => { const a = fakeAudio(); a.sfx.play(name); return [...a.made.tones, ...a.made.noise].map((v) => v.vol); };

test("sounds: a soft remove poof exists; every Homesteading voice is at or below the feast jingle's loudest note (0.17) and none sums past 0.6", () => {
  const jMax = Math.max(...voices('jingle'));
  assert.ok(Math.abs(jMax - 0.17) < 1e-9);
  const poof = voices('poof'); assert.ok(poof.length >= 2, 'the poof is built'); assert.ok(Math.max(...poof) <= 0.1, 'soft');
  for (const name of ['plant', 'poof', 'pour', 'sproutgrow', 'treegrow']) {
    const v = voices(name);
    assert.ok(v.length > 0, name + ' plays something');
    assert.ok(Math.max(...v) <= jMax, `${name}: loudest voice ${Math.max(...v)} <= ${jMax}`);
    assert.ok(v.reduce((a, b) => a + b, 0) <= 0.6, `${name}: all voices together ${v.reduce((a, b) => a + b, 0).toFixed(2)}`);
  }
  assert.ok(Math.max(...voices('pour')) <= 0.12, 'the pour is a gentle hiss');
});

test('the entry toast is short and the palette rows stay on one line (the CSS keeps pips beside the chips)', () => {
  const toast = `Homesteading! ${shapeGlyph('keyboard').key}: plant or remove`;
  assert.ok(toast.length <= 34, toast);
  const css = readFileSync(new URL('../public/css/game.css', import.meta.url), 'utf8');
  assert.match(css, /\.hud-choice:has\(\.hc-pips\)\s*\{[^}]*flex-wrap:\s*nowrap/);
  assert.match(css, /\.hud-choice:has\(\.hc-pips\) \.hc-label\s*\{[^}]*min-width:\s*0/);
  const dlg = readFileSync(new URL('../public/js/ui/dialog.js', import.meta.url), 'utf8');
  assert.match(dlg, /keepScroll/, 'a re-render keeps the scroll and brings the selected row into view');
});
