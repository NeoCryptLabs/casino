/**
 * Moteur audio 100% procédural (WebAudio) — aucun fichier externe.
 * Ambiance foule, machines à sous lointaines, eau de la fontaine,
 * jetons, cartes, verres, jingles de gains, pas, musique lounge.
 */
const rnd = (a, b) => a + Math.random() * (b - a);

export class Audio {
  constructor() {
    this.ready = false;
    this.ctx = null;
  }

  init() {
    if (this.ready) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.85;

    // Réverbération de salle (impulse response synthétique)
    this.conv = ctx.createConvolver();
    this.conv.buffer = this._impulse(2.6, 2.2);
    const wet = ctx.createGain(); wet.gain.value = 0.28;
    this.conv.connect(wet); wet.connect(this.master);
    this.revSend = ctx.createGain(); this.revSend.gain.value = 1;
    this.revSend.connect(this.conv);

    // Compresseur de sortie
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4; comp.knee.value = 12;
    this.master.connect(comp); comp.connect(ctx.destination);

    this.noiseBuf = this._noise(4);
    this.ready = true;

    this._crowd();
    this._roomTone();
    this._music();
    this.waterGain = this._water();
  }

  resume() { if (this.ctx && this.ctx.state === "suspended") this.ctx.resume(); }

  // ---------- helpers ----------
  _noise(sec) {
    const ctx = this.ctx, n = ctx.sampleRate * sec;
    const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  _impulse(sec, decay) {
    const ctx = this.ctx, n = ctx.sampleRate * sec;
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
    }
    return b;
  }
  _src(loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = loop; return s;
  }
  /** enveloppe simple sur un gain */
  _env(g, peak, atk, dec, t0) {
    const t = t0 ?? this.ctx.currentTime;
    g.gain.cancelScheduledValues(t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t + atk + dec);
  }
  _tone(freq, dur, type = "sine", vol = 0.2, t0 = 0, detune = 0) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + t0;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); o.detune.value = detune;
    o.connect(g); g.connect(this.master); g.connect(this.revSend);
    this._env(g, vol, 0.006, dur, t);
    o.start(t); o.stop(t + dur + 0.06);
    return o;
  }
  _burst({ freq = 2000, q = 1, dur = 0.08, vol = 0.25, type = "bandpass", t0 = 0, slide = 0 }) {
    if (!this.ready) return;
    const ctx = this.ctx, t = ctx.currentTime + t0;
    const s = this._src(false);
    s.playbackRate.value = rnd(0.85, 1.2);
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (slide) f.frequency.exponentialRampToValueAtTime(Math.max(80, freq * slide), t + dur);
    const g = ctx.createGain();
    s.connect(f); f.connect(g); g.connect(this.master); g.connect(this.revSend);
    this._env(g, vol, 0.003, dur, t);
    s.start(t); s.stop(t + dur + 0.12);
  }

  // ---------- lits d'ambiance ----------
  _roomTone() {
    const ctx = this.ctx, s = this._src(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = "lowpass"; f.frequency.value = 240; g.gain.value = 0.05;
    s.connect(f); f.connect(g); g.connect(this.master); s.start();
  }

  /** murmure de foule : bruit filtré modulé + syllabes aléatoires */
  _crowd() {
    const ctx = this.ctx;
    const s = this._src(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = "bandpass"; f.frequency.value = 700; f.Q.value = 0.7;
    g.gain.value = 0.055;
    s.connect(f); f.connect(g); g.connect(this.master); g.connect(this.revSend); s.start();
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.13; lg.gain.value = 0.02; lfo.connect(lg); lg.connect(g.gain); lfo.start();

    const syl = () => {
      if (!this.ready) return;
      this._burst({ freq: rnd(380, 1500), q: rnd(3, 9), dur: rnd(0.05, 0.16), vol: rnd(0.012, 0.045), slide: rnd(0.6, 1.5) });
      if (Math.random() < 0.05) this._laugh();
      if (Math.random() < 0.07) this._distantSlot();
      setTimeout(syl, rnd(90, 420));
    };
    syl();
  }

  _laugh() {
    for (let i = 0; i < 4; i++)
      this._burst({ freq: rnd(500, 900), q: 6, dur: 0.07, vol: 0.03, t0: i * 0.11, slide: 0.7 });
  }

  /** jingle de machine lointaine */
  _distantSlot() {
    const base = [523, 659, 784, 1046];
    for (let i = 0; i < 4; i++) this._tone(base[i % 4] * rnd(0.98, 1.02), 0.1, "triangle", 0.012, i * 0.09);
  }

  /** eau : bruit rose filtré + gouttes. Renvoie le gain à moduler selon la distance. */
  _water() {
    const ctx = this.ctx;
    const s = this._src(), f = ctx.createBiquadFilter(), hp = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = "lowpass"; f.frequency.value = 5200;
    hp.type = "highpass"; hp.frequency.value = 500;
    g.gain.value = 0;
    s.connect(hp); hp.connect(f); f.connect(g); g.connect(this.master); g.connect(this.revSend); s.start();
    const lfo = ctx.createOscillator(), lg = ctx.createGain();
    lfo.frequency.value = 0.31; lg.gain.value = 900; lfo.connect(lg); lg.connect(f.frequency); lfo.start();
    this._waterBase = 0;
    const drop = () => {
      if (this.ready && this._waterBase > 0.02)
        this._tone(rnd(900, 2400), 0.05, "sine", 0.02 * this._waterBase, 0);
      setTimeout(drop, rnd(140, 700));
    };
    drop();
    return g;
  }

  /** appelée chaque frame avec la distance du joueur à la fontaine */
  setWaterDistance(d) {
    if (!this.ready) return;
    const v = Math.max(0, 1 - d / 16);
    this._waterBase = v;
    this.waterGain.gain.value = 0.32 * v * v;
  }

  /** musique lounge discrète : basse + accords Rhodes-like */
  _music() {
    const prog = [
      [110.0, [261.6, 329.6, 392.0, 493.9]], // Am9-ish
      [98.0, [246.9, 293.7, 369.9, 440.0]],
      [87.3, [261.6, 329.6, 415.3, 493.9]],
      [82.4, [246.9, 311.1, 392.0, 466.2]],
    ];
    let i = 0;
    const step = () => {
      if (!this.ready) return;
      const [bass, chord] = prog[i % prog.length];
      this._tone(bass / 2, 1.7, "sine", 0.055);
      this._tone(bass, 1.5, "triangle", 0.022);
      chord.forEach((f, k) =>
        this._tone(f, 1.6, "sine", 0.014, 0.05 * k + rnd(0, 0.03), rnd(-6, 6))
      );
      // petite mélodie éparse
      if (Math.random() < 0.55)
        this._tone(chord[Math.floor(rnd(0, 4))] * 2, 0.5, "sine", 0.018, rnd(0.4, 1.4));
      i++;
      setTimeout(step, 2600);
    };
    setTimeout(step, 800);
  }

  // ---------- sons d'action ----------
  /** impact de jeton — vol dépend de l'énergie de la collision */
  chip(power = 1) {
    const v = Math.min(1, power);
    this._burst({ freq: rnd(2600, 4200), q: 14, dur: 0.045, vol: 0.09 * v });
    this._tone(rnd(1800, 2600), 0.05, "triangle", 0.05 * v);
    this._tone(rnd(420, 620), 0.03, "sine", 0.03 * v);
  }
  /** pile de jetons manipulée */
  chipRiffle() {
    for (let i = 0; i < 9; i++) setTimeout(() => this.chip(rnd(0.25, 0.6)), i * rnd(18, 45));
  }
  card() {
    this._burst({ freq: rnd(3200, 5200), q: 1.4, dur: 0.075, vol: 0.11, slide: 0.35 });
  }
  cardFlip() {
    this._burst({ freq: 5200, q: 1, dur: 0.05, vol: 0.09, slide: 0.25 });
    this._burst({ freq: 1400, q: 2, dur: 0.06, vol: 0.05, t0: 0.05, slide: 0.4 });
  }
  shuffle() {
    for (let i = 0; i < 26; i++) setTimeout(() => this.card(), i * rnd(10, 26));
  }
  step(run) {
    this._burst({ freq: run ? 320 : 240, q: 1.1, dur: run ? 0.1 : 0.14, vol: run ? 0.07 : 0.045, slide: 0.45 });
  }
  glass() {
    this._tone(rnd(1700, 2200), 0.5, "sine", 0.07);
    this._tone(rnd(3200, 3900), 0.35, "sine", 0.03);
  }
  pour() {
    const ctx = this.ctx, t = ctx.currentTime;
    const s = this._src(false), f = ctx.createBiquadFilter(), g = ctx.createGain();
    f.type = "bandpass"; f.Q.value = 3;
    f.frequency.setValueAtTime(900, t);
    f.frequency.linearRampToValueAtTime(2200, t + 2.2);
    s.connect(f); f.connect(g); g.connect(this.master); g.connect(this.revSend);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.25);
    g.gain.setValueAtTime(0.07, t + 1.8);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    s.start(t); s.stop(t + 2.6);
    for (let i = 0; i < 14; i++) setTimeout(() => this._tone(rnd(700, 2000), 0.04, "sine", 0.012), i * 150);
  }
  sip() {
    this._burst({ freq: 500, q: 2, dur: 0.5, vol: 0.05, slide: 0.5 });
    setTimeout(() => this._tone(180, 0.25, "sine", 0.05), 520); // gulp
  }
  lever() {
    this._burst({ freq: 900, q: 3, dur: 0.18, vol: 0.09, slide: 0.35 });
    this._tone(140, 0.2, "square", 0.03, 0.14);
  }
  reelLoop(on) {
    if (!this.ready) return;
    if (on) {
      if (this._reel) return;
      const ctx = this.ctx;
      const s = this._src(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      f.type = "bandpass"; f.frequency.value = 1600; f.Q.value = 6;
      g.gain.value = 0.05;
      s.connect(f); f.connect(g); g.connect(this.master); s.start();
      const lfo = ctx.createOscillator(), lg = ctx.createGain();
      lfo.type = "square"; lfo.frequency.value = 26; lg.gain.value = 0.04;
      lfo.connect(lg); lg.connect(g.gain); lfo.start();
      this._reel = { s, g, lfo };
    } else if (this._reel) {
      this._reel.g.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.12);
      const r = this._reel; this._reel = null;
      setTimeout(() => { try { r.s.stop(); r.lfo.stop(); } catch (e) { } }, 250);
    }
  }
  reelStop() {
    this._burst({ freq: 420, q: 4, dur: 0.13, vol: 0.16, slide: 0.35 });
    this._tone(110, 0.12, "square", 0.05);
  }
  win(big = false) {
    const notes = big
      ? [523, 659, 784, 1046, 1318, 1568, 2093]
      : [659, 784, 1046, 1318];
    notes.forEach((n, i) => {
      this._tone(n, 0.32, "triangle", big ? 0.13 : 0.09, i * 0.085);
      this._tone(n * 2, 0.2, "sine", 0.04, i * 0.085);
    });
    if (big) {
      for (let i = 0; i < 40; i++) setTimeout(() => this.chip(rnd(0.4, 1)), 700 + i * rnd(25, 70));
      for (let i = 0; i < 8; i++)
        setTimeout(() => { this._tone(1046, 0.1, "square", 0.05); this._tone(1568, 0.1, "square", 0.04); }, 500 + i * 180);
    }
  }
  lose() {
    this._tone(220, 0.3, "sine", 0.07);
    this._tone(165, 0.5, "sine", 0.06, 0.14);
  }
  ui() { this._tone(1200, 0.05, "sine", 0.05); }
}
