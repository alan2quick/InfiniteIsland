// Background music: synthesized home, regional and ritual-area tracks. No audio files.
//
//   const music = new Music(sfx);       // uses sfx.ctx / sfx.master once the first gesture has unlocked them
//   music.start();                      // lazy: polls until the AudioContext runs, then plays track 1 (Morning Breeze)
//   music.enabled / setEnabled(b) / toggle()     // persisted in localStorage ('infiniteIsland.music'), default on
//   music.duck(0.4, 0.6) / music.unduck(1.5)     // feast scene: lower the music while it plays
//   music.current (title) / currentIndex / music.next() / music.on('track' | 'enabled', fn)
//   music.stats  { notes: [n per track], total, resyncs }   // scheduler counters (debug)
//   music.renderTrack(i, seconds)       // debug: render a track offline -> { peak, rms, ... } (levels before the bus)
//   music.party(id | null) / music.setTempo(k)   // Step 80a: a party game's own track from bar 1 (null = back to the region's) and its tempo scale; tracks 18..26 = Glade Jamboree, Vine Skip, Timber Trim, Signal Flags, Pinecone Waltz, Fuse Box, Henhouse Polka, Sunny Skip, Bubblegum Shuffle (the lobby rotates 18 / 25 / 26)
//
// Layout:  instruments (voice functions) -> per-instrument bus (+ reverb send) -> Engine.fade -> soft compressor -> music bus (0.3) -> sfx.master
// so the global M mute silences the music too. One Engine per track (a clean cut between tracks / after a pause). A look-ahead scheduler
// (25 ms timer, 0.15 s ahead) walks the track's pre-generated event list; the music pauses while the tab is hidden, the sound is muted or the
// music is off, and resumes from the start of the bar it stopped in.
import { DUSK_MUSIC } from '../config.js';
import { mulberry32 } from '../utils/rng.js';

const STORE_KEY = 'infiniteIsland.music';
const MUSIC_VOL = 0.3;          // the music bus (under the sfx, which go straight to the master)
const LOOKAHEAD = 0.15;         // seconds scheduled ahead
const TICK_MS = 25;
const FADE_IN = 2.5;            // seconds
const FADE_OUT = 3.0;           // seconds before a track's end
const GAP = 3.0;                // quiet seconds between tracks
const STEPS_PER_BAR = 16;       // 16th-note grid, 4/4

// ------------------------------------------------------------------------------------------------ theory helpers
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const QUAL = {
  maj: [0, 4, 7], min: [0, 3, 7], maj7: [0, 4, 7, 11], min7: [0, 3, 7, 10], dom7: [0, 4, 7, 10],
  sus2: [0, 2, 7], sus4: [0, 5, 7], add9: [0, 4, 7, 14], min9: [0, 3, 7, 10, 14],
};
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
/** chord('Bb', 'maj7') -> { pc, iv, pcs } (root as a pitch class, intervals, pitch classes). */
function chord(name, q = 'maj') {
  let pc = PC[name[0]];
  if (name[1] === 'b') pc -= 1; else if (name[1] === '#') pc += 1;
  pc = (pc + 12) % 12;
  const iv = QUAL[q];
  return { pc, iv, pcs: iv.map((i) => (pc + i) % 12) };
}
/** All midi notes in [lo, hi] that are chord tones. */
function ladder(ch, lo, hi) { const out = []; for (let m = lo; m <= hi; m++) if (ch.pcs.includes(m % 12)) out.push(m); return out; }
function scaleLadder(keyPc, scale, lo, hi) {
  const pcs = scale.map((i) => (keyPc + i) % 12), out = [];
  for (let m = lo; m <= hi; m++) if (pcs.includes(m % 12)) out.push(m);
  return out;
}
/** n ascending chord tones starting at the first chord tone >= lo. */
function voiceUp(ch, lo, n) { const out = []; for (let m = lo; out.length < n; m++) if (ch.pcs.includes(m % 12)) out.push(m); return out; }
const pcAt = (pc, lo) => { let m = lo; while (m % 12 !== pc) m++; return m; };
function nearestIdx(arr, target) {
  let best = 0, bd = Infinity;
  for (let i = 0; i < arr.length; i++) { const d = Math.abs(arr[i] - target); if (d < bd) { bd = d; best = i; } }
  return best;
}

// ------------------------------------------------------------------------------------------------ melody generator
// A theme is a couple of one-bar motifs (rhythm + contour). Every 4-bar phrase plays motif 1, motif 2, motif 1 (higher) and a cadence, so the
// tune is recognisable and identical on every play (seeded). Strong beats land on chord tones; in-between notes step along the scale.
function makeMotif(rng, rhythm) {
  let dir = rng() < 0.5 ? 1 : -1;
  return rhythm.map(([at, len], i) => {
    const strong = i === 0 || (at % 4 === 0 && len >= 2) || len >= 4;
    if (strong) return { at, len, c: true, v: i === 0 ? 0 : [0, 0, 1, -1, 1, 2][Math.floor(rng() * 6)] };
    if (rng() < 0.3) dir = -dir;
    return { at, len, c: false, v: dir * (rng() < 0.25 ? 2 : 1) };
  });
}

class Melody {
  constructor(seed, key, cfg) {
    this.rng = mulberry32(seed);
    this.key = key; this.cfg = cfg;
    this.S = scaleLadder(key.pc, key.scale, cfg.lo - 4, cfg.hi + 4);
    this.themes = {};
    for (const name of ['A', 'B']) {
      const rng = this.rng, list = cfg.rhythms[name].slice();
      for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
      const pick = (a) => a[Math.floor(rng() * a.length)];
      this.themes[name] = {
        m1: makeMotif(rng, list[0]),
        m2: makeMotif(rng, list[1]),
        cad: makeMotif(rng, pick(cfg.cadences)),
        contour: [[0, pick([2, 3, -2]), pick([4, 5, 3]), 0], [0, pick([3, -3, 2]), pick([5, 4, 2]), -2]],
        cadOff: [2, -1],
      };
    }
  }

  /** Notes [{at, len, midi}] of bar `b` (0-based) of a `nbars` section of theme `name` over chord `ch`. */
  bar(ch, name, b, nbars, { lift = 0, final = false } = {}) {
    const th = this.themes[name], { lo, hi, center } = this.cfg;
    const k = b % 4, ph = Math.floor(b / 4);
    const L = ladder(ch, lo, hi), S = this.S;
    const endBar = final && b === nbars - 1;
    let motif, tgt;
    if (endBar) { motif = [{ at: 0, len: 14, c: true, v: 0 }]; tgt = center; }
    else if (k === 3) { motif = th.cad; tgt = center + th.cadOff[ph % 2]; }
    else { motif = k === 1 ? th.m2 : th.m1; tgt = center + th.contour[ph % 2][k]; }
    tgt += lift;
    let ai;
    if (endBar) { const roots = L.filter((m) => m % 12 === ch.pc); ai = L.indexOf(roots[nearestIdx(roots, tgt)]); }
    else ai = nearestIdx(L, tgt);
    const out = [];
    let prev = L[ai];
    for (const n of motif) {
      let midi;
      if (n.c) {
        midi = L[clamp(ai + n.v, 0, L.length - 1)];
        if (out.length && Math.abs(midi - prev) > 7) midi = L[nearestIdx(L, prev + Math.sign(midi - prev) * 5)];     // no big leaps: pull to a nearer chord tone
      }
      else midi = S[clamp(nearestIdx(S, prev) + n.v, 0, S.length - 1)];
      prev = midi;
      out.push({ at: n.at, len: n.len, midi });
    }
    return out;
  }
}

// ------------------------------------------------------------------------------------------------ voices
// Every voice: (engine, t, midi, durSeconds, velocity, outputNode, opts). Short-lived oscillators only; all stopped explicitly.
function env(g, t, peak, atk, ring, mid = 0.25) {          // plucky two-stage decay
  g.setValueAtTime(0.0001, t);
  g.linearRampToValueAtTime(peak, t + atk);
  g.exponentialRampToValueAtTime(Math.max(0.0002, peak * mid), t + ring * 0.3);
  g.exponentialRampToValueAtTime(0.0001, t + ring);
}

const VOICES = {
  // Step 80d: narrow, breathy muted brass; the filter keeps the swing lead friendly on phone speakers.
  mutedTrumpet(e, t, m, dur, vel, out) {
    const c=e.ctx, os=c.createOscillator(), lp=c.createBiquadFilter(), g=c.createGain();
    os.type='sawtooth'; os.frequency.value=mtof(m); lp.type='bandpass'; lp.frequency.value=1100; lp.Q.value=1.1;
    env(g.gain,t,vel,0.035,Math.max(0.22,dur),0.65);os.connect(lp).connect(g).connect(out);os.start(t);os.stop(t+Math.max(0.22,dur)+0.05);
  },
  glassMarimba(e, t, m, dur, vel, out, o) {
    const c=e.ctx, os=c.createOscillator(), partial=c.createOscillator(), lfo=c.createOscillator(), lg=c.createGain(), g=c.createGain(), pg=c.createGain();
    os.type='sine';partial.type='sine';os.frequency.value=mtof(m);partial.frequency.value=mtof(m)*2.76;
    lfo.frequency.value=5.2;lg.gain.value=16;lfo.connect(lg).connect(os.detune);
    env(g.gain,t,vel,0.003,0.9,0.2);env(pg.gain,t,vel*0.25,0.002,0.35,0.1);
    os.connect(g).connect(out);partial.connect(pg).connect(out);[os,partial,lfo].forEach(n=>{n.start(t);n.stop(t+1);});
  },
  // Glassy canopy pad: sine partials, breathing filter and optional reverse swell.
  glasspad(e, t, notes, dur, vel, out, o) {
    const c = e.ctx, lp = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    const atk = o.reverse ? Math.max(0.5, dur * 0.85) : 1.7, rel = 2.8, end = t + dur + rel;
    lp.type = 'lowpass'; lp.frequency.value = 950; lp.Q.value = 0.7;
    lfo.frequency.value = 0.13; lg.gain.value = 420; lfo.connect(lg).connect(lp.frequency);
    lp.connect(g).connect(out);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + atk);
    g.gain.setValueAtTime(vel, t + Math.max(atk, dur)); g.gain.linearRampToValueAtTime(0.0001, end);
    for (const m of notes) for (const det of [-5, 5]) {
      const os = c.createOscillator(), gain = c.createGain(); os.type = 'sine'; os.frequency.value = mtof(m); os.detune.value = det;
      gain.gain.value = 0.5 / notes.length; os.connect(gain).connect(lp); os.start(t); os.stop(end + 0.05);
    }
    lfo.start(t); lfo.stop(end + 0.05);
  },
  // Theremin: continuous pitch glide from the previous note, slow vibrato, no breath transient.
  theremin(e, t, m, dur, vel, out, o) {
    const c = e.ctx, os = c.createOscillator(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
    os.type = 'sine'; os.frequency.setValueAtTime(mtof(o.from ?? m), t);
    os.frequency.exponentialRampToValueAtTime(mtof(m), t + Math.min(dur * 0.45, 1.2));
    lfo.frequency.value = 3.1; lg.gain.value = 17; lfo.connect(lg).connect(os.detune);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + 0.5);
    g.gain.setValueAtTime(vel, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.8);
    os.connect(g).connect(out); os.start(t); lfo.start(t); os.stop(t + dur + 0.85); lfo.stop(t + dur + 0.85);
  },
  // A water drop, deliberately high and tiny rather than a drum kick.
  plip(e, t, m, dur, vel, out) {
    const c = e.ctx, os = c.createOscillator(), g = c.createGain(); os.type = 'sine';
    os.frequency.setValueAtTime(mtof(m) * 2.4, t); os.frequency.exponentialRampToValueAtTime(mtof(m), t + 0.065);
    env(g.gain, t, vel, 0.002, 0.23, 0.13); os.connect(g).connect(out); os.start(t); os.stop(t + 0.28);
  },
  drone(e, t, m, dur, vel, out) {
    const c = e.ctx, os = c.createOscillator(), g = c.createGain(); os.type = 'sine'; os.frequency.value = mtof(m);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + 1.3);
    g.gain.setValueAtTime(vel, t + dur); g.gain.linearRampToValueAtTime(0.0001, t + dur + 2);
    os.connect(g).connect(out); os.start(t); os.stop(t + dur + 2.05);
  },

  // ukulele / nylon-guitar-ish pluck: triangle + a little saw through a low-pass that closes quickly
  pluck(e, t, m, dur, vel, out, o) {
    const c = e.ctx, f = mtof(m), ring = o.ring || 0.9, gentle = o.gentle === true;
    const lp = c.createBiquadFilter(), g = c.createGain(), gs = c.createGain();
    lp.type = 'lowpass'; lp.Q.value = 0.5;
    lp.frequency.setValueAtTime(Math.min(f * (o.bright || (gentle ? 3 : 6)), gentle ? 1800 : 4200), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.5, 350), t + ring * 0.35);
    const a = c.createOscillator(), b = c.createOscillator();
    a.type = gentle ? 'sine' : 'triangle'; b.type = gentle ? 'triangle' : 'sawtooth';
    a.frequency.value = f; b.frequency.value = f * 1.004;
    gs.gain.value = gentle ? 0.06 : 0.26;
    a.connect(lp); b.connect(gs); gs.connect(lp); lp.connect(g); g.connect(out);
    env(g.gain, t, vel * (gentle ? 0.55 : 1), gentle ? 0.045 : 0.004, ring);
    a.start(t); b.start(t); a.stop(t + ring + 0.05); b.stop(t + ring + 0.05);
  },
  // marimba / mallet: sine + a fast-decaying overtone
  marimba(e, t, m, dur, vel, out, o) {
    const c = e.ctx, f = mtof(m), ring = clamp(1.1 * Math.pow(262 / f, 0.35), 0.35, 1.3) * (o.ring || 1);
    const a = c.createOscillator(), b = c.createOscillator(), ga = c.createGain(), gb = c.createGain();
    a.type = 'sine'; b.type = 'sine'; a.frequency.value = f; b.frequency.value = f * 3.93;
    env(ga.gain, t, vel, 0.003, ring, 0.2);
    gb.gain.setValueAtTime(0.0001, t); gb.gain.linearRampToValueAtTime(vel * 0.32, t + 0.002); gb.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    a.connect(ga).connect(out); b.connect(gb).connect(out);
    a.start(t); b.start(t); a.stop(t + ring + 0.05); b.stop(t + 0.12);
  },
  // electric piano: FM pair, the modulation index dies away fast (tine) while the body rings
  ep(e, t, m, dur, vel, out, o) {
    const c = e.ctx, f = mtof(m), ring = o.ring || 2.2, idx = o.index || 1.5;
    const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain(), lp = c.createBiquadFilter();
    car.type = 'sine'; mod.type = 'sine'; car.frequency.value = f; mod.frequency.value = f * (o.ratio || 1);
    mg.gain.setValueAtTime(f * idx, t); mg.gain.exponentialRampToValueAtTime(f * idx * 0.04, t + 0.45);
    lp.type = 'lowpass'; lp.frequency.value = 3400; lp.Q.value = 0.3;
    mod.connect(mg).connect(car.frequency);
    car.connect(g); g.connect(lp).connect(out);
    env(g.gain, t, vel, 0.006, ring, 0.3);
    car.start(t); mod.start(t); car.stop(t + ring + 0.05); mod.stop(t + ring + 0.05);
  },
  // music box / glass bell: inharmonic FM, bright but short
  bell(e, t, m, dur, vel, out, o) {
    const c = e.ctx, f = mtof(m), ring = o.ring || 1.5;
    const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain(), lp = c.createBiquadFilter();
    car.type = 'sine'; mod.type = 'sine'; car.frequency.value = f; mod.frequency.value = f * 3.5;
    mg.gain.setValueAtTime(f * 1.1, t); mg.gain.exponentialRampToValueAtTime(f * 0.03, t + 0.3);
    lp.type = 'lowpass'; lp.frequency.value = 5200;
    mod.connect(mg).connect(car.frequency);
    car.connect(g); g.connect(lp).connect(out);
    env(g.gain, t, vel, 0.002, ring, 0.22);
    car.start(t); mod.start(t); car.stop(t + ring + 0.05); mod.stop(t + ring + 0.05);
  },
  // soft pad: a chord of detuned triangles through a low-pass, slow attack and release
  pad(e, t, notes, dur, vel, out, o) {
    const c = e.ctx, atk = o.atk || 0.9, rel = o.rel || 1.2, n = notes.length;
    const lp = c.createBiquadFilter(), g = c.createGain();
    lp.type = 'lowpass'; lp.Q.value = 0.4;
    lp.frequency.setValueAtTime(o.cut0 || 450, t); lp.frequency.linearRampToValueAtTime(o.cut1 || 1000, t + atk * 1.5);
    lp.connect(g); g.connect(out);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + atk);
    g.gain.setValueAtTime(vel, t + Math.max(atk, dur));
    g.gain.linearRampToValueAtTime(0.0001, t + Math.max(atk, dur) + rel);
    const end = t + Math.max(atk, dur) + rel + 0.05;
    for (const m of notes) {
      const f = mtof(m);
      for (const det of [-7, 7]) {
        const os = c.createOscillator(), og = c.createGain();
        os.type = 'triangle'; os.frequency.value = f; os.detune.value = det;
        og.gain.value = 0.5 / n;
        os.connect(og).connect(lp);
        os.start(t); os.stop(end);
      }
    }
  },
  // warm bass: sine + a little triangle, short envelope
  bass(e, t, m, dur, vel, out, o) {
    const c = e.ctx, f = mtof(m), ring = Math.max(0.12, (o.short ? dur * 0.9 : dur) + 0.05);
    const a = c.createOscillator(), b = c.createOscillator(), gb = c.createGain(), lp = c.createBiquadFilter(), g = c.createGain();
    a.type = 'sine'; b.type = 'triangle'; a.frequency.value = f; b.frequency.value = f;
    gb.gain.value = 0.35; lp.type = 'lowpass'; lp.frequency.value = 650; lp.Q.value = 0.4;
    a.connect(lp); b.connect(gb).connect(lp); lp.connect(g); g.connect(out);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + 0.012);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vel * 0.5), t + ring * 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + ring);
    a.start(t); b.start(t); a.stop(t + ring + 0.05); b.stop(t + ring + 0.05);
  },
  // whistle / flute lead: sine (+ soft harmonics), delayed gentle vibrato, a scoop into the pitch and a puff of breath noise
  lead(e, t, m, dur, vel, out, o) {
    const c = e.ctx, f = mtof(m), fl = o.style === 'flute';
    const d = Math.max(0.14, dur), atk = fl ? 0.07 : 0.035, rel = fl ? 0.18 : 0.1;
    const car = c.createOscillator(), h2 = c.createOscillator(), h2g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain(), g = c.createGain();
    car.type = 'sine'; h2.type = 'sine';
    car.frequency.setValueAtTime(f * 0.985, t); car.frequency.exponentialRampToValueAtTime(f, t + 0.07);
    h2.frequency.value = f * 2; h2g.gain.value = fl ? 0.2 : 0.05;
    lfo.type = 'sine'; lfo.frequency.value = fl ? 4.8 : 5.8;
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * (fl ? 0.007 : 0.006), t + 0.3);
    lfo.connect(lg); lg.connect(car.frequency);
    car.connect(g); h2.connect(h2g).connect(g); g.connect(out);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vel, t + atk);
    g.gain.setValueAtTime(vel, t + Math.max(atk, d));
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(atk, d) + rel);
    const end = t + Math.max(atk, d) + rel + 0.05;
    car.start(t); h2.start(t); lfo.start(t); car.stop(end); h2.stop(end); lfo.stop(end);
    // breath
    const ns = c.createBufferSource(), bp = c.createBiquadFilter(), bg = c.createGain();
    ns.buffer = e.noise; bp.type = 'bandpass'; bp.frequency.value = clamp(f * 2.5, 1200, 4500); bp.Q.value = 0.9;
    bg.gain.setValueAtTime(0.0001, t); bg.gain.linearRampToValueAtTime(vel * (fl ? 0.2 : 0.07), t + 0.03); bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
    ns.connect(bp).connect(bg).connect(out);
    ns.start(t, (t * 0.37) % 0.9); ns.stop(t + 0.32);
  },
  // shaker: a tick of band-passed noise
  shaker(e, t, m, dur, vel, out, o) {
    const c = e.ctx, len = o.len || 0.07;
    const ns = c.createBufferSource(), bp = c.createBiquadFilter(), g = c.createGain();
    ns.buffer = e.noise; bp.type = 'bandpass'; bp.frequency.value = 5600; bp.Q.value = 0.7;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    ns.connect(bp).connect(g).connect(out);
    ns.start(t, (t * 1.93) % 1.0); ns.stop(t + len + 0.03);
  },
  // soft kick: a sine that drops in pitch
  kick(e, t, m, dur, vel, out) {
    const c = e.ctx, os = c.createOscillator(), g = c.createGain();
    os.type = 'sine'; os.frequency.setValueAtTime(130, t); os.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    os.connect(g).connect(out); os.start(t); os.stop(t + 0.34);
  },
  // tiny wood-block click
  logdrum(e, t, m, dur, vel, out) {
    const c = e.ctx, a = c.createOscillator(), b = c.createOscillator(), bg = c.createGain(), g = c.createGain();
    const f = mtof(m); a.type = 'sine'; b.type = 'triangle';
    a.frequency.setValueAtTime(f * 1.8, t); a.frequency.exponentialRampToValueAtTime(f, t + 0.035);
    b.frequency.value = f * 2.72; bg.gain.value = 0.18;
    a.connect(g); b.connect(bg).connect(g); g.connect(out);
    env(g.gain, t, vel, 0.003, 0.28, 0.1); a.start(t); b.start(t); a.stop(t + 0.4); b.stop(t + 0.4);
  },
  click(e, t, m, dur, vel, out) {
    const c = e.ctx, a = c.createOscillator(), b = c.createOscillator(), g = c.createGain(), gb = c.createGain();
    a.type = 'triangle'; a.frequency.value = 960; b.type = 'sine'; b.frequency.value = 1450; gb.gain.value = 0.4;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + 0.002); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);
    a.connect(g); b.connect(gb).connect(g); g.connect(out);
    a.start(t); b.start(t); a.stop(t + 0.08); b.stop(t + 0.08);
  },
  // Step 80b: a concertina / squeezebox: two detuned SQUARE waves through a low-pass with a bellows tremor, a quick attack and a wheezy release (notes may be a chord: a number or an array of midi notes)
  concertina(e, t, m, dur, vel, out, o) {
    const c = e.ctx, notes = Array.isArray(m) ? m : [m], d = Math.max(0.1, dur), n = notes.length;
    const lp = c.createBiquadFilter(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
    lp.type = 'lowpass'; lp.Q.value = 0.7; lp.frequency.setValueAtTime((o.bright || 2300) * 0.6, t); lp.frequency.linearRampToValueAtTime(o.bright || 2300, t + 0.05);
    lfo.frequency.value = 5.4; lg.gain.value = 7; lfo.connect(lg);
    const end = t + d + 0.1;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + 0.04);
    g.gain.setValueAtTime(vel * 0.85, t + Math.max(0.05, d)); g.gain.linearRampToValueAtTime(0.0001, end);
    lp.connect(g); g.connect(out);
    for (const note of notes) for (const det of [-6, 6]) {
      const os = c.createOscillator(), og = c.createGain();
      os.type = 'square'; os.frequency.value = mtof(note); os.detune.value = det; lg.connect(os.detune);
      og.gain.value = 0.34 / (n * 1.4); os.connect(og).connect(lp); os.start(t); os.stop(end + 0.02);
    }
    lfo.start(t); lfo.stop(end + 0.02);
  },
  // Step 80b: a celesta: a clean sine with a bright fast-fading fourth partial (a tiny hammer), long and soft
  celesta(e, t, m, dur, vel, out, o) {
    const c = e.ctx, f = mtof(m), ring = o.ring || 1.6;
    const a = c.createOscillator(), b = c.createOscillator(), ga = c.createGain(), gb = c.createGain();
    a.type = 'sine'; b.type = 'sine'; a.frequency.value = f; b.frequency.value = f * 4;
    env(ga.gain, t, vel, 0.004, ring, 0.3);
    gb.gain.setValueAtTime(0.0001, t); gb.gain.linearRampToValueAtTime(vel * 0.22, t + 0.002); gb.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
    a.connect(ga).connect(out); b.connect(gb).connect(out);
    a.start(t); b.start(t); a.stop(t + ring + 0.05); b.stop(t + 0.22);
  },
  // Step 80b: a soft timpani: a sine that sags into its note and rings, plus a muffled thump of noise
  timpani(e, t, m, dur, vel, out) {
    const c = e.ctx, f = mtof(m), os = c.createOscillator(), g = c.createGain();
    os.type = 'sine'; os.frequency.setValueAtTime(f * 1.35, t); os.frequency.exponentialRampToValueAtTime(f, t + 0.12);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vel, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.85);
    os.connect(g).connect(out); os.start(t); os.stop(t + 0.9);
    const ns = c.createBufferSource(), lp = c.createBiquadFilter(), ng = c.createGain();
    ns.buffer = e.noise; lp.type = 'lowpass'; lp.frequency.value = 380;
    ng.gain.setValueAtTime(0.0001, t); ng.gain.linearRampToValueAtTime(vel * 0.5, t + 0.006); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    ns.connect(lp).connect(ng).connect(out); ns.start(t, (t * 0.71) % 0.9); ns.stop(t + 0.15);
  },
};
// reverb send per instrument (shared convolver)
const WET = { glasspad: 0.72, theremin: 0.68, plip: 0.65, drone: 0.16, pluck: 0.26, marimba: 0.3, ep: 0.42, bell: 0.55, pad: 0.5, bass: 0.04, lead: 0.4, shaker: 0.1, kick: 0.02, click: 0.14, concertina: 0.22, celesta: 0.55, timpani: 0.3 };

// ------------------------------------------------------------------------------------------------ audio assets + engine
/** Shared per-context assets: a procedurally generated stereo reverb impulse (~2 s decaying noise) and a noise buffer. */
function makeAssets(ctx) {
  const sr = ctx.sampleRate, secs = 2.1, n = Math.floor(sr * secs);
  const impulse = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = impulse.getChannelData(ch), r = mulberry32(777 + ch * 131);
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      lp += ((r() * 2 - 1) - lp) * (0.6 - 0.45 * (i / n));          // darker and darker as it decays
      d[i] = lp * Math.exp(-t * 3.4) * Math.min(1, t / 0.012);
    }
  }
  const nn = Math.floor(sr * 1.2), noise = ctx.createBuffer(1, nn, sr), nd = noise.getChannelData(0), r2 = mulberry32(4242);
  for (let i = 0; i < nn; i++) nd[i] = r2() * 2 - 1;
  return { impulse, noise };
}

// Only the marsh engines use the long dark tail; older tracks keep the exact original impulse.
function duskImpulse(ctx) {
  const sr = ctx.sampleRate, n = Math.floor(sr * DUSK_MUSIC.reverbSeconds), impulse = ctx.createBuffer(2, n, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = impulse.getChannelData(ch), rng = mulberry32(6969 + ch), fade = n / DUSK_MUSIC.reverbSeconds;
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += (rng() * 2 - 1 - lp) * 0.22;
      d[i] = lp * Math.exp(-i / fade * 1.4) * Math.min(1, i / (sr * 0.04));
    }
  }
  return impulse;
}

class Engine {
  constructor(ctx, dest, assets, fade = 0, marsh = false, level = 1) {
    this.ctx = ctx; this.noise = assets.noise;
    this.fade = ctx.createGain(); this.fade.gain.value = fade;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 14; this.comp.ratio.value = 3; this.comp.attack.value = 0.012; this.comp.release.value = 0.3;
    this.conv = ctx.createConvolver(); this.conv.buffer = marsh ? (assets.duskImpulse ||= duskImpulse(ctx)) : assets.impulse;
    this.rev = ctx.createGain(); this.rev.gain.value = 0.9;
    this.conv.connect(this.rev); this.rev.connect(this.fade);
    this.fade.connect(this.comp);
    if (level === 1) this.comp.connect(dest);
    else { this.level = ctx.createGain(); this.level.gain.value = level; this.comp.connect(this.level); this.level.connect(dest); }
    this.buses = {};
  }
  bus(kind) {
    let b = this.buses[kind];
    if (!b) {
      const c = this.ctx, g = c.createGain(), send = c.createGain();
      send.gain.value = WET[kind] || 0.2;
      g.connect(this.fade); g.connect(send); send.connect(this.conv);
      b = this.buses[kind] = g;
    }
    return b;
  }
  dispose() { try { this.fade.disconnect(); this.comp.disconnect(); this.conv.disconnect(); this.rev.disconnect(); this.level?.disconnect(); } catch (_) { /* already gone */ } }
}

// ------------------------------------------------------------------------------------------------ tracks
/** Builds a track definition's event list: [{ s: step, k: kind, m: midi | [midi], d: steps, v: velocity, o: opts }] sorted by step. */
function buildTrack(def) {
  if (def.build) return def.build();
  const events = [];
  const rng = mulberry32(def.seed);
  const mel = new Melody(def.seed ^ 0x5bd1, def.key, def.melody);
  let barAbs = 0;
  for (const sec of def.form) {
    for (let b = 0; b < sec.bars; b++, barAbs++) {
      const chords = def.prog[sec.name], ch = chords[b % chords.length], nx = chords[(b + 1) % chords.length];
      const s0 = barAbs * STEPS_PER_BAR;
      const c = {
        sec: sec.name, v: sec.v || 0, b, nbars: sec.bars, ch, nx, rng, barAbs,
        last: b === sec.bars - 1, final: sec.name === 'O',
        add: (st, k, m, d, vel, o = {}) => events.push({ s: s0 + st, k, m, d, v: vel, o }),
        melody: (lift = 0) => mel.bar(ch, sec.name, b, sec.bars, { lift, final: sec.name === 'O' }),
      };
      c.strum = (st, chd, dir, vel, o = {}) => {
        const notes = voiceUp(chd, o.lo || 60, o.n || 4), nn = notes.length;
        for (let i = 0; i < nn; i++) c.add(st + (dir === 'D' ? i : nn - 1 - i) * 0.17, 'pluck', notes[i], 2, vel * (1 - 0.05 * i), o);
      };
      def.bar(c);
    }
  }
  events.sort((a, b) => a.s - b.s);
  return { events, steps: barAbs * STEPS_PER_BAR };
}

// ---- 1. Morning Breeze: C major, 96 BPM. A gentle sine/triangle accompaniment, marimba tune and soft bass.
// Playback-only gentleStrum preserves every authored note, rhythm and historical event fingerprint.
const C_ = chord('C'), G_ = chord('G'), Am_ = chord('A', 'min'), F_ = chord('F'), Em_ = chord('E', 'min'), Dm_ = chord('D', 'min');
const MORNING = {
  title: 'Morning Breeze', bpm: 96, swing: 0.5, seed: 1101, trim: 0.31, gentleStrum: true,
  key: { pc: 0, scale: MAJOR },
  prog: { I: [C_, G_, Am_, G_], A: [C_, G_, Am_, F_], B: [F_, G_, Em_, Am_, Dm_, G_, C_, G_], O: [F_, C_] },
  form: [{ name: 'I', bars: 4 }, { name: 'A', bars: 8 }, { name: 'A', bars: 8, v: 1 }, { name: 'B', bars: 8 }, { name: 'A', bars: 8, v: 2 }, { name: 'O', bars: 2 }],
  melody: {
    lo: 67, hi: 88, center: 76,
    rhythms: {
      A: [[[0, 3], [3, 3], [6, 2], [8, 4], [12, 2], [14, 2]], [[0, 2], [2, 2], [4, 4], [8, 3], [11, 1], [12, 4]], [[0, 4], [4, 2], [6, 2], [8, 2], [10, 2], [12, 4]], [[2, 2], [4, 2], [6, 2], [8, 4], [12, 2], [14, 2]]],
      B: [[[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 4]], [[0, 6], [6, 2], [8, 2], [10, 2], [12, 4]], [[0, 4], [4, 4], [8, 2], [10, 2], [12, 2], [14, 2]], [[0, 3], [3, 3], [6, 3], [9, 3], [12, 4]]],
    },
    cadences: [[[0, 6], [6, 2], [8, 8]], [[0, 4], [4, 2], [6, 2], [8, 8]]],
  },
  bar(c) {
    const { sec, v, b, ch, add } = c;
    if (sec === 'I') {
      const st = b < 2 ? [0, 4, 8, 12] : [0, 4, 6, 10, 12, 14];
      st.forEach((s, i) => c.strum(s, ch, (i % 2 && b >= 2) ? 'U' : 'D', b < 2 ? 0.3 : 0.4));
      if (b >= 1) add(0, 'bass', pcAt(ch.pc, 40), 5, 0.55);
      if (b >= 2) { const n = voiceUp(ch, 72, 4); [0, 1, 2, 3, 2, 1, 2, 3].forEach((i, j) => add(j * 2, 'marimba', n[i], 2, 0.3)); }
      return;
    }
    if (sec === 'O') {
      if (b === 0) { c.strum(0, ch, 'D', 0.36); c.strum(8, ch, 'D', 0.28); add(0, 'bass', pcAt(ch.pc, 40), 6, 0.5); return; }
      c.strum(0, ch, 'D', 0.5, { ring: 2.6 });
      add(0, 'bass', pcAt(ch.pc, 40), 12, 0.55);
      add(0, 'marimba', 76, 4, 0.42); add(4, 'marimba', 79, 4, 0.4); add(8, 'marimba', 84, 6, 0.42, { ring: 1.8 });
      return;
    }
    const isB = sec === 'B';
    const pat = isB ? [[0, 'D', 1], [2, 'U', 0.55], [4, 'D', 0.9], [6, 'U', 0.6], [8, 'D', 0.95], [10, 'U', 0.6], [12, 'D', 0.9], [14, 'U', 0.55]]
      : v ? [[0, 'D', 1], [4, 'D', 0.85], [6, 'U', 0.6], [8, 'D', 0.6], [10, 'U', 0.6], [12, 'D', 0.9], [14, 'U', 0.56]]
        : [[0, 'D', 1], [4, 'D', 0.85], [6, 'U', 0.6], [10, 'U', 0.6], [12, 'D', 0.88], [14, 'U', 0.56]];
    for (const [s, dir, vv] of pat) c.strum(s, ch, dir, 0.5 * vv);
    add(0, 'bass', pcAt(ch.pc, 40), 5, 0.6);
    add(8, 'bass', pcAt((ch.pc + 7) % 12, 40), 3, 0.45);
    if (isB) add(6, 'bass', pcAt(ch.pc, 52), 2, 0.3);
    const lift = v === 2 ? 3 : 0;
    for (const n of c.melody(lift)) {
      add(n.at, 'marimba', n.midi, n.len, 0.5);
      if (v === 2 && n.midi + 12 <= 91) add(n.at, 'marimba', n.midi + 12, n.len, 0.17);
    }
    if (v >= 1 || isB) for (let s = 2; s < 16; s += 4) { add(s, 'shaker', 0, 1, 0.2); add(s - 2, 'shaker', 0, 1, 0.1); }
    if (isB || v === 2) { add(4, 'click', 0, 1, 0.16); add(12, 'click', 0, 1, 0.16); }
  },
};

// ---- 2. Tide Pools: F major, 76 BPM, dreamy. Electric-piano tune and music-box sparkles over a warm pad; maj7 / sus chords.
const Fmaj7 = chord('F', 'maj7'), Am7 = chord('A', 'min7'), Bbmaj7 = chord('Bb', 'maj7'), Csus4 = chord('C', 'sus4'), C7 = chord('C', 'dom7');
const Dm7 = chord('D', 'min7'), Gm7 = chord('G', 'min7'), Gm9 = chord('G', 'min9');
const TIDE = {
  title: 'Tide Pools', bpm: 76, swing: 0.5, seed: 2207, trim: 0.31,
  key: { pc: 5, scale: MAJOR },
  prog: {
    I: [Fmaj7, Bbmaj7], A: [Fmaj7, Am7, Bbmaj7, Csus4, Fmaj7, Dm7, Bbmaj7, C7],
    B: [Dm7, Gm7, Bbmaj7, Am7, Dm7, Gm9, Csus4, C7], O: [Bbmaj7, Fmaj7],
  },
  form: [{ name: 'I', bars: 2 }, { name: 'A', bars: 8 }, { name: 'A', bars: 8, v: 1 }, { name: 'B', bars: 8 }, { name: 'A', bars: 8, v: 2 }, { name: 'O', bars: 2 }],
  melody: {
    lo: 65, hi: 89, center: 77,
    rhythms: {
      A: [[[0, 6], [6, 2], [8, 4], [12, 4]], [[0, 4], [4, 4], [8, 6], [14, 2]], [[2, 6], [8, 2], [10, 2], [12, 4]], [[0, 8], [8, 4], [12, 2], [14, 2]]],
      B: [[[0, 4], [4, 2], [6, 2], [8, 8]], [[0, 2], [2, 2], [4, 4], [8, 8]], [[0, 6], [6, 2], [8, 6], [14, 2]], [[0, 3], [3, 3], [6, 2], [8, 8]]],
    },
    cadences: [[[0, 8], [8, 4], [12, 4]], [[0, 6], [6, 2], [8, 8]]],
  },
  bar(c) {
    const { sec, v, b, ch, add, rng } = c;
    const twinkle = (chance, echo) => {
      for (let s = 0; s < 16; s += 2) {
        if (rng() < chance) {
          const L = ladder(ch, 77, 96), m = L[Math.floor(rng() * L.length)];
          add(s, 'bell', m, 2, 0.16);
          if (echo) add(s + 3, 'bell', m, 2, 0.07);
        }
      }
    };
    if (sec === 'I') {
      add(0, 'pad', voiceUp(ch, 53, 4), 16.6, 0.3 + 0.1 * b, { atk: 1.6 });
      if (b === 1) add(0, 'bass', pcAt(ch.pc, 40), 12, 0.5);
      twinkle(0.3, false);
      return;
    }
    if (sec === 'O') {
      add(0, 'pad', voiceUp(ch, 53, 4), b ? 12 : 16.6, 0.4, { atk: 1.2, rel: 2.0 });
      add(0, 'bass', pcAt(ch.pc, 40), b ? 12 : 14, 0.5);
      if (b === 0) { add(0, 'ep', 77, 6, 0.4); add(8, 'ep', 72, 6, 0.36); }
      else { add(0, 'ep', 69, 8, 0.4, { ring: 3 }); add(2, 'bell', 93, 2, 0.14); add(6, 'bell', 88, 2, 0.12); add(10, 'bell', 84, 2, 0.1); }
      return;
    }
    add(0, 'pad', voiceUp(ch, 53, 4), 16.6, 0.36 + (v === 2 ? 0.06 : 0), { atk: 1.0 });
    if (sec === 'B') add(0, 'pad', voiceUp(ch, 65, 3), 16.6, 0.12, { atk: 1.4, cut1: 1400 });
    add(0, 'bass', pcAt(ch.pc, 40), 14, 0.5);
    if (v >= 1 || sec === 'B') add(8, 'bass', pcAt((ch.pc + 7) % 12, 40), 6, 0.3);
    for (const n of c.melody(v === 2 ? 2 : 0)) add(n.at, 'ep', n.midi, n.len, 0.46, { index: v === 2 ? 1.8 : 1.5 });
    twinkle(v >= 1 || sec === 'B' ? 0.45 : 0.25, v >= 1 || sec === 'B');
    if (sec === 'B') for (let s = 0; s < 16; s += 4) add(s, 'shaker', 0, 1, 0.07, { len: 0.12 });
  },
};

// ---- 3. Island Stroll: G major, 108 BPM, swung shuffle. Bouncy bass, whistle lead, shaker, little off-beat stabs.
const G2 = chord('G'), Em2 = chord('E', 'min'), C2 = chord('C'), D2 = chord('D'), Bm2 = chord('B', 'min');
const STROLL = {
  title: 'Island Stroll', bpm: 108, swing: 0.64, seed: 3309, trim: 0.27,
  key: { pc: 7, scale: MAJOR },
  prog: { I: [G2, D2], A: [G2, Em2, C2, D2], B: [C2, D2, Bm2, Em2, C2, D2, G2, D2], O: [C2, G2] },
  form: [{ name: 'I', bars: 2 }, { name: 'A', bars: 8 }, { name: 'A', bars: 8, v: 1 }, { name: 'B', bars: 8 }, { name: 'B', bars: 8, v: 1 }, { name: 'A', bars: 8, v: 2 }, { name: 'O', bars: 2 }],
  melody: {
    lo: 69, hi: 91, center: 79,
    rhythms: {
      A: [[[0, 4], [4, 2], [6, 2], [8, 4], [12, 4]], [[0, 2], [2, 2], [4, 4], [8, 2], [10, 2], [12, 4]], [[2, 2], [4, 2], [6, 4], [10, 2], [12, 2], [14, 2]], [[0, 6], [6, 2], [8, 2], [10, 6]]],
      B: [[[0, 2], [2, 2], [4, 2], [6, 2], [8, 4], [12, 4]], [[0, 4], [4, 4], [8, 2], [10, 2], [12, 4]], [[0, 2], [2, 4], [6, 2], [8, 2], [10, 2], [12, 4]], [[2, 2], [4, 4], [8, 4], [12, 2], [14, 2]]],
    },
    cadences: [[[0, 4], [4, 2], [6, 2], [8, 8]], [[0, 6], [6, 2], [8, 8]]],
  },
  bar(c) {
    const { sec, v, b, ch, nx, add } = c;
    const root = pcAt(ch.pc, 38), fifth = pcAt((ch.pc + 7) % 12, 38);
    const stab = (s, vel) => { const n = voiceUp(ch, 62, 3); n.forEach((m, i) => add(s + i * 0.12, 'pluck', m, 1, vel * (1 - 0.06 * i), { ring: 0.32, bright: 4 })); };
    const shake = (vel) => { for (let s = 0; s < 16; s += 2) add(s, 'shaker', 0, 1, s % 4 === 0 ? vel : vel * 0.5, { len: 0.06 }); };
    if (sec === 'I') {
      add(0, 'bass', root, 3, 0.55, { short: true }); add(4, 'bass', fifth, 3, 0.45, { short: true }); add(8, 'bass', root, 3, 0.55, { short: true }); add(12, 'bass', fifth, 3, 0.45, { short: true });
      shake(b ? 0.22 : 0.14);
      if (b === 1) { stab(2, 0.26); stab(10, 0.26); add(0, 'lead', 79, 6, 0.3, { style: 'whistle' }); add(8, 'lead', 83, 6, 0.3, { style: 'whistle' }); }
      return;
    }
    if (sec === 'O') {
      if (b === 0) { add(0, 'bass', root, 3, 0.55, { short: true }); add(4, 'bass', fifth, 3, 0.45, { short: true }); add(8, 'bass', root, 3, 0.55, { short: true }); stab(2, 0.26); stab(10, 0.26); shake(0.16); add(0, 'lead', 76, 6, 0.36, { style: 'whistle' }); add(8, 'lead', 79, 6, 0.36, { style: 'whistle' }); }
      else { add(0, 'bass', root, 6, 0.55); stab(0, 0.3); add(0, 'lead', 79, 14, 0.36, { style: 'whistle' }); add(0, 'kick', 0, 1, 0.3); }
      return;
    }
    // bouncy bass
    const nextRoot = pcAt(nx.pc, 38);
    add(0, 'bass', root, 3, 0.6, { short: true });
    add(4, 'bass', fifth, 3, 0.48, { short: true });
    add(8, 'bass', root, 3, 0.58, { short: true });
    add(10, 'bass', root + 12, 1.5, 0.3, { short: true });
    add(12, 'bass', fifth, 3, 0.48, { short: true });
    add(14, 'bass', nextRoot - 2, 1.5, 0.3, { short: true });
    // whistle tune
    const lift = v === 2 ? 3 : 0;
    for (const n of c.melody(lift)) add(n.at, 'lead', n.midi, n.len * 0.9, 0.44, { style: 'whistle' });
    shake(v >= 1 || sec === 'B' ? 0.24 : 0.17);
    if (sec === 'B') for (let s = 1; s < 16; s += 4) add(s, 'shaker', 0, 1, 0.07, { len: 0.04 });
    add(0, 'kick', 0, 1, 0.34); add(8, 'kick', 0, 1, 0.3);
    if (v >= 1 || sec === 'B') { stab(2, 0.24); stab(10, 0.24); }
    if (v === 2) { add(4, 'click', 0, 1, 0.15); add(12, 'click', 0, 1, 0.15); }
  },
};

// ---- 4. Campfire Evening: D major / B minor, 70 BPM. Fingerpicked acoustic guitar, flute tune, low pad.
const Bm_ = chord('B', 'min'), G4 = chord('G'), D4 = chord('D'), A4 = chord('A'), Em4 = chord('E', 'min'), D4add9 = chord('D', 'add9'), Em7 = chord('E', 'min7');
const CAMPFIRE = {
  title: 'Campfire Evening', bpm: 70, swing: 0.5, seed: 4413, trim: 0.30,
  key: { pc: 2, scale: MAJOR },
  prog: { I: [Bm_, G4], A: [Bm_, G4, D4, A4, Bm_, G4, D4add9, A4], B: [G4, D4, Em4, Bm_, G4, D4, Em7, A4], O: [G4, D4] },
  form: [{ name: 'I', bars: 2 }, { name: 'A', bars: 8 }, { name: 'A', bars: 8, v: 1 }, { name: 'B', bars: 8 }, { name: 'A', bars: 8, v: 2 }, { name: 'O', bars: 2 }],
  melody: {
    lo: 66, hi: 88, center: 74,
    rhythms: {
      A: [[[0, 3], [3, 3], [6, 2], [8, 4], [12, 4]], [[0, 4], [4, 3], [7, 3], [10, 6]], [[0, 6], [6, 2], [8, 3], [11, 5]], [[0, 3], [3, 3], [6, 4], [10, 2], [12, 4]]],
      B: [[[0, 2], [2, 2], [4, 4], [8, 8]], [[0, 4], [4, 4], [8, 4], [12, 2], [14, 2]], [[2, 4], [6, 2], [8, 4], [12, 4]], [[0, 8], [8, 3], [11, 3], [14, 2]]],
    },
    cadences: [[[0, 6], [6, 2], [8, 8]], [[0, 8], [8, 4], [12, 4]]],
  },
  bar(c) {
    const { sec, v, b, ch, add } = c;
    const low = pcAt(ch.pc, 45), up = voiceUp(ch, 62, 3);
    const strings = [low, up[0], up[1], up[2]];
    const patterns = [[0, 1, 2, 3, 2, 1, 2, 1], [0, 2, 1, 3, 1, 2, 3, 2]];
    const pick = (pat, vel) => pat.forEach((si, i) => add(i * 2, 'pluck', strings[si], 2, vel * (i === 0 ? 1.15 : i % 2 ? 0.7 : 0.88), { ring: 1.8, bright: 4 }));
    if (sec === 'I') {
      pick(patterns[0], b ? 0.36 : 0.28);
      add(0, 'pad', voiceUp(ch, 45, 3), 16.6, 0.22 + 0.06 * b, { atk: 1.6, cut1: 650 });
      return;
    }
    if (sec === 'O') {
      if (b === 0) { pick(patterns[0], 0.34); add(0, 'pad', voiceUp(ch, 45, 3), 16.6, 0.26, { atk: 1.2, cut1: 650 }); add(0, 'lead', 74, 10, 0.3, { style: 'flute' }); return; }
      const n = [low, up[0], up[1], up[2]]; n.forEach((m, i) => add(i * 0.6, 'pluck', m, 2, 0.4, { ring: 3.4, bright: 4 }));
      add(0, 'pad', voiceUp(ch, 45, 3), 12, 0.26, { atk: 1.0, rel: 2.4, cut1: 650 });
      add(0, 'lead', 78, 12, 0.3, { style: 'flute' });
      return;
    }
    pick(patterns[(v === 1 || sec === 'B') && b % 2 ? 1 : 0], v === 2 ? 0.44 : 0.4);
    add(0, 'pad', voiceUp(ch, 45, 3), 16.6, 0.25 + (v === 2 ? 0.06 : 0), { atk: 1.2, cut1: 650 });
    const lift = v === 2 ? 2 : 0;
    for (const n of c.melody(lift)) add(n.at, 'lead', n.midi, n.len * 0.95, 0.42, { style: 'flute' });
    if (sec === 'B' && b % 2 === 0) add(0, 'kick', 0, 1, 0.16);
  },
};

// Island themes use their own meter / motifs instead of forcing the home 4/4 generator onto a waltz.
function islandTheme(island) {
  const frost = island === 'frost', stepsPerBar = frost ? 12 : 16;
  return {
    title: frost ? 'Snowbell Waltz' : 'Emberleaf Grove', bpm: frost ? 84 : 92, swing: frost ? 0.5 : 0.54,
    stepsPerBar, meter: frost ? '3/4' : '4/4', trim: frost ? 0.51 : 0.60, compressorAttack: 0.003,
    build() {
      const events = [], harmony = frost ? [C_, Am_, F_, G_] : [F_, C_, Am_, G_];
      const melody = frost ? [76,79,81,79,76,74,72,74] : [69,72,74,72,69,67,64,67];
      for (let bar = 0; bar < 48; bar++) {
        const ch = harmony[Math.floor(bar / 2) % harmony.length], base = bar * stepsPerBar;
        const add = (s, k, m, d, v, o = {}) => events.push({ s: base + s, k, m, d, v, o });
        const fade = bar < 2 || bar >= 46 ? 0.65 : 1;
        add(0, 'bass', pcAt(ch.pc, 43), 3, 0.35 * fade, { short: true });
        add(0, 'pad', voiceUp(ch, 55, 3), stepsPerBar, 0.2 * fade, { atk: 0.8, rel: 0.8, cut1: 700 });
        for (let beat = 0; beat < stepsPerBar / 4; beat++) {
          if (frost) add(beat * 4, 'bell', voiceUp(ch, 72, 3)[beat % 3], 3, 0.32 * fade, { ring: 1.3 });
          else { add(beat * 4, 'logdrum', beat % 2 ? 57 : 50, 1, 0.5 * fade); add(beat * 4 + 2, 'shaker', 0, 1, 0.08 * fade); }
        }
        for (let n = 0; n < 3; n++) add(n * (frost ? 4 : 5), frost ? 'bell' : 'pluck', melody[(bar * 2 + n) % melody.length] + (bar >= 24 && bar < 40 ? 12 : 0), 3, 0.5 * fade, frost ? { ring: 1.7 } : { ring: 1.4, bright: 5 });
      }
      events.sort((a, b) => a.s - b.s); return { events, steps: 48 * stepsPerBar };
    },
  };
}
// Original regional compositions: distinct harmony, melodies, meters and arrangements.
function landscapeTheme({ title, bpm, seed, harmony, motif, meter = 16, style }) {
  return {
    title, bpm, seed, swing: style === 'grove' ? 0.56 : 0.5,
    stepsPerBar: meter, meter: meter === 12 ? '3/4' : '4/4', trim: 0.43,
    build() {
      const rng = mulberry32(seed), events = [];
      for (let bar = 0; bar < 40; bar++) {
        const ch = harmony[Math.floor(bar / 2) % harmony.length], base = bar * meter;
        const add = (s, k, m, d, v, o = {}) => events.push({ s: base + s, k, m, d, v, o });
        const fade = bar < 2 || bar >= 38 ? 0.6 : 1;
        const bridge = bar >= 16 && bar < 24, reprise = bar >= 24 && bar < 38;
        add(0, 'pad', voiceUp(ch, style === 'ancient' ? 45 : 53, 3), meter, 0.23 * fade,
          { atk: 1.4, rel: 1.8, cut0: 350, cut1: style === 'ancient' ? 650 : 850 });
        add(0, 'bass', pcAt(ch.pc, 38), meter - 1, 0.28 * fade);
        if (style === 'ancient') {
          // Open, modal flute phrases, sparse harp-like plucks and distant wooden pulses.
          const n = voiceUp(ch, 57, 4);
          [0, 6, 10].forEach((s, j) => add(s, 'pluck', n[(j + bar) % 4], 4, 0.22 * fade, { ring: 2.7, bright: 2.5 }));
          if (bar % 2 === 0) add(0, 'logdrum', 38, 2, 0.14 * fade);
          if (bar >= 2 && bar % 4 !== 3) {
            [0, 6].forEach((s, j) => add(s + 2, 'lead', motif[(bar * 2 + j) % motif.length], 5, 0.3 * fade, { style: 'flute' }));
          }
          if (bar % 4 === 3) add(8, 'bell', voiceUp(ch, 77, 3)[1], 4, 0.10 * fade, { ring: 2.8 });
        } else if (style === 'snow' || style === 'aurora') {
          const notes = voiceUp(ch, style === 'snow' ? 65 : 60, 4);
          for (let s = 0; s < meter; s += style === 'snow' ? 3 : 4) {
            add(s, style === 'snow' ? 'pluck' : 'ep', notes[(s / (style === 'snow' ? 3 : 4) + bar) % 4], 3,
              0.21 * fade, style === 'snow' ? { ring: 2.1, bright: 3 } : { ring: 3, index: 0.6 });
          }
          if (bar >= 2) for (let j = 0; j < (bridge ? 2 : 3); j++) {
            const s = j * (meter === 12 ? 4 : 5);
            add(s, style === 'snow' ? 'lead' : 'bell', motif[(bar * 3 + j) % motif.length] + (reprise ? 12 : 0),
              style === 'snow' ? 3.5 : 4, 0.3 * fade, style === 'snow' ? { style: 'flute' } : { ring: 2.4 });
          }
          if (rng() > 0.5) add(meter - 2, 'bell', notes[2] + 12, 2, 0.10 * fade, { ring: 2.2 });
        } else {
          const notes = voiceUp(ch, 60, 4);
          for (let beat = 0; beat < 4; beat++) {
            add(beat * 4, 'logdrum', beat % 2 ? 55 : 48, 1, (style === 'grove' ? 0.32 : 0.18) * fade);
            add(beat * 4 + 2, 'shaker', 0, 1, 0.07 * fade, { len: 0.08 });
            add(beat * 4 + 1, 'pluck', notes[(beat + bar) % 4], 2, 0.2 * fade, { ring: 1.3, bright: 4 });
          }
          if (bar >= 2) for (let j = 0; j < (bridge ? 2 : 4); j++) {
            add(j * 4, style === 'grove' ? 'marimba' : 'lead', motif[(bar * 2 + j) % motif.length] + (reprise && style === 'grove' ? 12 : 0),
              3.3, 0.35 * fade, style === 'grove' ? { ring: 1.4 } : { style: 'flute' });
          }
        }
      }
      events.sort((a, b) => a.s - b.s);
      return { events, steps: 40 * meter };
    },
  };
}
const ANCIENT_FOREST = landscapeTheme({
  title: 'Ancient Forest', bpm: 62, seed: 6103, style: 'ancient',
  harmony: [chord('D', 'sus2'), chord('C', 'add9'), chord('G', 'sus2'), chord('D', 'min7')],
  motif: [74, 77, 79, 81, 79, 77, 74, 72, 69, 72, 74, 79],
});
const PINE_WHISPERS = landscapeTheme({
  title: 'Pine Whispers', bpm: 78, seed: 7109, style: 'snow', meter: 12,
  harmony: [chord('G', 'maj7'), chord('E', 'min7'), chord('C', 'add9'), chord('D', 'sus4')],
  motif: [74, 79, 81, 83, 81, 79, 76, 74, 72, 76, 79, 78],
});
const AURORA = landscapeTheme({
  title: 'Aurora over Frostpine', bpm: 66, seed: 8101, style: 'aurora',
  harmony: [chord('E', 'min9'), chord('C', 'maj7'), chord('G', 'add9'), chord('B', 'min7')],
  motif: [76, 79, 83, 86, 83, 81, 79, 78, 76, 74, 71, 74],
});
const BAMBOO = landscapeTheme({
  title: 'Bamboo Lanterns', bpm: 100, seed: 9103, style: 'grove',
  harmony: [chord('F', 'add9'), chord('D', 'min7'), chord('Bb', 'maj7'), chord('C', 'sus2')],
  motif: [69, 72, 77, 79, 77, 74, 72, 69, 65, 69, 72, 74],
});
const MOON_ORCHID = landscapeTheme({
  title: 'Moon Orchid Serenade', bpm: 74, seed: 10111, style: 'orchid',
  harmony: [chord('A', 'min9'), chord('F', 'maj7'), chord('C', 'add9'), chord('G', 'sus4')],
  motif: [76, 81, 79, 76, 74, 72, 69, 72, 76, 79, 81, 83],
});
// Dungeon composition: a quiet minor/modal question answered by distant glass bells.
const MOSSBOUND_ECHOES = {
  title: 'Mossbound Echoes', bpm: 68, swing: 0.5, stepsPerBar: 16, meter: '4/4', trim: 0.55,
  build() {
    const events = [], harmony = [chord('D', 'min9'), chord('Bb', 'maj7'), chord('G', 'min9'), chord('A', 'sus4')];
    const question = [74,77,76,69,74,72,69,65], answer = [77,79,81,82,79,76,74,72];
    for (let bar = 0; bar < 32; bar++) {
      const ch = bar >= 30 ? harmony[0] : harmony[Math.floor(bar / 2) % 4], base = bar * 16;
      const fade = bar < 2 || bar >= 30 ? 0.6 : 1, middle = bar >= 12 && bar < 20;
      const add = (s, k, m, d, v, o = {}) => events.push({ s: base + s, k, m, d, v: v * fade, o });
      add(0, 'pad', voiceUp(ch, 48, 4), 15, 0.16, { atk: 1.3, rel: 2, cut0: 300, cut1: 650 });
      add(0, 'bass', pcAt(ch.pc, 36), 12, 0.18);
      const arp = voiceUp(ch, 60, 4);
      [0, 6, 12].forEach((s, n) => add(s, 'pluck', arp[(n + bar % 2) % 4], 3, 0.16, { ring: 2.8, bright: 2.4 }));
      if (bar % 2 === 0 && bar < 30) add(0, 'logdrum', 38, 1, 0.075);
      if (bar >= 2 && bar % 4 !== 3 && bar < 30) {
        const motif = middle ? answer : question;
        add(2, 'lead', motif[bar % 8], 5.5, 0.22, { style: 'flute' });
        add(10, 'bell', motif[(bar + 3) % 8] + 12, 3, 0.12, { ring: 3.2 });
        if (middle) add(8, 'marimba', arp[(bar + 1) % 4], 3, 0.12, { ring: 1.3 });
      } else if (bar % 4 === 3) add(8, 'bell', bar >= 30 ? 74 : arp[2] + 12, 4, 0.10, { ring: 3.5 });
    }
    events.sort((a, b) => a.s - b.s); return { events, steps: 32 * 16 };
  },
};
// Storybook page composition (Step 52a): a cheerful, bouncy, SNES-flavoured tune for the paper pages: an oom-pah bass, a woodblock backbeat and shaker, a marimba bounce and a whistle lead over C - Am - F - G, an
// arpeggiated bridge and a bigger last verse. 32 bars of 16 steps at 118 bpm (about 65 s), a gentle swing; it loops while a page is open and fades in / out like the dungeon's.
const PAPER_MEADOW = {
  title: 'Paper Meadow', bpm: 118, swing: 0.56, stepsPerBar: 16, meter: '4/4', trim: 0.4,
  build() {
    const events = [];
    const prog = [chord('C'), chord('A', 'min'), chord('F'), chord('G')];
    const bridge = [chord('F'), chord('G'), chord('E', 'min'), chord('A', 'min'), chord('F'), chord('G'), chord('C'), chord('G', 'dom7')];
    // the lead, bar by bar [step, midi, steps]
    const A1 = [
      [[0, 76, 3], [3, 79, 1], [4, 81, 2], [6, 79, 2], [8, 76, 3], [11, 72, 1], [12, 74, 4]],
      [[0, 76, 3], [3, 72, 1], [4, 76, 2], [6, 81, 2], [8, 79, 4], [12, 76, 4]],
      [[0, 77, 3], [3, 81, 1], [4, 84, 2], [6, 81, 2], [8, 77, 3], [11, 74, 1], [12, 72, 4]],
      [[0, 74, 2], [2, 79, 2], [4, 83, 3], [7, 79, 1], [8, 74, 8]],
    ];
    const A2 = [
      [[0, 79, 3], [3, 84, 1], [4, 83, 2], [6, 81, 2], [8, 79, 3], [11, 76, 1], [12, 79, 4]],
      [[0, 81, 3], [3, 79, 1], [4, 76, 2], [6, 72, 2], [8, 76, 4], [12, 81, 4]],
      [[0, 77, 2], [2, 81, 2], [4, 84, 4], [8, 81, 2], [10, 77, 2], [12, 72, 4]],
      [[0, 74, 2], [2, 76, 2], [4, 79, 2], [6, 83, 2], [8, 84, 8]],
    ];
    for (let bar = 0; bar < 32; bar++) {
      const sec = bar < 8 ? 'A' : bar < 16 ? 'A2' : bar < 24 ? 'B' : 'A3';
      const ch = sec === 'B' ? bridge[bar - 16] : prog[bar % 4], base = bar * 16;
      const fade = bar < 1 ? 0.7 : bar >= 31 ? 0.8 : 1, big = sec === 'A3' || sec === 'B';
      const add = (s, k, m, d, v, o = {}) => events.push({ s: base + s, k, m, d, v: v * fade, o });
      const root = pcAt(ch.pc, 36), oct = root + 12, fifth = root + 7;
      // bass: oom-pah
      add(0, 'bass', root, 3, 0.34, { short: true }); add(3, 'bass', oct, 1.5, 0.22, { short: true }); add(6, 'bass', fifth, 2, 0.26, { short: true });
      add(8, 'bass', root, 3, 0.34, { short: true }); add(11, 'bass', oct, 1.5, 0.22, { short: true }); add(14, 'bass', bar % 4 === 3 ? fifth + 2 : fifth, 2, 0.26, { short: true });
      // pad under everything
      add(0, 'pad', voiceUp(ch, 55, 4), 15, big ? 0.15 : 0.11, { atk: 0.5, rel: 1.2, cut0: 600, cut1: 1500 });
      // drums: soft kick, woodblock backbeat, shaker 8ths, a little fill at phrase ends
      add(0, 'kick', 0, 1, 0.32); add(8, 'kick', 0, 1, 0.27); if (big) add(10, 'kick', 0, 1, 0.2);
      add(4, 'click', 0, 1, 0.14); add(12, 'click', 0, 1, 0.14);
      for (let s = 0; s < 16; s += 2) add(s, 'shaker', 0, 1, s % 4 === 0 ? 0.1 : 0.07, { len: 0.05 });
      if (bar % 4 === 3) { add(14, 'logdrum', 50, 1, 0.12); add(15, 'logdrum', 55, 1, 0.1); }
      // marimba bounce: chord tones on the off-beats
      const arp = voiceUp(ch, 60, 4);
      for (let k = 0; k < 8; k++) if (sec !== 'B' || k % 2 === 0) add(k * 2, 'marimba', arp[(k + (bar % 2)) % 4] + (k % 4 === 3 ? 12 : 0), 1.5, sec === 'A' && bar < 4 ? 0.09 : 0.13, { ring: 1.1 });
      // the lead
      if (sec === 'A' || sec === 'A2' || sec === 'A3') {
        const src = (sec === 'A' ? A1 : A2)[bar % 4], up = sec === 'A3' && bar % 2 === 1 ? 12 : 0;
        for (const [s, m, d] of src) add(s, 'lead', m + up, d - 0.3, 0.3, { style: 'whistle' });
        if (sec !== 'A') for (const [s, m] of src) if (s % 8 === 0 || s === 4) add(s, 'bell', m + 12, 3, 0.1, { ring: 2.4 });
      } else {
        // bridge: a climbing arpeggio, then a held note
        const lad = voiceUp(ch, 67, 5);
        [0, 2, 4, 6, 8].forEach((s, n) => add(s, 'lead', lad[n], 1.7, 0.27, { style: 'whistle' }));
        add(10, 'lead', lad[4], 5.5, 0.3, { style: 'whistle' });
        add(0, 'bell', lad[2] + 12, 4, 0.1, { ring: 3 }); add(8, 'bell', lad[3] + 12, 4, 0.1, { ring: 3 });
      }
    }
    events.sort((a, b) => a.s - b.s);
    return { events, steps: 32 * 16 };
  },
};
// Frostpine page composition (Step 52b, "Paper Snow"): a sleigh-ride tune for the snowy pages: a glockenspiel melody over warm electric-piano chords in F major (F - Dm - Bb - C, a bridge through Gm - C - Am - Dm), SLEIGH BELLS
// (the shaker voice on every 8th, with a bright accent), a soft kick and a woodblock backbeat, a flute answering in the second verse. 32 bars of 16 steps at 96 bpm (about 80 s), loops while a Frostpine page is open.
const PAPER_SNOW = {
  title: 'Paper Snow', bpm: 96, swing: 0.54, stepsPerBar: 16, meter: '4/4', trim: 0.44,
  build() {
    const events = [];
    const prog = [chord('F'), chord('D', 'min'), chord('Bb'), chord('C')];
    const bridge = [chord('G', 'min'), chord('C'), chord('A', 'min'), chord('D', 'min'), chord('Bb'), chord('C'), chord('F'), chord('C', 'dom7')];
    const A1 = [
      [[0, 81, 3], [3, 84, 1], [4, 86, 2], [6, 84, 2], [8, 81, 4], [12, 77, 4]],
      [[0, 81, 3], [3, 77, 1], [4, 81, 2], [6, 84, 2], [8, 82, 4], [12, 81, 4]],
      [[0, 82, 3], [3, 86, 1], [4, 89, 2], [6, 86, 2], [8, 82, 3], [11, 79, 1], [12, 77, 4]],
      [[0, 79, 2], [2, 84, 2], [4, 88, 3], [7, 84, 1], [8, 79, 8]],
    ];
    const A2 = [
      [[0, 84, 3], [3, 89, 1], [4, 88, 2], [6, 86, 2], [8, 84, 3], [11, 81, 1], [12, 84, 4]],
      [[0, 86, 3], [3, 84, 1], [4, 81, 2], [6, 77, 2], [8, 81, 4], [12, 86, 4]],
      [[0, 82, 2], [2, 86, 2], [4, 89, 4], [8, 86, 2], [10, 82, 2], [12, 77, 4]],
      [[0, 79, 2], [2, 81, 2], [4, 84, 2], [6, 88, 2], [8, 91, 8]],
    ];
    for (let bar = 0; bar < 32; bar++) {
      const sec = bar < 8 ? 'A' : bar < 16 ? 'A2' : bar < 24 ? 'B' : 'A3';
      const ch = sec === 'B' ? bridge[bar - 16] : prog[bar % 4], base = bar * 16;
      const fade = bar < 1 ? 0.7 : bar >= 31 ? 0.8 : 1, big = sec === 'A3' || sec === 'B';
      const add = (s, k, m, d, v, o = {}) => events.push({ s: base + s, k, m, d, v: v * fade, o });
      const root = pcAt(ch.pc, 36), fifth = root + 7;
      add(0, 'bass', root, 4, 0.3, { short: true }); add(8, 'bass', root + 12, 3, 0.22, { short: true }); add(12, 'bass', bar % 4 === 3 ? fifth + 2 : fifth, 3, 0.2, { short: true });
      add(0, 'pad', voiceUp(ch, 53, 4), 15, big ? 0.14 : 0.1, { atk: 0.7, rel: 1.4, cut0: 500, cut1: 1300 });
      add(0, 'kick', 0, 1, 0.26); add(8, 'kick', 0, 1, 0.22);
      add(4, 'click', 0, 1, 0.11); add(12, 'click', 0, 1, 0.11);
      for (let s = 0; s < 16; s += 2) add(s, 'shaker', 0, 1, s % 4 === 0 ? 0.1 : 0.07, { len: 0.09 });                         // sleigh bells
      add(0, 'bell', voiceUp(ch, 90, 2)[0], 2, 0.07, { ring: 1.4 }); add(8, 'bell', voiceUp(ch, 90, 2)[1], 2, 0.07, { ring: 1.4 });
      const arp = voiceUp(ch, 60, 4);
      for (let k = 0; k < 8; k++) if (sec !== 'B' || k % 2 === 0) add(k * 2 + 1 > 15 ? 14 : k * 2, 'ep', arp[(k + bar % 2) % 4] + (k % 4 === 3 ? 12 : 0), 2, sec === 'A' && bar < 4 ? 0.07 : 0.1, { ring: 1.6, index: 0.5 });
      if (sec === 'A' || sec === 'A2' || sec === 'A3') {
        const src = (sec === 'A' ? A1 : A2)[bar % 4];
        for (const [s, m, d] of src) add(s, 'bell', m + (sec === 'A3' && bar % 2 ? 12 : 0), d, 0.22, { ring: 2.4 });
        if (sec !== 'A') for (const [s, m, d] of src) if (s % 8 === 0) add(s, 'lead', m - 12, d + 1, 0.2, { style: 'flute' });
      } else {
        const lad = voiceUp(ch, 69, 5);
        [0, 2, 4, 6, 8].forEach((s, n) => add(s, 'bell', lad[n], 2, 0.2, { ring: 2.2 }));
        add(10, 'lead', lad[4], 5, 0.22, { style: 'flute' });
      }
    }
    events.sort((a, b) => a.s - b.s);
    return { events, steps: 32 * 16 };
  },
};
// Emberleaf page composition (Step 53a, "Paper Jungle"): a warm jungle groove for the Emberleaf Canopy pages: LOG DRUMS and a rolling marimba over a D minor / B flat / F / C turnaround, a woodblock backbeat and shaker, a
// round bass, a breathy flute answering in the second verse and a bridge that climbs through G minor and A7. 32 bars of 16 steps at 104 bpm (about 74 s), loops while an Emberleaf page is open.
const PAPER_JUNGLE = {
  title: 'Paper Jungle', bpm: 104, swing: 0.58, stepsPerBar: 16, meter: '4/4', trim: 0.42,
  build() {
    const events = [];
    const prog = [chord('D', 'min'), chord('Bb'), chord('F'), chord('C')];
    const bridge = [chord('G', 'min'), chord('D', 'min'), chord('Bb'), chord('A', 'dom7'), chord('G', 'min'), chord('C'), chord('F'), chord('A', 'dom7')];
    const A1 = [
      [[0, 74, 3], [3, 77, 1], [4, 81, 2], [6, 77, 2], [8, 74, 3], [11, 72, 1], [12, 74, 4]],
      [[0, 70, 3], [3, 74, 1], [4, 77, 2], [6, 74, 2], [8, 70, 4], [12, 72, 4]],
      [[0, 72, 3], [3, 76, 1], [4, 79, 2], [6, 77, 2], [8, 72, 3], [11, 69, 1], [12, 72, 4]],
      [[0, 72, 2], [2, 76, 2], [4, 79, 3], [7, 76, 1], [8, 72, 8]],
    ];
    const A2 = [
      [[0, 77, 3], [3, 81, 1], [4, 84, 2], [6, 81, 2], [8, 77, 3], [11, 74, 1], [12, 77, 4]],
      [[0, 74, 3], [3, 70, 1], [4, 74, 2], [6, 77, 2], [8, 82, 4], [12, 79, 4]],
      [[0, 77, 2], [2, 81, 2], [4, 84, 3], [7, 81, 1], [8, 77, 3], [11, 72, 1], [12, 72, 4]],
      [[0, 79, 2], [2, 76, 2], [4, 72, 2], [6, 76, 2], [8, 79, 8]],
    ];
    for (let bar = 0; bar < 32; bar++) {
      const sec = bar < 8 ? 'A' : bar < 16 ? 'A2' : bar < 24 ? 'B' : 'A3';
      const ch = sec === 'B' ? bridge[bar - 16] : prog[bar % 4], base = bar * 16;
      const fade = bar < 1 ? 0.7 : bar >= 31 ? 0.8 : 1, big = sec === 'A3' || sec === 'B';
      const add = (s, k, m, d, v, o = {}) => events.push({ s: base + s, k, m, d, v: v * fade, o });
      const root = pcAt(ch.pc, 36), fifth = root + 7;
      // bass: a round, walking two-feel
      add(0, 'bass', root, 3, 0.32, { short: true }); add(6, 'bass', fifth, 2, 0.24, { short: true }); add(8, 'bass', root + 12, 2, 0.24, { short: true }); add(12, 'bass', bar % 4 === 3 ? fifth + 2 : fifth, 3, 0.22, { short: true });
      add(0, 'pad', voiceUp(ch, 53, 4), 15, big ? 0.13 : 0.1, { atk: 0.6, rel: 1.3, cut0: 520, cut1: 1300 });
      // log drums: a rolling jungle pattern that thickens in the big verses
      add(0, 'kick', 0, 1, 0.3); add(10, 'kick', 0, 1, 0.22); if (big) add(6, 'kick', 0, 1, 0.16);
      for (const s of [0, 3, 6, 10, 12]) add(s, 'logdrum', s % 6 === 0 ? 38 : 45, 1, s === 0 ? 0.11 : 0.08);
      if (bar % 4 === 3) { add(13, 'logdrum', 50, 1, 0.1); add(14, 'logdrum', 53, 1, 0.1); add(15, 'logdrum', 57, 1, 0.09); }
      add(4, 'click', 0, 1, 0.12); add(12, 'click', 0, 1, 0.12);
      for (let s = 0; s < 16; s += 2) add(s, 'shaker', 0, 1, s % 4 === 0 ? 0.1 : 0.07, { len: 0.06 });
      // the marimba roll: chord tones on every 16th pair, softer under the lead
      const arp = voiceUp(ch, 62, 4);
      for (let k = 0; k < 8; k++) if (sec !== 'B' || k % 2 === 0) add(k * 2 + (k % 2 ? 1 : 0), 'marimba', arp[(k + (bar % 2)) % 4] + (k % 4 === 3 ? 12 : 0), 1.5, sec === 'A' && bar < 4 ? 0.08 : 0.11, { ring: 1.2 });
      // the tune: marimba lead, a flute answers in the second verse and the last one
      if (sec === 'A' || sec === 'A2' || sec === 'A3') {
        const src = (sec === 'A' ? A1 : A2)[bar % 4], up = sec === 'A3' && bar % 2 === 1 ? 12 : 0;
        for (const [s, m, d] of src) add(s, 'marimba', m + up, Math.max(1.2, d - 0.3), 0.26, { ring: 1.6 });
        if (sec !== 'A') for (const [s, m, d] of src) if (s % 8 === 0) add(s, 'lead', m - 12, d + 1, 0.19, { style: 'flute' });
      } else {
        const lad = voiceUp(ch, 69, 5);
        [0, 2, 4, 6, 8].forEach((s, n) => add(s, 'marimba', lad[n], 2, 0.22, { ring: 1.8 }));
        add(10, 'lead', lad[4], 5, 0.22, { style: 'flute' });
        add(0, 'bell', lad[2] + 12, 4, 0.08, { ring: 3 });
      }
    }
    events.sort((a, b) => a.s - b.s);
    return { events, steps: 32 * 16 };
  },
};
// Glowcap Marsh (69e): seeded original modal arrangements; no kit, sparse notes, long dark reverb.
function marshTheme(kind) {
  const titles = ['Glowcap Lullaby', 'Spores in the Hush', 'Under the Crown'];
  return {
    title: titles[kind], bpm: [66, 58, 72][kind], swing: 0.5, stepsPerBar: kind === 1 ? 12 : 16,
    meter: kind === 1 ? '6/8' : '4/4', trim: 0.75, marsh: true, level: [1, 0.60, 0.66][kind],
    key: ['D Lydian', 'C whole-tone', 'E minor / E major lift'][kind],
    build() {
      const events = [], rng = mulberry32(6900 + kind), barSteps = kind === 1 ? 12 : 16;
      const lydian = [74, 76, 78, 80, 81, 83, 85], whole = [60, 62, 64, 66, 68, 70];
      let previous = 60;
      for (let bar = 0; bar < 32; bar++) {
        const add = (s, k, m, d, v, o = {}) => events.push({ s: bar * barSteps + s, k, m, d, v, o });
        if (kind === 0) {
          if (bar % 2 === 0) add(0, 'glasspad', bar % 8 < 4 ? [50, 57, 66, 68] : [52, 59, 66, 73], 30, 0.29);
          // A recurring glass-box phrase, including the raised fourth (G sharp).
          const phrase = [[74, 78, 80], [81, 80, 76], [78, 83, 81], [80, 78, 74]][Math.floor(bar / 2) % 4];
          if (bar % 2 === 0) [0, 6, 12].forEach((s, n) => add(s, 'bell', phrase[n], 3, 0.29, { ring: 3.4 }));
          for (let n = 0; n < 2; n++) if (rng() < 0.7) add(2 + rng() * 12, 'pluck', lydian[Math.floor(rng() * lydian.length)], 2, 0.13, { ring: 1.8, bright: 2.5 });
        } else if (kind === 1) {
          if (bar % 4 === 0) add(0, 'drone', 36, 45, 0.25);
          if (bar % 2 === 0) {
            const m = whole[Math.floor(rng() * whole.length)];
            add(1, 'theremin', m, 17, 0.28, { from: previous }); previous = m;
          }
          if (rng() < 0.78) add(3 + rng() * 7, 'plip', 81 + 2 * Math.floor(rng() * 4), 1, 0.20);
          for (const s of [0.5, 6.5, 10.5]) if (rng() < 0.4) add(s + rng() * 0.7, 'click', 0, 1, 0.045);
        } else {
          const bright = bar >= 28;
          const ch = bright ? [52, 56, 59, 64] : [[52, 55, 59, 66], [48, 55, 59, 62], [50, 57, 60, 64], [47, 54, 59, 62]][Math.floor(bar / 4) % 4];
          if (bar % 4 === 0) add(0, 'drone', bright ? 40 : 28, 60, 0.23);
          if (bar % 2 === 0) add(0, 'glasspad', ch, 28, 0.33, { reverse: true });
          add(0, 'bass', ch[0] - 12, 12, 0.23);
          if (bar % 2 === 1) add(6, 'bell', ch[2] + 24, 3, 0.20, { ring: 4.2 });
        }
      }
      events.sort((a, b) => a.s - b.s);
      return { events, steps: 32 * barSteps };
    },
  };
}
// Party Games (Step 80a): three more tracks, indices 18..20 (every older track's events stay byte-pinned). 24 bars of 16 steps each; the lobby's loops through the party region (REGION_TRACKS.party), a game's is forced at Go!
// (music.party(id): bar 1 at once, restarts when it ends) and can be sped up with music.setTempo(k). Glade Jamboree: C major calypso at 120 bpm (steel-drum marimba lead over a bouncy bass, off-beat shaker and rimshot).
// Vine Skip: A minor jungle samba at 126 bpm (log drums, a marimba riff, rolling shaker). Timber Trim: D major hoedown at 138 bpm (a plucked fiddle lead, a washboard shaker, an oom-pah bass).
function partyTheme(kind) {
  const defs = [
    { title: 'Glade Jamboree', bpm: 120, swing: 0.56, trim: 0.46 },
    { title: 'Vine Skip', bpm: 126, swing: 0.54, trim: 0.46 },
    { title: 'Timber Trim', bpm: 138, swing: 0.56, trim: 0.46 },
  ];
  const d = defs[kind];
  return {
    ...d, stepsPerBar: 16, meter: '4/4',
    build() {
      const events = [];
      const prog = [
        [chord('C'), chord('A', 'min'), chord('F'), chord('G'), chord('C'), chord('F'), chord('G'), chord('C')],
        [chord('A', 'min'), chord('G'), chord('F'), chord('E', 'dom7'), chord('A', 'min'), chord('G'), chord('F'), chord('E', 'dom7')],
        [chord('D'), chord('D'), chord('G'), chord('D'), chord('A'), chord('G'), chord('D'), chord('A', 'dom7')],
      ][kind];
      const lead = [
        [[0, 76, 3], [3, 79, 1], [4, 81, 2], [6, 79, 2], [8, 76, 3], [11, 74, 1], [12, 72, 4]],
        [[0, 69, 2], [2, 72, 2], [4, 76, 3], [7, 72, 1], [8, 69, 2], [10, 67, 2], [12, 69, 4]],
        [[0, 74, 1], [1, 78, 1], [2, 81, 2], [4, 78, 1], [5, 74, 1], [6, 78, 2], [8, 81, 1], [9, 78, 1], [10, 74, 2], [12, 78, 2], [14, 74, 2]],
      ][kind];
      for (let bar = 0; bar < 24; bar++) {
        const ch = prog[bar % 8], base = bar * 16, sec = Math.floor(bar / 8);                   // three verses, the last the biggest
        const add = (s, k, m, dd, v, o = {}) => events.push({ s: base + s, k, m, d: dd, v: v * (bar === 0 ? 0.75 : 1), o });
        const root = pcAt(ch.pc, 38), fifth = pcAt((ch.pc + 7) % 12, 38), big = sec === 2;
        const arp = voiceUp(ch, 60, 4), up = (bar % 2 === 1 && sec > 0 ? 12 : 0);
        if (kind === 0) {                                                // calypso
          add(0, 'bass', root, 3, 0.4, { short: true }); add(3, 'bass', root + 12, 1.5, 0.26, { short: true }); add(6, 'bass', fifth, 2, 0.3, { short: true }); add(8, 'bass', root, 3, 0.38, { short: true }); add(11, 'bass', fifth, 2, 0.3, { short: true }); add(14, 'bass', root + 12, 1.5, 0.24, { short: true });
          add(0, 'kick', 0, 1, 0.3); add(8, 'kick', 0, 1, 0.26); add(4, 'click', 0, 1, 0.16); add(12, 'click', 0, 1, 0.16); add(7, 'click', 0, 1, 0.1);
          for (let s = 2; s < 16; s += 4) { add(s, 'shaker', 0, 1, 0.1, { len: 0.06 }); add(s - 1 < 0 ? 0 : s - 1, 'shaker', 0, 1, 0.05, { len: 0.04 }); }
          for (const s of [2, 6, 10, 14]) arp.slice(0, 3).forEach((m, i) => add(s + i * 0.12, 'pluck', m, 1, 0.1, { ring: 0.5, bright: 3 }));
          if (bar >= 1) for (const [s, m, len] of lead) { add(s, 'marimba', m + up, Math.max(1, len - 0.3), 0.3, { ring: 1.5 }); if (sec > 0) add(s, 'bell', m + 12 + up, 1.5, 0.1, { ring: 1.6 }); }
          add(0, 'pad', voiceUp(ch, 55, 3), 15, 0.08, { atk: 0.4, rel: 1, cut0: 500, cut1: 1100 });
        } else if (kind === 1) {                                         // jungle samba
          for (const s of [0, 3, 6, 8, 11, 14]) add(s, 'logdrum', s % 6 === 0 ? 50 : 57, 1, s === 0 ? 0.14 : 0.1);
          add(0, 'kick', 0, 1, 0.34); add(6, 'kick', 0, 1, 0.2); add(10, 'kick', 0, 1, 0.24); add(4, 'click', 0, 1, 0.13); add(12, 'click', 0, 1, 0.13);
          for (let s = 0; s < 16; s++) add(s, 'shaker', 0, 1, s % 4 === 2 ? 0.12 : 0.06, { len: 0.05 });
          add(0, 'bass', root, 3, 0.42, { short: true }); add(3, 'bass', root + 12, 1.5, 0.26, { short: true }); add(8, 'bass', fifth, 3, 0.34, { short: true }); add(11, 'bass', root, 2, 0.28, { short: true }); add(14, 'bass', fifth + 2, 1.5, 0.24, { short: true });
          for (let k = 0; k < 8; k++) add(k * 2, 'marimba', arp[(k + bar) % 4] + (k % 4 === 3 ? 12 : 0), 1.4, bar < 2 ? 0.09 : 0.13, { ring: 1.1 });
          if (bar >= 1) for (const [s, m, len] of lead) add(s, 'marimba', m + up + (sec === 2 ? 12 : 0), Math.max(1, len - 0.3), 0.3, { ring: 1.4 });
          if (sec > 0 && bar % 2 === 0) add(0, 'lead', arp[2] + 12, 8, 0.12, { style: 'flute' });
        } else {                                                         // hoedown
          add(0, 'bass', root, 3, 0.4, { short: true }); add(4, 'bass', fifth, 2, 0.3, { short: true }); add(8, 'bass', root, 3, 0.38, { short: true }); add(12, 'bass', fifth, 2, 0.3, { short: true });
          add(0, 'kick', 0, 1, 0.3); add(8, 'kick', 0, 1, 0.28); add(4, 'click', 0, 1, 0.18); add(12, 'click', 0, 1, 0.18);
          for (let s = 0; s < 16; s += 2) { add(s, 'shaker', 0, 1, s % 4 === 0 ? 0.12 : 0.08, { len: 0.03 }); add(s + 1, 'shaker', 0, 1, 0.05, { len: 0.02 }); }
          for (const s of [2, 6, 10, 14]) arp.slice(0, 3).forEach((m, i) => add(s + i * 0.1, 'pluck', m, 1, 0.16, { ring: 0.5, bright: 5 }));
          if (bar >= 1) for (const [s, m, len] of lead) add(s, 'pluck', m + (big && bar % 2 ? 12 : 0), Math.max(0.8, len * 0.9), 0.3, { ring: 0.9, bright: 6 });
          if (big) add(0, 'bell', arp[1] + 24, 2, 0.08, { ring: 1.2 });
        }
      }
      events.sort((a, b) => a.s - b.s);
      return { events, steps: 24 * 16 };
    },
  };
}
// Step 80b: two more party tracks, indices 21 and 22 (every older track's events stay byte-pinned). 24 bars of 12 steps each.
// Signal Flags (Marlo Says): a G-major sea shanty in 6/8 at 104 bpm (the engine counts a 4-step beat, so a bar is two lilting dotted-quarter pulses of 6 steps): a concertina-like square lead over an oom-pah bass, chord
// stabs, a rimshot and a ship's bell; music.setTempo() lets the shanty chase the flags as they get faster. Pinecone Waltz (Pinecone Huddle): an E-minor 3/4 waltz at a STEADY 90 bpm (nothing in it follows the drops):
// a music box and a celesta over a soft pad, soft timpani on the downbeats of the later verses.
function partyTheme2(kind) {
  const defs = [
    { title: 'Signal Flags', bpm: 104, swing: 0.5, trim: 0.46, meter: '6/8' },
    { title: 'Pinecone Waltz', bpm: 90, swing: 0.5, trim: 0.5, meter: '3/4' },
  ];
  const d = defs[kind];
  return {
    ...d, stepsPerBar: 12,
    build() {
      const events = [];
      const prog = [
        [chord('G'), chord('G'), chord('C'), chord('G'), chord('G'), chord('D'), chord('G'), chord('D', 'dom7')],
        [chord('E', 'min'), chord('C'), chord('G'), chord('D'), chord('E', 'min'), chord('A', 'min'), chord('B', 'dom7'), chord('E', 'min')],
      ][kind];
      const lead = [
        [[[0, 74, 3], [3, 71, 1.5], [4.5, 74, 1.5], [6, 79, 3], [9, 74, 3]], [[0, 71, 3], [3, 67, 3], [6, 71, 3], [9, 74, 3]], [[0, 72, 3], [3, 76, 3], [6, 79, 3], [9, 76, 3]], [[0, 74, 3], [3, 71, 3], [6, 67, 6]],
          [[0, 74, 3], [3, 71, 1.5], [4.5, 74, 1.5], [6, 79, 3], [9, 81, 3]], [[0, 78, 3], [3, 74, 3], [6, 69, 3], [9, 74, 3]], [[0, 71, 3], [3, 74, 3], [6, 79, 3], [9, 74, 3]], [[0, 69, 3], [3, 72, 3], [6, 71, 3], [9, 67, 3]]],
        [[[0, 79, 3], [3, 83, 3], [6, 81, 3], [9, 79, 3]], [[0, 76, 3], [3, 79, 3], [6, 84, 6]], [[0, 83, 3], [3, 79, 3], [6, 74, 3], [9, 79, 3]], [[0, 78, 3], [3, 74, 3], [6, 81, 6]],
          [[0, 83, 3], [3, 86, 3], [6, 83, 3], [9, 79, 3]], [[0, 81, 3], [3, 76, 3], [6, 72, 3], [9, 76, 3]], [[0, 75, 3], [3, 78, 3], [6, 81, 3], [9, 78, 3]], [[0, 79, 12]]],
      ][kind];
      for (let bar = 0; bar < 24; bar++) {
        const ch = prog[bar % 8], base = bar * 12, sec = Math.floor(bar / 8), melody = lead[bar % 8];
        const add = (s, k, m, dd, v, o = {}) => events.push({ s: base + s, k, m, d: dd, v: v * (bar === 0 ? 0.75 : 1), o });
        const root = pcAt(ch.pc, 38), fifth = pcAt((ch.pc + 7) % 12, 38), triad = voiceUp(ch, 62, 3);
        if (kind === 0) {                                                // sea shanty
          add(0, 'bass', root, 4, 0.4, { short: true }); add(6, 'bass', fifth, 4, 0.32, { short: true });
          add(0, 'kick', 0, 1, 0.28); add(6, 'kick', 0, 1, 0.22); add(3, 'click', 0, 1, 0.14); add(9, 'click', 0, 1, 0.14);
          for (let s = 0; s < 12; s += 1.5) add(s, 'shaker', 0, 1, s % 3 === 0 ? 0.1 : 0.05, { len: 0.04 });
          for (const s of [3, 9]) add(s, 'concertina', triad, 2.4, 0.1, { bright: 1800 });
          if (bar >= 1) for (const [s, m, len] of melody) add(s, 'concertina', m + (sec === 2 && bar % 2 ? 12 : 0), Math.max(1.4, len - 0.2), sec === 0 ? 0.2 : 0.24, { bright: 2500 });
          if (sec > 0) for (const [s, m] of melody) if (s % 6 === 0) add(s, 'pluck', m - 12, 2, 0.1, { ring: 0.6, bright: 4 });
          if (bar % 4 === 0) add(0, 'bell', ch.pc + 72 - (ch.pc > 6 ? 12 : 0), 3, 0.09, { ring: 1.8 });
        } else {                                                         // waltz
          add(0, 'bass', root, 6, 0.3, { short: true });
          for (const s of [4, 8]) triad.forEach((m, i) => add(s + i * 0.12, 'celesta', m + 12, 2, 0.07, { ring: 1.2 }));
          add(0, 'pad', voiceUp(ch, 52, 3), 12, 0.08, { atk: 0.6, rel: 1, cut0: 480, cut1: 1000 });
          if (bar >= 1) for (const [s, m, len] of melody) add(s, 'bell', m, Math.max(1, len - 0.3), 0.2, { ring: 1.5 });
          if (sec >= 1) for (const [s, m] of melody) if (s === 0) add(s, 'celesta', m + 12, 3, 0.09, { ring: 1.8 });
          if (sec >= 1 && bar % 2 === 0) add(0, 'timpani', root - 12, 2, 0.13);
          if (bar % 8 === 7 && sec >= 1) { add(6, 'timpani', root - 12, 1, 0.07); add(9, 'timpani', root - 12, 1, 0.09); }
        }
      }
      events.sort((a, b) => a.s - b.s);
      return { events, steps: 24 * 12 };
    },
  };
}
// Step 80c: four more party tracks, indices 23..26 (every older track's events stay byte-pinned). Fuse Box (Sizzle Seed, 23): A minor, 132 bpm, 4/4: ticking pizzicato, a tense bass ostinato, a hi-hat that goes
// from 8ths to 16ths by the last verse (the game also speeds the tempo with the seed's glow, which is its age, never the real timer). Henhouse Polka (Egg Scramble, 24): C major, 150 bpm, 2/4 (a bar is 8 steps,
// 64 bars): an oom-pah bass and chord, chirpy bird-whistle lead with quick trills, woodblock pecks. The two extra LOBBY tracks, which rotate with Glade Jamboree: Sunny Skip (25: a bouncy ukulele and marimba
// skip in G major, 108 bpm, swung) and Bubblegum Shuffle (26: a gentle bubbly synth-pop shuffle in F major, 96 bpm, e-piano stabs, bell bubbles and water-drop plips).
function partyTheme3(kind) {
  const defs = [
    { title: 'Fuse Box', bpm: 132, swing: 0.5, trim: 0.46, bars: 24, spb: 16 },
    { title: 'Henhouse Polka', bpm: 150, swing: 0.5, trim: 0.46, bars: 64, spb: 8, meter: '2/4' },
    { title: 'Sunny Skip', bpm: 108, swing: 0.6, trim: 0.46, bars: 24, spb: 16 },
    { title: 'Bubblegum Shuffle', bpm: 96, swing: 0.62, trim: 0.46, bars: 24, spb: 16 },
  ];
  const d = defs[kind];
  return {
    title: d.title, bpm: d.bpm, swing: d.swing, trim: d.trim, stepsPerBar: d.spb, ...(d.meter ? { meter: d.meter } : {}),
    build() {
      const events = [];
      const prog = [
        [chord('A', 'min'), chord('A', 'min'), chord('F'), chord('E', 'dom7'), chord('A', 'min'), chord('D', 'min'), chord('E', 'dom7'), chord('A', 'min')],
        [chord('C'), chord('C'), chord('G'), chord('G', 'dom7'), chord('C'), chord('F'), chord('G'), chord('C')],
        [chord('G'), chord('E', 'min'), chord('C'), chord('D'), chord('G'), chord('C'), chord('D'), chord('G')],
        [chord('F'), chord('D', 'min'), chord('Bb'), chord('C'), chord('F'), chord('A', 'min'), chord('Bb'), chord('C')],
      ][kind];
      const lead = [
        [[[0, 69, 2], [3, 72, 1], [6, 76, 2], [10, 75, 1], [12, 72, 3]], [[0, 69, 2], [4, 71, 2], [8, 72, 4], [14, 71, 1]], [[0, 72, 2], [3, 69, 1], [6, 65, 2], [10, 69, 2], [12, 72, 3]], [[0, 71, 2], [3, 68, 1], [6, 71, 2], [8, 76, 6]],
          [[0, 69, 2], [3, 72, 1], [6, 76, 2], [10, 79, 2], [12, 76, 3]], [[0, 74, 2], [4, 77, 2], [8, 74, 2], [12, 69, 3]], [[0, 76, 2], [3, 75, 1], [6, 71, 2], [8, 68, 4], [14, 71, 1]], [[0, 69, 8], [10, 72, 2], [12, 69, 4]]],
        [[[0, 84, 1], [1, 88, 1], [2, 91, 1], [3, 88, 1], [4, 84, 2], [6, 79, 2]], [[0, 88, 1], [1, 91, 1], [2, 96, 2], [4, 91, 2], [6, 88, 2]], [[0, 86, 1], [1, 91, 1], [2, 95, 1], [3, 91, 1], [4, 86, 2], [6, 83, 2]], [[0, 86, 2], [2, 83, 1], [3, 86, 1], [4, 89, 3], [7, 86, 1]],
          [[0, 84, 1], [1, 88, 1], [2, 91, 1], [3, 96, 1], [4, 91, 2], [6, 88, 2]], [[0, 89, 1], [1, 93, 1], [2, 96, 2], [4, 93, 2], [6, 89, 2]], [[0, 91, 1], [1, 86, 1], [2, 91, 1], [3, 95, 1], [4, 91, 2], [6, 86, 2]], [[0, 88, 2], [2, 84, 2], [4, 79, 2], [6, 84, 2]]],
        [[[0, 79, 3], [3, 83, 1], [4, 86, 3], [7, 83, 1], [8, 79, 2], [10, 74, 2], [12, 79, 4]], [[0, 76, 3], [3, 79, 1], [4, 83, 3], [7, 79, 1], [8, 76, 4], [12, 71, 4]], [[0, 76, 3], [3, 79, 1], [4, 84, 3], [7, 79, 1], [8, 76, 2], [10, 72, 2], [12, 76, 4]], [[0, 78, 3], [3, 81, 1], [4, 86, 3], [7, 81, 1], [8, 78, 2], [10, 74, 2], [12, 78, 4]],
          [[0, 79, 3], [3, 83, 1], [4, 86, 3], [7, 91, 1], [8, 86, 2], [10, 83, 2], [12, 79, 4]], [[0, 84, 3], [3, 79, 1], [4, 76, 3], [7, 79, 1], [8, 84, 4], [12, 79, 4]], [[0, 78, 3], [3, 81, 1], [4, 86, 3], [7, 81, 1], [8, 78, 4], [12, 74, 4]], [[0, 79, 4], [4, 74, 4], [8, 79, 8]]],
        [[[0, 77, 3], [3, 81, 2], [6, 84, 2], [8, 81, 4], [12, 77, 4]], [[0, 74, 3], [3, 77, 2], [6, 81, 2], [8, 77, 4], [12, 74, 4]], [[0, 74, 3], [3, 77, 2], [6, 82, 2], [8, 79, 4], [12, 77, 4]], [[0, 76, 3], [3, 79, 2], [6, 84, 2], [8, 79, 4], [12, 76, 4]],
          [[0, 77, 3], [3, 81, 2], [6, 84, 2], [8, 89, 4], [12, 84, 4]], [[0, 81, 3], [3, 84, 2], [6, 88, 2], [8, 84, 4], [12, 81, 4]], [[0, 82, 3], [3, 86, 2], [6, 82, 2], [8, 79, 4], [12, 74, 4]], [[0, 76, 4], [4, 79, 4], [8, 84, 8]]],
      ][kind];
      for (let bar = 0; bar < d.bars; bar++) {
        const ch = prog[bar % 8], base = bar * d.spb, sec = Math.floor(bar / (d.bars / 3)), melody = lead[bar % 8], big = sec === 2;
        const add = (st, k, m, dd, v, o = {}) => events.push({ s: base + st, k, m, d: dd, v: v * (bar === 0 ? 0.75 : 1), o });
        const root = pcAt(ch.pc, 38), fifth = pcAt((ch.pc + 7) % 12, 38), arp = voiceUp(ch, 60, 4), triad = voiceUp(ch, 55, 3);
        if (kind === 0) {                                                // Fuse Box
          for (const st of [0, 2, 3, 5, 8, 10, 11, 13]) add(st, 'bass', st % 8 === 0 ? root : st % 8 === 3 ? root + 12 : fifth, 1.2, st % 8 === 0 ? 0.4 : 0.26, { short: true });
          add(0, 'kick', 0, 1, 0.3); add(8, 'kick', 0, 1, 0.26); add(4, 'click', 0, 1, 0.14); add(12, 'click', 0, 1, 0.14);
          for (let st = 0; st < 16; st += 2) add(st, 'pluck', st % 4 === 0 ? arp[0] + 12 : arp[2] + 12, 1, bar < 2 ? 0.12 : 0.17, { ring: 0.16, bright: 3 });                  // the fuse ticking: tick, tock
          for (let st = 0; st < 16; st += sec === 2 ? 1 : 2) add(st, 'shaker', 0, 1, st % 4 === 0 ? 0.1 : 0.06, { len: 0.025 });                                                 // the hi-hat doubles in the last verse
          if (bar >= 1) for (const [st, m, len] of melody) add(st, sec === 0 ? 'bell' : 'marimba', m + (big ? 12 : 0), Math.max(1, len - 0.3), sec === 0 ? 0.2 : 0.26, { ring: 1.1 });
          if (sec >= 1 && bar % 2 === 0) add(0, 'pad', voiceUp(ch, 55, 3), 15, 0.07, { atk: 0.3, rel: 0.8, cut0: 500, cut1: 1200 });
          if (bar % 4 === 3) add(14, 'bell', 100, 1.2, 0.07, { ring: 0.6 });                                                                                                      // a little spark
        } else if (kind === 1) {                                         // Henhouse Polka
          add(0, 'bass', root, 3, 0.4, { short: true }); add(4, 'bass', fifth, 3, 0.32, { short: true });
          for (const st of [4, 6]) arp.slice(0, 3).forEach((m, i) => add(st + i * 0.08, 'pluck', m, 1, st === 4 ? 0.16 : 0.1, { ring: 0.4, bright: 5 }));
          add(0, 'kick', 0, 1, 0.24); add(4, 'click', 0, 1, 0.16); add(2, 'logdrum', 76, 1, 0.07); add(6, 'logdrum', 81, 1, 0.07);
          for (let st = 0; st < 8; st += 2) add(st, 'shaker', 0, 1, 0.08, { len: 0.03 });
          if (bar >= 2) for (const [st, m, len] of melody) { add(st, 'lead', m, Math.max(0.5, len * 0.8), sec === 0 ? 0.13 : 0.17, { style: 'flute' }); if (len <= 1 && sec > 0) add(st + 0.5, 'lead', m + 12, 0.5, 0.06, { style: 'flute' }); }     // quick chirps
          if (big) add(0, 'bell', arp[1] + 24, 1.5, 0.07, { ring: 0.8 });
        } else if (kind === 2) {                                         // Sunny Skip
          add(0, 'bass', root, 3, 0.38, { short: true }); add(3, 'bass', fifth, 2, 0.28, { short: true }); add(6, 'bass', root + 12, 1.5, 0.24, { short: true }); add(8, 'bass', root, 3, 0.36, { short: true }); add(11, 'bass', fifth, 2, 0.28, { short: true }); add(14, 'bass', fifth, 1.5, 0.22, { short: true });
          add(0, 'kick', 0, 1, 0.22); add(8, 'kick', 0, 1, 0.2); add(4, 'click', 0, 1, 0.12); add(12, 'click', 0, 1, 0.12);
          for (const st of [2, 6, 10, 14]) arp.slice(0, 3).forEach((m, i) => add(st + i * 0.1, 'pluck', m, 1, 0.13, { ring: 0.45, bright: 4 }));                                    // ukulele upstrokes
          for (let st = 1; st < 16; st += 2) add(st, 'shaker', 0, 1, 0.06, { len: 0.04 });
          if (bar >= 1) for (const [st, m, len] of melody) add(st, 'marimba', m + (sec === 2 && bar % 2 ? 12 : 0), Math.max(1, len - 0.3), 0.3, { ring: 1.4 });
          if (sec > 0) add(0, 'pad', voiceUp(ch, 55, 3), 15, 0.06, { atk: 0.4, rel: 1, cut0: 500, cut1: 1100 });
        } else {                                                         // Bubblegum Shuffle
          add(0, 'bass', root, 4, 0.36, { short: true }); add(6, 'bass', fifth, 3, 0.26, { short: true }); add(10, 'bass', root, 4, 0.32, { short: true });
          add(0, 'kick', 0, 1, 0.2); add(10, 'kick', 0, 1, 0.16); add(4, 'click', 0, 1, 0.11); add(12, 'click', 0, 1, 0.11);
          for (const st of [3, 7, 11, 15]) add(st, 'ep', triad[bar % 3] + 12, 2, 0.1, { ring: 0.7, index: 1.1 });
          add(0, 'ep', triad[0] + 12, 3, 0.09, { ring: 1.2, index: 1.3 }); add(8, 'ep', triad[2] + 12, 3, 0.08, { ring: 1.2, index: 1.3 });
          for (let k = 0; k < 4; k++) add(k * 4 + 1, 'plip', arp[(k + bar) % 4] + 24, 1, 0.07);                                                                                 // bubbles
          if (bar >= 1) for (const [st, m, len] of melody) add(st, sec === 0 ? 'bell' : 'ep', m, Math.max(1, len - 0.3), sec === 0 ? 0.2 : 0.14, { ring: 1.3, index: 0.9 });
          add(0, 'pad', voiceUp(ch, 53, 3), 15, 0.07, { atk: 0.5, rel: 1, cut0: 480, cut1: 1000 });
        }
      }
      events.sort((a, b) => a.s - b.s);
      return { events, steps: d.bars * d.spb };
    },
  };
}
// Step 80d, indices 27 / 28. Append only: the event pins of tracks 0..26 are unchanged.
function partyTheme4(kind) {
  return { title:kind ? 'Spore Bounce':'Flume Swing', bpm:kind ? 112:132, swing:kind ? 0.5:0.66, trim:0.46, stepsPerBar:16,
    build() {
      const events=[], prog=kind ? [chord('E','min'),chord('C'),chord('A','min'),chord('B','dom7')] : [chord('F'),chord('D','min'),chord('G','min'),chord('C','dom7')];
      for(let bar=0;bar<32;bar++) {
        const ch=prog[bar%4], root=pcAt(ch.pc,36), notes=voiceUp(ch,65,4), base=bar*16;
        const add=(s,k,m,d,v,o={})=>events.push({s:base+s,k,m,d,v,o});
        for(let beat=0;beat<4;beat++) {
          add(beat*4,kind?'theremin':'bass',root+[0,4,7,9][beat],kind?2.4:2.8,kind?0.2:0.35,kind?{from:root-2}:{short:true});
          add(beat*4,beat%2?'click':'kick',0,1,0.12);
          add(beat*4+2,'shaker',0,1,0.06,{len:0.04});
          add(beat*4+(beat%2?2:0),kind?'glassMarimba':'mutedTrumpet',notes[(beat+bar)%4]+(bar%8>5?12:0),2.5,0.22);
          if(!kind)notes.slice(0,3).forEach((m,i)=>add(beat*4+2+i*0.1,'pluck',m,1,0.07,{ring:0.35,bright:3}));
        }
        if(kind)add(0,'glasspad',voiceUp(ch,52,3),15,0.045,{});
      }
      events.sort((a,b)=>a.s-b.s);return {events,steps:512};
    },
  };
}
// Step 81a, indices 29 / 30 (append only: every older track's events stay byte-pinned). Moonlit Mix-Up (Glowcap Shuffle, 29): a soft bossa nova in D, 100 bpm, 4/4: a bossa bass, rim-click clave, brushed shaker, glass marimba
// chord stabs, a breathy flute melody in Duskcrown's palette and a quiet bell on every count. Sunset Jetty (Driftwood Cast, 30): a laid-back steel-pan calypso in C, 104 bpm, swung: a calypso bass, boom-chick strums,
// a shaker on the off-beats, marimba / bell "steel pan" doubles and a whistle lead.
function partyTheme5(kind) {
  const defs = [{ title: 'Moonlit Mix-Up', bpm: 100, swing: 0.54, trim: 0.46 }, { title: 'Sunset Jetty', bpm: 104, swing: 0.58, trim: 0.46 }], d = defs[kind], BARS = 24, SPB = 16;
  return {
    title: d.title, bpm: d.bpm, swing: d.swing, trim: d.trim, stepsPerBar: SPB,
    build() {
      const events = [];
      const prog = [
        [chord('D', 'min7'), chord('G', 'dom7'), chord('C', 'maj7'), chord('F', 'maj7'), chord('E', 'min7'), chord('A', 'dom7'), chord('D', 'min7'), chord('A', 'dom7')],
        [chord('C'), chord('C'), chord('F'), chord('C'), chord('G', 'dom7'), chord('F'), chord('C'), chord('G', 'dom7')],
      ][kind];
      const lead = [
        [[[0, 74, 3], [4, 77, 2], [7, 76, 1], [8, 74, 4]], [[0, 71, 3], [4, 74, 2], [7, 77, 1], [8, 76, 4]], [[0, 72, 3], [4, 76, 2], [7, 79, 1], [8, 76, 4]], [[0, 77, 3], [4, 76, 2], [7, 72, 1], [8, 69, 4]],
          [[0, 71, 3], [4, 74, 2], [7, 76, 1], [8, 79, 4]], [[0, 73, 3], [4, 76, 2], [7, 81, 1], [8, 79, 4]], [[0, 74, 3], [4, 77, 2], [7, 81, 1], [8, 77, 4]], [[0, 76, 3], [4, 73, 2], [7, 69, 1], [8, 74, 6]]],
        [[[0, 79, 2], [3, 84, 1], [4, 83, 2], [8, 79, 2], [12, 76, 3]], [[0, 79, 2], [3, 84, 1], [4, 83, 2], [8, 79, 4]], [[0, 77, 2], [3, 81, 1], [4, 84, 2], [8, 81, 2], [12, 77, 3]], [[0, 76, 2], [3, 79, 1], [4, 83, 2], [8, 79, 4]],
          [[0, 83, 2], [3, 86, 1], [4, 83, 2], [8, 79, 2], [12, 83, 3]], [[0, 84, 2], [3, 81, 1], [4, 77, 2], [8, 81, 4]], [[0, 79, 2], [3, 84, 1], [4, 88, 2], [8, 84, 2], [12, 79, 3]], [[0, 83, 3], [4, 79, 2], [8, 74, 2], [10, 79, 6]]],
      ][kind];
      for (let bar = 0; bar < BARS; bar++) {
        const ch = prog[bar % 8], base = bar * SPB, sec = Math.floor(bar / 8), melody = lead[bar % 8];
        const add = (st, k, m, dd, v, o = {}) => events.push({ s: base + st, k, m, d: dd, v: v * (bar === 0 ? 0.75 : 1), o });
        const root = pcAt(ch.pc, 38), fifth = pcAt((ch.pc + 7) % 12, 38), stab = voiceUp(ch, 57, 4), arp = voiceUp(ch, 62, 4);
        if (kind === 0) {                                                // Moonlit Mix-Up
          add(0, 'bass', root, 5, 0.34, { short: true }); add(6, 'bass', fifth, 3, 0.26, { short: true }); add(8, 'bass', root, 5, 0.3, { short: true }); add(14, 'bass', fifth, 2, 0.22, { short: true });
          for (const st of [0, 3, 6, 10, 12]) add(st, 'click', 0, 1, st === 0 ? 0.13 : 0.1);                                                 // the bossa clave
          add(0, 'kick', 0, 1, 0.16); add(10, 'kick', 0, 1, 0.12);
          for (let st = 0; st < 16; st += 2) add(st, 'shaker', 0, 1, st % 4 === 0 ? 0.07 : 0.05, { len: 0.05 });
          for (const st of [3, 6, 11]) add(st, 'glassMarimba', stab[(st + bar) % 4] + (st === 11 ? 12 : 0), 2, 0.16);                          // soft chord stabs
          for (let q = 0; q < 4; q++) add(q * 4, 'bell', root + 36, 1, 0.045, { ring: 0.7 });                                                  // a bell on every count
          if (bar >= 2) for (const [st, m, len] of melody) add(st, 'lead', m + (sec === 2 && bar % 2 ? 12 : 0), Math.max(1, len - 0.2), sec === 0 ? 0.2 : 0.25, { style: 'flute' });
          if (sec > 0) add(0, 'glasspad', voiceUp(ch, 50, 3), 15, 0.04, {});
        } else {                                                         // Sunset Jetty
          add(0, 'bass', root, 5, 0.38, { short: true }); add(6, 'bass', fifth, 2, 0.28, { short: true }); add(8, 'bass', root, 5, 0.34, { short: true }); add(11, 'bass', fifth, 2, 0.26, { short: true }); add(14, 'bass', root + 12, 2, 0.22, { short: true });
          add(0, 'kick', 0, 1, 0.22); add(8, 'kick', 0, 1, 0.18); add(4, 'click', 0, 1, 0.13); add(12, 'click', 0, 1, 0.13);
          for (const st of [3, 7, 11, 15]) arp.slice(0, 3).forEach((m, i) => add(st + i * 0.1, 'pluck', m, 1, 0.11, { ring: 0.4, bright: 4 }));        // boom-chick strums
          for (let st = 2; st < 16; st += 4) add(st, 'shaker', 0, 1, 0.08, { len: 0.04 });
          if (bar >= 1) for (const [st, m, len] of melody) { add(st, 'marimba', m - 12 + (sec === 2 ? 12 : 0), Math.max(1, len - 0.3), 0.26, { ring: 1.2 }); if (sec > 0 && len >= 2) add(st, 'bell', m + 12, 1, 0.07, { ring: 0.8 }); }     // the steel pan
          if (bar >= 4 && bar % 2 === 0) for (const [st, m, len] of melody.slice(0, 3)) add(st + 8, 'lead', m + 12, Math.max(1, len - 0.4), 0.2, { style: 'whistle' });          // the whistle answers
        }
      }
      events.sort((a, b) => a.s - b.s);
      return { events, steps: BARS * SPB };
    },
  };
}
// Step 81b, indices 31 / 32 (append only: every older track's events stay byte-pinned). Tilty Tune (Tilty Tiles, 31): a bouncy tuba-and-accordion polka in F major, 132 bpm, 2/4 (a bar is 8 steps, 64 bars): a tuba
// "oom" (bass) on the beat, an accordion (concertina) "pah" chord on the off-beat, a snare click, woodblock hops and an accordion melody that gets a bell double in the last verse. Mallet March (Bonk Burrows, 32): a
// cartoon oompah march in C major, 120 bpm, 4/4 (32 bars): tuba oom-pah, a snare roll on the ends of phrases, woodblock hits, a muted-trumpet march melody and slide-whistle swoops (a quick theremin glide) at phrase ends.
function partyTheme6(kind) {
  const defs = [{ title: 'Tilty Tune', bpm: 132, swing: 0.5, trim: 0.46, bars: 64, spb: 8, meter: '2/4' }, { title: 'Mallet March', bpm: 120, swing: 0.5, trim: 0.46, bars: 32, spb: 16 }], d = defs[kind];
  return {
    title: d.title, bpm: d.bpm, swing: d.swing, trim: d.trim, stepsPerBar: d.spb, ...(d.meter ? { meter: d.meter } : {}),
    build() {
      const events = [];
      const prog = [
        [chord('F'), chord('F'), chord('C', 'dom7'), chord('F'), chord('Bb'), chord('F'), chord('C', 'dom7'), chord('F')],
        [chord('C'), chord('C'), chord('F'), chord('C'), chord('G', 'dom7'), chord('C'), chord('F'), chord('G', 'dom7')],
      ][kind];
      const lead = [
        [[[0, 72, 1], [1, 74, 1], [2, 76, 1], [3, 77, 1], [4, 81, 2], [6, 77, 2]], [[0, 76, 1], [1, 77, 1], [2, 79, 1], [3, 77, 1], [4, 76, 2], [6, 72, 2]], [[0, 74, 1], [1, 76, 1], [2, 77, 1], [3, 79, 1], [4, 82, 2], [6, 79, 2]], [[0, 81, 2], [2, 77, 2], [4, 74, 1], [5, 76, 1], [6, 72, 2]],
          [[0, 77, 1], [1, 79, 1], [2, 82, 1], [3, 79, 1], [4, 77, 2], [6, 74, 2]], [[0, 72, 1], [1, 74, 1], [2, 77, 1], [3, 81, 1], [4, 84, 2], [6, 81, 2]], [[0, 79, 1], [1, 77, 1], [2, 76, 1], [3, 74, 1], [4, 70, 2], [6, 74, 2]], [[0, 77, 2], [2, 81, 2], [4, 84, 1], [5, 81, 1], [6, 77, 2]]],
        [[[0, 72, 3], [4, 76, 3], [8, 79, 3], [12, 76, 3]], [[0, 72, 2], [2, 74, 2], [4, 76, 4], [8, 72, 4], [12, 67, 4]], [[0, 77, 3], [4, 81, 3], [8, 84, 3], [12, 81, 3]], [[0, 79, 4], [4, 76, 4], [8, 72, 6], [14, 74, 2]],
          [[0, 74, 3], [4, 77, 3], [8, 79, 3], [12, 77, 3]], [[0, 76, 2], [2, 79, 2], [4, 84, 4], [8, 79, 4], [12, 76, 4]], [[0, 77, 3], [4, 81, 3], [8, 84, 3], [12, 88, 3]], [[0, 83, 4], [4, 79, 4], [8, 74, 4], [12, 71, 4]]],
      ][kind];
      for (let bar = 0; bar < d.bars; bar++) {
        const ch = prog[bar % 8], base = bar * d.spb, sec = Math.floor(bar / (d.bars / 3)), melody = lead[bar % 8];
        const add = (st, k, m, dd, v, o = {}) => events.push({ s: base + st, k, m, d: dd, v: v * (bar === 0 ? 0.75 : 1), o });
        const root = pcAt(ch.pc, 38), fifth = pcAt((ch.pc + 7) % 12, 38), triad = voiceUp(ch, 57, 3);
        if (kind === 0) {                                                // Tilty Tune
          add(0, 'bass', root, 3, 0.42, { short: true }); add(4, 'bass', fifth, 3, 0.34, { short: true });                           // the tuba: oom ... oom
          add(2, 'concertina', triad, 1.6, 0.1, { bright: 1800 }); add(6, 'concertina', triad, 1.6, 0.1, { bright: 1800 });          // the accordion pah
          add(0, 'kick', 0, 1, 0.22); add(4, 'click', 0, 1, 0.16); add(2, 'logdrum', 76, 1, 0.07); add(6, 'logdrum', 81, 1, 0.07);
          if (bar >= 2) for (const [st, m, len] of melody) { add(st, 'concertina', m + (sec === 2 && bar % 2 ? 12 : 0), Math.max(0.8, len - 0.15), sec === 0 ? 0.17 : 0.21, { bright: 2600 }); if (sec === 2) add(st, 'bell', m + 12, 1, 0.06, { ring: 0.7 }); }
          if (bar % 8 === 7) { add(6, 'click', 0, 1, 0.12); add(7, 'click', 0, 1, 0.14); }
        } else {                                                         // Mallet March
          for (const [st, m] of [[0, root], [4, fifth], [8, root], [12, fifth]]) add(st, 'bass', m, 3, st % 8 === 0 ? 0.4 : 0.32, { short: true });
          for (const st of [2, 6, 10, 14]) add(st, 'pluck', triad[(st / 4 | 0) % 3] + 12, 1, 0.1, { ring: 0.3, bright: 3 });
          add(0, 'kick', 0, 1, 0.26); add(8, 'kick', 0, 1, 0.24); for (const st of [4, 12]) add(st, 'click', 0, 1, 0.18);
          for (const st of [3, 7, 11, 15]) add(st, 'logdrum', st % 8 === 3 ? 76 : 81, 1, 0.07);
          if (bar >= 1) for (const [st, m, len] of melody) add(st, 'mutedTrumpet', m + (sec === 2 && bar % 2 ? 12 : 0), Math.max(1.4, len - 0.3), sec === 0 ? 0.2 : 0.25);
          if (bar % 4 === 3) { for (let s = 13; s < 16; s += 0.5) add(s, 'click', 0, 1, 0.07 + (s - 13) * 0.03); add(12, 'theremin', root + 24, 3, 0.1, { from: root + 12 }); }   // the snare roll and the slide whistle
          if (sec > 0 && bar % 2 === 0) add(0, 'pad', voiceUp(ch, 53, 3), 15, 0.05, { atk: 0.3, rel: 0.8, cut0: 500, cut1: 1100 });
        }
      }
      events.sort((a, b) => a.s - b.s);
      return { events, steps: d.bars * d.spb };
    },
  };
}
const TRACKS = [MORNING, TIDE, STROLL, CAMPFIRE, islandTheme('frost'), islandTheme('ember'),
  ANCIENT_FOREST, PINE_WHISPERS, AURORA, BAMBOO, MOON_ORCHID, MOSSBOUND_ECHOES, PAPER_MEADOW, PAPER_SNOW, PAPER_JUNGLE, marshTheme(0), marshTheme(1), marshTheme(2), partyTheme(0), partyTheme(1), partyTheme(2), partyTheme2(0), partyTheme2(1), partyTheme3(0), partyTheme3(1), partyTheme3(2), partyTheme3(3), partyTheme4(0), partyTheme4(1), partyTheme5(0), partyTheme5(1), partyTheme6(0), partyTheme6(1)];
export const REGION_TRACKS = { duskcrown: [15, 16, 17], home: [0, 2, 1, 3], frost: [4, 7, 8], ember: [5, 9, 10], ritual: [6], dungeon: [11], page: [12], 'page-frost': [13], 'page-ember': [14], party: [18, 25, 26] };
/** Step 80c: the lobby rotates through these three; after a lobby track `last` the next one is the following in the list (never the same twice in a row), and the first lobby of a party (last = null) is Glade Jamboree. */
export function nextLobbyTrack(last, list = REGION_TRACKS.party) {
  const i = list.indexOf(last);
  return i < 0 ? list[0] : list[(i + 1) % list.length];
}
/** Step 80a: the track a party game forces at Go! (music.party(id)). */
export const PARTY_TRACKS = { vineskip: 19, timber: 20, marlosays: 21, huddle: 22, sizzle: 23, eggs: 24, feastround: 27, bumpers: 28, glowcap: 29, cast: 30, tilty: 31, bonk: 32 };
export const TRACK_TITLES = TRACKS.map((t) => t.title);
const built = [];
export function getTrack(i) {
  if (!built[i]) {
    const def = TRACKS[i], b = buildTrack(def);
    const stepSec = 60 / def.bpm / 4;
    built[i] = { def, events: b.events, steps: b.steps, stepSec, beatSec: stepSec * 4 };
  }
  return built[i];
}
/** Seconds from the track start for a (fractional) step, with the swing shuffle applied to the 8ths / 16ths inside each beat. */
function stepTime(tr, step) {
  const beat = Math.floor(step / 4), p = step / 4 - beat, m = tr.def.swing;
  const sp = p < 0.5 ? p * 2 * m : m + (p - 0.5) * 2 * (1 - m);
  return (beat + sp) * tr.beatSec;
}
export function trackInfo() {
  return TRACKS.map((_, i) => { const tr = getTrack(i); return { title: tr.def.title, bpm: tr.def.bpm, meter: tr.def.meter || '4/4', bars: tr.steps / (tr.def.stepsPerBar || STEPS_PER_BAR), seconds: +stepTime(tr, tr.steps).toFixed(1), events: tr.events.length }; });
}

// ------------------------------------------------------------------------------------------------ sequencer
export class Sequencer {
  constructor(eng, tr, base) {
    this.eng = eng; this.tr = tr; this.base = base; this.i = 0; this.count = 0; this.resyncs = 0;
    if (tr.def.compressorAttack) eng.comp.attack.value = tr.def.compressorAttack;
    this.fading = false; this.fadingOut = false;
    this.k = 1;                                          // tempo scale (Step 80a: music.setTempo): 1 = the written tempo
  }
  timeOf(step) { return stepTime(this.tr, step) / this.k; }
  get endT() { return this.base + stepTime(this.tr, this.tr.steps) / this.k; }
  /** Change the tempo scale at audio time `now`: the track position continues from where it is. */
  setTempo(k, now) {
    if (!(k > 0) || k === this.k) return;
    const pos = Math.max(0, (now - this.base) * this.k);
    this.k = k;
    this.base = now - pos / k;
  }
  /** Schedule every event whose time is before `until` (audio-clock seconds). `now` (live only) resyncs the clock if the timer stalled. */
  schedule(now, until) {
    const ev = this.tr.events, e = this.eng, trim = this.tr.def.trim, ss = this.tr.stepSec;
    while (this.i < ev.length) {
      const x = ev[this.i], t = this.base + this.timeOf(x.s);
      if (t > until) break;
      if (now !== null) {
        const lag = now - t;
        if (lag > 0.25) { this.base += lag + 0.05; this.resyncs++; continue; }     // the timer stalled: shift the clock, never bunch notes up
      }
      // Soften only Morning Breeze's accompaniment. Event lists stay immutable; live, resumed and offline scheduling share this path.
      const options = x.k === 'pluck' && this.tr.def.gentleStrum ? { ...x.o, gentle: true } : x.o;
      VOICES[x.k](e, t, x.m, x.d * ss / this.k, x.v * trim, e.bus(x.k), options);
      this.i++; this.count++;
    }
  }
  /** Position the clock so that track-time `pos` (seconds) is at audio time `at`. */
  seek(pos, at) {
    this.base = at - pos;
    const ev = this.tr.events;
    let i = 0;
    while (i < ev.length && this.timeOf(ev[i].s) < pos - 1e-6) i++;
    this.i = i;
  }
}

// ------------------------------------------------------------------------------------------------ offline render (debug / level check)
/** Renders track `index` (the first `seconds`, default the whole track) into an OfflineAudioContext; levels are before the music bus (x0.3) and the master. */
export async function renderTrack(index, seconds = null, { sampleRate = 32000 } = {}) {
  const tr = getTrack(index), total = stepTime(tr, tr.steps);
  const secs = Math.min(seconds || total, total) + (tr.def.marsh ? DUSK_MUSIC.renderTail : 2);          // include the pad release and long reverb tail
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const ctx = new OAC(2, Math.ceil(secs * sampleRate), sampleRate);
  const eng = new Engine(ctx, ctx.destination, makeAssets(ctx), 1, tr.def.marsh, tr.def.level);
  const seq = new Sequencer(eng, tr, 0);
  const limit = seconds || total;
  // schedule in 4 s chunks (suspend / resume) so only the notes of the next few seconds exist in the graph, like the live look-ahead
  const CH = 4;
  seq.schedule(null, Math.min(limit, CH + 1));
  for (let t = CH; t < limit; t += CH) {
    ctx.suspend(t).then(() => { seq.schedule(null, Math.min(limit, t + CH + 1)); ctx.resume(); });
  }
  const buf = await ctx.startRendering();
  let peak = 0, sum = 0, n = 0, win = 0, winMax = 0, wn = 0;
  const W = Math.floor(sampleRate);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    win = 0; wn = 0;
    for (let i = 0; i < d.length; i++) {
      const a = d[i];
      if (a > peak) peak = a; else if (-a > peak) peak = -a;
      sum += a * a; n++;
      win += a * a; wn++;
      if (wn === W) { winMax = Math.max(winMax, Math.sqrt(win / wn)); win = 0; wn = 0; }
    }
  }
  const rms = Math.sqrt(sum / n);
  return {
    index, title: tr.def.title, seconds: +(seconds || total).toFixed(1), notes: seq.count,
    peak: +peak.toFixed(3), rms: +rms.toFixed(4), rmsDb: +(20 * Math.log10(rms)).toFixed(1), loudestSecondRms: +winMax.toFixed(4),
    atBus: { peak: +(peak * MUSIC_VOL).toFixed(3), rms: +(rms * MUSIC_VOL).toFixed(4) },
  };
}

// ------------------------------------------------------------------------------------------------ Music
export class Music {
  constructor(sfx) {
    this.sfx = sfx;
    this.ctx = null; this.bus = null; this.assets = null;
    this._enabled = true;
    try { this._enabled = localStorage.getItem(STORE_KEY) !== '0'; } catch (_) { /* storage unavailable */ }
    this._listeners = { track: new Set(), enabled: new Set() };
    this._wanted = false; this._booted = false; this._running = false;
    this._poll = 0; this._timer = 0;
    this._volume = MUSIC_VOL;
    this._impactAmount = 1; this._impactUntil = 0;
    this._duck = 1;
    this._eng = null; this._seq = null;
    this._idx = -1;              // index of the track that is playing / paused / just played
    this._nextIdx = 0;
    this.clock = null;
    this.region = () => 'home';
    this._lastRegion = null;
    this._dawnPending = false;
    this._state = 'idle';        // idle | playing | gap
    this._forced = null;         // Step 80a: a party game's track index while it plays (music.party)
    this._tempo = 1;             // ... and its tempo scale (music.setTempo)
    this._baseTempo = 0.8;       // exploration setting; party timing keeps its own unscaled tempo
    this._gapUntil = 0; this._gapLeft = GAP; this._pos = 0;
    this.stats = { notes: TRACKS.map(() => 0), total: 0, resyncs: 0, ticks: 0 };
    document.addEventListener('visibilitychange', () => this._sync());
    sfx.onChange(() => this._sync());
  }

  // ---------------------------------------------------------------- public API
  get enabled() { return this._enabled; }
  get current() { return this._idx >= 0 ? TRACKS[this._idx].title : null; }
  get currentIndex() { return this._idx; }
  get state() { return this._state; }
  get running() { return this._running; }
  get titles() { return TRACK_TITLES; }
  get duckLevel() { return this._duck; }
  get volume() { return this._volume; }
  setVolume(value) {
    const n = Number(value);
    if (Number.isFinite(n)) this._volume = clamp(n, 0, 1);
    this._applyBus();
    return this._volume;
  }

  setClock(clock) {
    this.clock = clock;
    this._dawnPending = clock.phase === 'dawn';
    clock.on('phase', (phase) => { if (phase === 'dawn') this._dawnPending = true; });
    this._nextIdx = this._chooseNext(-1);
  }

  _chooseNext(after) {
    if (this._forced !== null) return this._forced;
    const region = this.region();
    const regional = REGION_TRACKS[region];
    if (region === 'party' && regional) return nextLobbyTrack(this._lobbyLast ?? null, regional);
    if (region !== 'home' && regional) return regional[(Math.max(-1, regional.indexOf(after)) + 1) % regional.length];
    if (!this.clock) return (after + 1) % 4;
    if (this._dawnPending && this.clock.nightness < 0.7) { this._dawnPending = false; return 0; }
    const pool = this.clock.nightness > 0.55 ? [3, 1] : [0, 2, 1];
    return pool[(Math.max(-1, pool.indexOf(after)) + 1) % pool.length];
  }

  /** Called as players move, even while muted. Marsh changes fade ~3 s (4 time constants); other islands wait for track end. */
  updateRegion() {
    const region = this.region();
    if (region === this._lastRegion) return false;
    const previous = this._lastRegion;
    this._lastRegion = region;
    // (the lobby rotation is NOT reset when a party closes: reopening a party carries on with the next lobby track, so a page that
    //  opens many parties does not hear Glade Jamboree every time; only the very first lobby of the page starts with it)
    this._nextIdx = this._chooseNext(-1);
    if (!this._booted) return true;
    const marsh = previous === 'duskcrown' || region === 'duskcrown';
    const islands = ['home', 'frost', 'ember'];
    // Ordinary island changes choose the next playlist between tracks; special areas retain their existing short fade.
    if (!marsh && islands.includes(previous) && islands.includes(region)) return true;
    this._retire(marsh ? DUSK_MUSIC.regionFade / 4 : 0.65);
    this._seq = null;
    this._pos = 0;
    this._state = 'gap';
    this._gapLeft = marsh ? DUSK_MUSIC.regionFade : 0.5;
    this._gapUntil = this.ctx.currentTime + this._gapLeft;
    return true;
  }

  on(evt, fn) { const s = this._listeners[evt]; if (!s) return () => {}; s.add(fn); return () => s.delete(fn); }
  _emit(evt, arg) { for (const fn of this._listeners[evt]) { try { fn(arg); } catch (e) { console.error(e); } } }

  /** Begin (lazily: waits for the AudioContext, which needs a user gesture). Safe to call more than once. */
  start() {
    this._wanted = true;
    if (this._booted) { this._sync(); return; }
    if (this._poll) return;
    const check = () => {
      if (this.sfx.ctx && this.sfx.master && this.sfx.ctx.state === 'running') { clearInterval(this._poll); this._poll = 0; this._boot(); }
    };
    this._poll = setInterval(check, 250);
    check();
  }

  setEnabled(on) {
    on = !!on;
    if (on === this._enabled) return on;
    this._enabled = on;
    try { localStorage.setItem(STORE_KEY, on ? '1' : '0'); } catch (_) { /* ignore */ }
    this._sync();
    this._emit('enabled', on);
    return on;
  }
  toggle() { return this.setEnabled(!this._enabled); }

  /** Lower the music to `amount` (0..1 of normal) over `seconds` (the feast scene). */
  duck(amount = 0.4, seconds = 0.6) { this._duck = clamp(amount, 0, 1); this._applyBus(Math.max(0.02, seconds / 3)); }
  unduck(seconds = 1.5) { this._duck = 1; this._applyBus(Math.max(0.02, seconds / 3)); }
  /** Brief local impact duck; a scene/music change cancels its scheduled restore. */
  impact(amount = 0.707, duration = 0.25) {
    if (!this._booted) return;
    this._impactAmount = clamp(Number(amount) || 0, 0, 1);
    this._impactUntil = this.ctx.currentTime + Math.max(0, Number(duration) || 0);
    this._applyBus(0.012);
  }

  /** Skip to the next track (quick fade, then the next one starts). */
  next() {
    if (!this._booted) { this._nextIdx = this._chooseNext(this._nextIdx); return; }
    const now = this.ctx.currentTime;
    if (this._state === 'gap') { this._gapUntil = now; this._gapLeft = 0; return; }     // already between tracks: start the next right away
    this._retire(0.25);
    this._seq = null;
    this._state = 'gap';
    this._nextIdx = this._chooseNext(this._idx);
    this._gapUntil = now + 1.0; this._gapLeft = 1.0;
  }

  /**
   * Step 80a: a party game's own music. party('vineskip' | 'timber') plays that game's track from bar 1 right now and restarts it when it ends (a short fade in, no gap); party(null) hands the
   * music back to the region (the lobby's Glade Jamboree). setTempo(k) scales the tempo of the track that plays now (1 = as written; the games that speed up call it every frame).
   */
  party(id) {
    const idx = id && PARTY_TRACKS[id] !== undefined ? PARTY_TRACKS[id] : null;
    if (idx === this._forced) return;
    this._forced = idx;
    this._tempo = 1;
    this._nextIdx = this._chooseNext(-1);
    if (!this._booted) return;
    this._retire(idx === null ? 0.4 : 0.1);
    this._seq = null;
    this._pos = 0;
    this._state = 'gap';
    this._gapLeft = idx === null ? 0.5 : 0.05;
    this._gapUntil = this.ctx.currentTime + this._gapLeft;
  }
  setTempo(k) {
    k = clamp(Number(k) || 1, 0.5, 2);
    if (k === this._tempo) return;
    this._tempo = k;
    this._applyTempo(k);
  }
  /** A stable regional/exploration setting. Party games retain their authored speed and dynamic tempo. */
  setBaseTempo(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return this._baseTempo;
    this._baseTempo = clamp(n, 0.5, 1.5);
    if (this._forced === null) this._applyTempo(this._baseTempo);
    return this._baseTempo;
  }
  get baseTempo() { return this._baseTempo; }
  _applyTempo(k) {
    if (!this._seq || !this._booted) return;
    // _pos is a paused wall-time offset, not musical time. Keep the same bar across tempo edits while paused.
    if (!this._running && this._state === 'playing') this._pos *= this._seq.k / k;
    this._seq.setTempo(k, this.ctx.currentTime);
  }
  get partyTrack() { return this._forced; }

  renderTrack(index, seconds) { return renderTrack(index, seconds); }
  trackInfo() { return trackInfo(); }

  // ---------------------------------------------------------------- internals
  _boot() {
    const ctx = this.sfx.ctx;
    this.ctx = ctx;
    this.bus = ctx.createGain();
    this.bus.gain.value = 0;
    this.bus.connect(this.sfx.master);
    this.assets = makeAssets(ctx);
    ctx.addEventListener('statechange', () => this._sync());
    this._booted = true;
    this._sync();
  }

  _active() {
    return this._booted && this._wanted && this._enabled && !document.hidden && !this.sfx.muted && this.ctx.state === 'running';
  }

  _sync() {
    if (!this._booted) return;
    const act = this._active();
    if (act && !this._running) this._resume();
    else if (!act && this._running) this._pause();
    this._applyBus(act ? 0.15 : 0.06);
  }

  _applyBus(tc = 0.12) {
    if (!this._booted) return;
    const now = this.ctx.currentTime, target = this._active() ? this._volume * this._duck : 0;
    this.bus.gain.cancelScheduledValues?.(now);
    const impact = now < this._impactUntil;
    this.bus.gain.setTargetAtTime(target * (impact ? this._impactAmount : 1), now, tc);
    if (impact) this.bus.gain.setTargetAtTime(target, this._impactUntil, 0.05);
  }

  /** Fade an engine out and throw it away a little later. */
  _retire(tc = 0.2) {
    const e = this._eng;
    this._eng = null;
    if (!e) return;
    e.fade.gain.cancelScheduledValues(this.ctx.currentTime);
    e.fade.gain.setTargetAtTime(0, this.ctx.currentTime, tc);
    setTimeout(() => e.dispose(), 4000 * Math.max(0.25, tc) + 500);
  }

  _resume() {
    this.updateRegion();
    this._running = true;
    const now = this.ctx.currentTime;
    if (this._state === 'playing' && this._seq) {
      // continue from the start of the bar we stopped in, on a fresh engine (no stale voices, nothing bunched up)
      const eng = new Engine(this.ctx, this.bus, this.assets, 1, this._seq.tr.def.marsh, this._seq.tr.def.level);
      if (this._seq.tr.def.compressorAttack) eng.comp.attack.value = this._seq.tr.def.compressorAttack;
      this._eng = eng;
      this._seq.eng = eng;
      this._seq.fading = false; this._seq.fadingOut = false;
      this._seq.seek(this._pos, now + 0.15);
    } else if (this._state === 'gap') {
      this._gapUntil = now + this._gapLeft;
    } else {
      this._beginTrack(this.clock ? this._chooseNext(-1) : this._nextIdx);
    }
    this._timer = setInterval(() => this._tick(), TICK_MS);
    this._tick();
  }

  _pause() {
    this._running = false;
    clearInterval(this._timer); this._timer = 0;
    const now = this.ctx.currentTime;
    if (this._state === 'playing' && this._seq) {
      const barSec = stepTime(this._seq.tr, this._seq.tr.def.stepsPerBar || STEPS_PER_BAR) / this._seq.k;
      this._pos = Math.max(0, Math.floor(Math.max(0, now - this._seq.base) / barSec) * barSec);
      this._retire(0.05);
    } else if (this._state === 'gap') {
      this._gapLeft = Math.max(0, this._gapUntil - now);
    }
  }

  _beginTrack(idx) {
    this._lastRegion = this.region();
    const now = this.ctx.currentTime;
    this._retire(0.1);
    const tr = getTrack(idx);
    const eng = new Engine(this.ctx, this.bus, this.assets, 0, tr.def.marsh, tr.def.level);
    eng.fade.gain.setValueAtTime(0, now);
    eng.fade.gain.linearRampToValueAtTime(1, now + 0.15 + (this._forced !== null ? 0.12 : FADE_IN));
    this._eng = eng;
    this._seq = new Sequencer(eng, tr, now + 0.15);
    this._seq.k = this._forced !== null ? this._tempo : this._baseTempo;
    this._idx = idx;
    if (REGION_TRACKS.party.includes(idx) && this._forced === null) this._lobbyLast = idx;      // (Step 80c: the lobby rotation remembers which of its tracks played last)
    this._nextIdx = this._chooseNext(idx);
    this._state = 'playing';
    this._emit('track', { index: idx, title: tr.def.title });
  }

  _tick() {
    if (!this._running) return;
    this.updateRegion();
    const now = this.ctx.currentTime;
    this.stats.ticks++;
    if (this._state === 'playing' && this._seq) {
      const seq = this._seq, before = seq.count, rs = seq.resyncs;
      seq.schedule(now, now + LOOKAHEAD);
      this.stats.notes[this._idx] += seq.count - before;
      this.stats.total += seq.count - before;
      this.stats.resyncs += seq.resyncs - rs;
      if (!seq.fadingOut && this._forced === null && now >= seq.endT - FADE_OUT) {
        seq.fadingOut = true;
        this._eng.fade.gain.cancelScheduledValues(now);
        this._eng.fade.gain.setValueAtTime(this._eng.fade.gain.value, now);
        this._eng.fade.gain.setTargetAtTime(0, now, FADE_OUT / 4);
      }
      if (now >= seq.endT) {
        const loop = this._forced !== null, quick = loop || this.region() === 'party';       // a party game's track restarts at once; the lobby's loops after a breath
        this._retire(loop ? 0.05 : 0.2);
        this._seq = null;
        this._state = 'gap';
        const gap = loop ? 0.02 : quick ? 0.6 : GAP;
        this._gapUntil = now + gap; this._gapLeft = gap;
      }
    } else if (this._state === 'gap') {
      if (now >= this._gapUntil) this._beginTrack(this.clock ? this._chooseNext(this._idx) : this._nextIdx);
    }
  }
}
