// Звук: полный синтез через Web Audio, никаких файлов.
let ctx = null;
let master = null;
let reverb = null;   // общий хвост помещения для выстрелов
let enabled = true;
const activeSources = new Set();

export const Sound = {
  init() {
    if (ctx) return;
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    buildReverb();
  },
  resume() { if (ctx && ctx.state === 'suspended') ctx.resume(); },
  /** Глушим на время рекламы и при сворачивании вкладки. */
  suspend() { if (ctx && ctx.state === 'running') ctx.suspend(); },
  /** Отменяет хвосты текущего матча, сохраняя AudioContext и master bus. */
  stopAll() {
    for (const source of activeSources) {
      try { source.stop(); } catch { /* source уже завершился */ }
      try { source.disconnect(); } catch { /* уже отключён */ }
    }
    activeSources.clear();
  },
  setEnabled(v) { enabled = v; if (master) master.gain.value = v ? 0.5 : 0; },

  // Выстрел собирается из трёх слоёв, как настоящий: сухой щелчок пороха
  // (crack), низкий удар ствола (thump) и хвост-отражение от стен арены
  // (send в reverb). Одиночный осциллятор звучал «пикалкой» — слои дают вес.
  pistol() { crack(0.035, 0.55, 1400); thump(430, 0.09, 0.45); mech(0.05, 0.1); },
  // Очень короткий щелчок: при 11 выстр./с длинные хвосты сливаются в гул.
  smg() { crack(0.018, 0.32, 2200); thump(520, 0.045, 0.24); },
  assault() { crack(0.03, 0.5, 1100); thump(300, 0.1, 0.42); mech(0.055, 0.08); },
  shotgun() { crack(0.06, 0.85, 600); thump(120, 0.24, 0.7); noiseBurst(0.22, 900, 0.5); },
  // Дальний резкий crack и тяжёлый низ: снайперку слышно через всю карту.
  sniper() { crack(0.07, 0.9, 1900); thump(90, 0.32, 0.6); thump(240, 0.14, 0.3); },
  railCharge(dur = 0.8) {
    if (!ok()) return;
    const o = track(ctx.createOscillator()), g = ctx.createGain();
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
    crack(0.05, 0.7, 2600);
    shotBase(1800, 0.25, 'sawtooth', 0.45);
    thump(80, 0.34, 0.55);
  },
  // Сброс обоймы — глухой стук с призвуком металла; посадка новой — щелчок
  // затвора. Два раздельных звука обозначают начало и конец перезарядки.
  // Сброс обоймы: глухой удар корпуса + металлический призвук защёлки.
  reloadOut() {
    thump(150, 0.1, 0.4);
    crack(0.03, 0.3, 900);
    mech(0.04, 0.22);
  },
  // Посадка магазина и досыл затвора — два раздельных лязга, слышно чётко.
  reloadIn() {
    thump(210, 0.08, 0.45);
    mech(0.02, 0.3);
    mech(0.11, 0.34);
    crack(0.025, 0.28, 1800);
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

/**
 * Короткий процедурный «зал»: экспоненциально затухающий шум как impulse
 * response. Без него выстрелы звучат так, будто игрок стреляет в вате.
 * Тестовый AudioContext конвольвера не имеет — тогда работаем сухими.
 */
function buildReverb() {
  reverb = null;
  if (typeof ctx.createConvolver !== 'function') return;
  const seconds = 0.32;
  const length = Math.floor(ctx.sampleRate * seconds);
  const impulse = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = impulse.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 2.6;
  }
  const node = ctx.createConvolver();
  node.buffer = impulse;
  const send = ctx.createGain();
  send.gain.value = 0.26;   // хвост слышен, но не размазывает атаку
  node.connect(send).connect(master);
  reverb = node;
}

/** Подключает слой и к прямому сигналу, и к хвосту помещения. */
function toBus(node, wet = 1) {
  node.connect(master);
  if (!reverb || wet <= 0) return node;
  const send = ctx.createGain();
  send.gain.value = wet;
  node.connect(send).connect(reverb);
  return node;
}

/** Сухой щелчок пороха: высокочастотный шум с очень быстрым спадом. */
function crack(dur, vol, highpass) {
  if (!ok()) return;
  const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) {
    const k = i / n;
    d[i] = (Math.random() * 2 - 1) * (1 - k) ** 3; // мгновенная атака, крутой спад
  }
  const src = track(ctx.createBufferSource());
  src.buffer = buf;
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass'; hp.frequency.value = highpass;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(hp).connect(g);
  toBus(g, 0.5);
  src.start();
}

/** Низкий удар ствола: питч резко падает — это и даёт «вес» выстрела. */
function thump(freq, dur, vol) {
  if (!ok()) return;
  const t0 = ctx.currentTime;
  const o = track(ctx.createOscillator());
  const g = ctx.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(freq, t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(30, freq * 0.18), t0 + dur);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g);
  toBus(g, 0.35);
  o.start(t0); o.stop(t0 + dur + 0.02);
}

/** Механика: гильза и затвор через несколько миллисекунд после выстрела. */
function mech(delay, vol) {
  if (!ok()) return;
  const t0 = ctx.currentTime + delay;
  const o = track(ctx.createOscillator());
  const g = ctx.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(2600, t0);
  o.frequency.exponentialRampToValueAtTime(1500, t0 + 0.03);
  g.gain.setValueAtTime(vol, t0);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.045);
  o.connect(g);
  toBus(g, 0.4);
  o.start(t0); o.stop(t0 + 0.06);
}

function shotBase(freq, dur, type, vol) {
  if (!ok()) return;
  const o = track(ctx.createOscillator()), g = ctx.createGain();
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
  const o = track(ctx.createOscillator()), g = ctx.createGain();
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
  const src = track(ctx.createBufferSource());
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = cutoff;
  const g = ctx.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(master);
  src.start();
}

function track(source) {
  activeSources.add(source);
  source.addEventListener?.('ended', () => {
    activeSources.delete(source);
    try { source.disconnect(); } catch { /* уже отключён */ }
  }, { once: true });
  return source;
}
