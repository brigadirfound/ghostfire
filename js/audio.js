// Звук: полный синтез через Web Audio, никаких файлов.
let ctx = null;
let master = null;
let enabled = true;

export const Sound = {
  init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  },
  resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
  /** Глушим на время рекламы и при сворачивании вкладки. */
  suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
  setEnabled(v) { enabled = v; if (master) master.gain.value = v ? 0.5 : 0; },

  pistol() { shotBase(900, 0.09, 'square', 0.5); noiseBurst(0.05, 2200, 0.25); },
  shotgun() { noiseBurst(0.22, 900, 0.9); shotBase(150, 0.18, 'sawtooth', 0.6); },
  railCharge(dur = 0.8) {
    if (!ok()) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(220, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + dur);
    g.gain.setValueAtTime(0.001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + dur);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur + 0.05);
    o.connect(g).connect(master);
    o.start(); o.stop(ctx.currentTime + dur + 0.1);
  },
  railgun() {
    noiseBurst(0.3, 4000, 0.7);
    shotBase(1800, 0.25, 'sawtooth', 0.5);
    shotBase(90, 0.3, 'square', 0.5);
  },
  hit() { blip(1200, 0.05, 0.3); },
  headshot() { blip(1600, 0.06, 0.35); blip(2100, 0.08, 0.3, 0.05); },
  hurt() { shotBase(120, 0.2, 'sawtooth', 0.45); },
  pickup() { blip(660, 0.07, 0.3); blip(880, 0.07, 0.3, 0.07); blip(1320, 0.1, 0.3, 0.14); },
  jump() { blip(300, 0.06, 0.12); },
  death() { noiseBurst(0.6, 500, 0.8); shotBase(60, 0.5, 'sawtooth', 0.6); },
  countdown() { blip(440, 0.12, 0.35); },
  go() { blip(880, 0.25, 0.4); },
  winRound() { [523, 659, 784].forEach((f, i) => blip(f, 0.14, 0.3, i * 0.1)); },
  loseRound() { [400, 330, 262].forEach((f, i) => blip(f, 0.18, 0.3, i * 0.12)); },
};

function ok() { return ctx && enabled; }

function shotBase(freq, dur, type, vol) {
  if (!ok()) return;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(Math.max(40, freq * 0.25), ctx.currentTime + dur);
  g.gain.setValueAtTime(vol, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
  o.connect(g).connect(master);
  o.start(); o.stop(ctx.currentTime + dur + 0.02);
}

function blip(freq, dur, vol, delay = 0) {
  if (!ok()) return;
  const t0 = ctx.currentTime + delay;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = 'square';
  o.frequency.value = freq;
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g).connect(master);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

function noiseBurst(dur, cutoff, vol) {
  if (!ok()) return;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = cutoff;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start();
}
