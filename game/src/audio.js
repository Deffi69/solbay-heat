// audio.js — every sound in SOLBAY HEAT is synthesised with WebAudio: no audio files. A lazy
// AudioContext (started on the first user gesture), a master gain with a mute toggle, an engine
// hum whose pitch follows the player's speed, a two-tone police siren, gunshots, punches,
// cash-register chimes for mission pay, and a slow synthwave pad loop for the city ambience.

export class SoundBank {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.muted = false;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.musicTimer = 0;
    this.chordStep = 0;
  }

  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.#startEngine();
    this.#startSiren();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  #startEngine() {
    const ctx = this.ctx;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 420;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(filter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
  }

  // speedRatio 0..1, active only while the player drives.
  setEngine(speedRatio, driving) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const target = driving ? 0.05 + speedRatio * 0.05 : 0;
    this.engineGain.gain.setTargetAtTime(target, t, 0.08);
    this.engineOsc.frequency.setTargetAtTime(52 + speedRatio * 165, t, 0.06);
  }

  #startSiren() {
    const ctx = this.ctx;
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0;
    this.sirenOsc.connect(this.sirenGain).connect(this.master);
    this.sirenOsc.start();
  }

  // closeness 0..1 of the nearest police car; 0 silences the siren.
  setSiren(closeness, timeSec) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.sirenGain.gain.setTargetAtTime(closeness * 0.045, t, 0.1);
    if (closeness > 0) {
      const phase = Math.sin(timeSec * 4.4) > 0 ? 880 : 660;
      this.sirenOsc.frequency.setTargetAtTime(phase, t, 0.03);
    }
  }

  #blip(freqA, freqB, dur, type, vol, when = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime + when;
    const osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqA, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(30, freqB), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  #noise(dur, vol, filterFreq) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buffer;
    const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = filterFreq;
    const gain = ctx.createGain(); gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
  }

  gunshot() { this.#noise(0.16, 0.5, 2600); this.#blip(220, 60, 0.1, 'square', 0.22); }
  dryFire() { this.#blip(1200, 900, 0.04, 'square', 0.08); }
  reload() { this.#blip(500, 300, 0.07, 'square', 0.12); this.#blip(700, 500, 0.07, 'square', 0.12, 0.12); }
  punch() { this.#noise(0.08, 0.3, 700); }
  hitMarker() { this.#blip(1500, 1400, 0.05, 'sine', 0.15); }
  carCrash(strength) { this.#noise(0.25, Math.min(0.6, 0.2 + strength), 900); this.#blip(120, 45, 0.22, 'sawtooth', 0.2); }
  carHorn() { this.#blip(370, 370, 0.28, 'square', 0.07); }
  doorSlam() { this.#noise(0.07, 0.25, 500); }
  cash() { this.#blip(990, 990, 0.09, 'sine', 0.16); this.#blip(1320, 1320, 0.14, 'sine', 0.16, 0.09); }
  missionComplete() { [523, 659, 784, 1046].forEach((f, i) => this.#blip(f, f, 0.22, 'triangle', 0.16, i * 0.11)); }
  missionFail() { [392, 330, 262].forEach((f, i) => this.#blip(f, f * 0.94, 0.25, 'triangle', 0.15, i * 0.14)); }
  pickup() { this.#blip(760, 1180, 0.1, 'sine', 0.14); }

  // A slow Am–F–C–G pad, one chord every four seconds, very quiet under the city.
  updateMusic(dt, playing) {
    if (!this.ctx || !playing) return;
    this.musicTimer -= dt;
    if (this.musicTimer > 0) return;
    this.musicTimer = 4;
    const chords = [[110, 164.8, 261.6], [87.3, 130.8, 220], [98, 146.8, 246.9], [82.4, 123.5, 196]];
    const chord = chords[this.chordStep++ % chords.length];
    for (const f of chord) this.#blip(f, f, 3.6, 'triangle', 0.028);
    this.#blip(chord[0] / 2, chord[0] / 2, 3.6, 'sine', 0.035);
  }
}
