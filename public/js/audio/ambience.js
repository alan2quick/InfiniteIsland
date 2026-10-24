// Sparse synthesized birds by day and crickets at night. Shares the Sfx master,
// so M mutes it, while the music toggle leaves it alone.
export class AmbienceAudio {
  constructor(sfx, clock) {
    this.sfx = sfx;
    this._volume = 1; this._bus = null; this._busContext = null;
    this.clock = clock;
    this.elapsed = 0;
    this.nextBird = 2;
    this.nextCricket = 1;
    this.birds = 0;
    this.crickets = 0;
    this.region = () => 'home';
    this.regional = { wind: 0, owl: 0, tropical: 0, frog: 0 };
    // Step 37c: Emberleaf's waterfall, a soft rushing loop (looped noise -> low-pass -> gain -> master) that follows `waterfall()` = 0..1 (how near the nearest local player is to the plunge pool)
    this.waterfall = () => 0;
    this.fall = { source: null, filter: null, gain: null, level: 0, peak: 0.055 };
    this.nextRegional = 3;
  }

  get volume() { return this._volume; }
  setVolume(value) {
    const n = Number(value);
    if (Number.isFinite(n)) this._volume = Math.max(0, Math.min(1, n));
    if (this._bus && this._busContext) this._bus.gain.setTargetAtTime(this._volume, this._busContext.currentTime, 0.08);
    return this._volume;
  }
  // One bus covers existing voices and future birds, crickets, regional wind/animals and waterfall noise.
  _output(ctx, master) {
    if (this._busContext !== ctx || !this._bus) {
      this._bus?.disconnect();
      this._bus = ctx.createGain(); this._busContext = ctx;
      this._bus.gain.value = this._volume; this._bus.connect(master);
    }
    return this._bus;
  }

  chirp(type, level) {
    const { ctx, master } = this.sfx;
    if (!ctx || ctx.state !== 'running' || this.sfx.muted || document.hidden) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    const bird = type === 'bird';
    const f = bird ? 1450 + Math.random() * 550 : 3600 + Math.random() * 600;
    const length = bird ? 0.24 : 0.11;
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(bird ? f * 1.42 : f * 0.88, t + length * 0.5);
    o.frequency.exponentialRampToValueAtTime(bird ? f * 0.8 : f * 0.65, t + length);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime((bird ? 0.012 : 0.004) * level, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    o.connect(g).connect(this._output(ctx, master));
    o.start(t); o.stop(t + length + 0.02);
    o.onended = () => { o.disconnect(); g.disconnect(); };
    if (bird) this.birds++; else this.crickets++;
  }

  /** The waterfall loop: created when someone gets near, eased with the distance, torn down again when it is out of earshot (or muted / hidden). */
  updateWaterfall(dt) {
    const { ctx: c, master } = this.sfx, f = this.fall;
    const near = c && c.state === 'running' && !this.sfx.muted && !document.hidden ? this.waterfall() : 0;
    f.level += (near - f.level) * (1 - Math.exp(-dt / 0.5));
    if (!f.source) {
      if (near < 0.02 || !c) return;
      const buffer = c.createBuffer(1, c.sampleRate * 3, c.sampleRate), data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < data.length; i++) { last = 0.82 * last + 0.18 * (Math.random() * 2 - 1); data[i] = last * 2.4; }   // brown-ish noise
      for (let i = 0; i < 2000; i++) data[data.length - 1 - i] = data[data.length - 1 - i] * (i / 2000) + data[2000 - 1 - i] * (1 - i / 2000);   // crossfade the seam so the loop is click-free
      f.source = c.createBufferSource(); f.source.buffer = buffer; f.source.loop = true;
      f.filter = c.createBiquadFilter(); f.filter.type = 'lowpass'; f.filter.frequency.value = 1500; f.filter.Q.value = 0.4;
      f.gain = c.createGain(); f.gain.gain.value = 0;
      f.source.connect(f.filter).connect(f.gain).connect(this._output(c, master)); f.source.start();
    }
    f.gain.gain.setTargetAtTime(f.peak * f.level, c.currentTime, 0.12);
    f.filter.frequency.setTargetAtTime(700 + 1100 * f.level, c.currentTime, 0.2);       // brighter (more hiss) up close
    if (near < 0.02 && f.level < 0.01) {
      f.source.stop(); f.source.disconnect(); f.filter.disconnect(); f.gain.disconnect();
      f.source = f.filter = f.gain = null; f.level = 0;
    }
  }

  update(dt) {
    this.elapsed += dt;
    this.updateWaterfall(dt);
    const night = this.clock.nightness;
    const region = this.region();
    if (region !== 'home' && region !== 'story') {          // (Storybook Cay is a calm meadow: it keeps home's birds and crickets)
      if (this.elapsed >= this.nextRegional) {
        const type = region === 'frost' ? (night > 0.55 && Math.random() < 0.5 ? 'owl' : 'wind') : (night > 0.55 ? 'frog' : 'tropical');
        this.regionalSound(type);
        this.nextRegional = this.elapsed + (type === 'frog' ? 2 : 5) + Math.random() * 5;
      }
      return;
    }
    if (this.elapsed >= this.nextBird) {
      if (night < 0.75) this.chirp('bird', 1 - night);
      this.nextBird = this.elapsed + 3 + Math.random() * 5;
    }
    if (this.elapsed >= this.nextCricket) {
      if (night > 0.2) this.chirp('cricket', night);
      this.nextCricket = this.elapsed + 0.5 + Math.random() * 1.2;
    }
  }

  regionalSound(type) {
    const { ctx: c, master } = this.sfx;
    if (!c || c.state !== 'running' || this.sfx.muted || document.hidden) return;
    const t = c.currentTime, gain = c.createGain();
    if (type === 'wind') {
      const buffer = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
      const source = c.createBufferSource(), filter = c.createBiquadFilter(); source.buffer = buffer;
      filter.type = 'lowpass'; filter.frequency.value = 650;
      gain.gain.setValueAtTime(0.0001, t); gain.gain.linearRampToValueAtTime(0.018, t + 0.7); gain.gain.linearRampToValueAtTime(0.0001, t + 2);
      source.connect(filter).connect(gain).connect(this._output(c, master)); source.start(t); source.stop(t + 2);
      source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
    } else {
      const o = c.createOscillator(), f = type === 'owl' ? 380 : type === 'frog' ? 210 : 1200;
      const len = type === 'owl' ? 0.8 : type === 'frog' ? 0.3 : 0.45;
      o.type = type === 'frog' ? 'triangle' : 'sine';
      o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * (type === 'tropical' ? 1.9 : 0.7), t + len * 0.45); o.frequency.exponentialRampToValueAtTime(f * 0.85, t + len);
      gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(type === 'tropical' ? 0.012 : 0.008, t + 0.04); gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
      o.connect(gain).connect(this._output(c, master)); o.start(t); o.stop(t + len + 0.02);
      o.onended = () => { o.disconnect(); gain.disconnect(); };
    }
    this.regional[type]++;
  }
}
