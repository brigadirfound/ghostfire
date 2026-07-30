// Честные 360° equirect-панорамы (2:1) для sky-dome, рисуются кодом.
//
//   node tools/gen_skydome.mjs              # все арены + fallback
//   node tools/gen_skydome.mjs --only=arena03
//   node tools/gen_skydome.mjs --width=4096 # по умолчанию 2048×1024
//
// Почему не генератор картинок: nano-banana и подобные рисуют обычный кадр, а
// не развёртку сферы — у него не сходятся края и полюса, и на куполе это видно
// швом и «воронкой». Здесь панорама строится в координатах долгота/широта,
// поэтому шов отсутствует по построению, а верх и низ сходятся в чистый цвет.
//
// Node пишет сырой PPM, jpeg делает ffmpeg — никаких зависимостей.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets/sky');

const hex = (value) => [
  parseInt(value.slice(1, 3), 16),
  parseInt(value.slice(3, 5), 16),
  parseInt(value.slice(5, 7), 16),
];
const mix = (a, b, k) => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (t) => t * t * (3 - 2 * t);

/** Каждая арена — своё время суток; купол должен читаться с первого взгляда. */
const PRESETS = {
  skybox: {   // fallback и пользовательские карты
    zenith: '#141a3a', horizon: '#ff9a5c', ground: '#241a26',
    sun: { lon: 0.5, lat: 0.055, color: '#fff2c8', size: 0.055 },
    cloud: { color: '#ffd0a0', amount: 0.5, height: 0.55 },
    city: { color: '#241b3a', height: 0.55, density: 0.7, windows: '#ffcc66' },
    stars: 0.45,
  },
  arena01: {  // тесная арена — закат в упор
    zenith: '#1b1140', horizon: '#ff7a3d', ground: '#2a1620',
    sun: { lon: 0.72, lat: 0.03, color: '#ffe0a0', size: 0.07 },
    cloud: { color: '#ff9c6a', amount: 0.65, height: 0.5 },
    city: { color: '#2a1b3c', height: 0.6, density: 0.85, windows: '#ffb347' },
    stars: 0.3,
  },
  arena02: {  // два уровня — ясный день
    zenith: '#1d5fb0', horizon: '#bfe4ff', ground: '#2c3a2a',
    sun: { lon: 0.25, lat: 0.35, color: '#ffffff', size: 0.045 },
    cloud: { color: '#ffffff', amount: 0.8, height: 0.75 },
    city: { color: '#33465e', height: 0.4, density: 0.6, windows: '#dff1ff' },
    stars: 0,
  },
  arena03: {  // снайперская — холодная ночь
    zenith: '#05070f', horizon: '#26406b', ground: '#0a0d16',
    sun: { lon: 0.15, lat: 0.28, color: '#dfe8ff', size: 0.02 },
    cloud: { color: '#33507e', amount: 0.35, height: 0.6 },
    city: { color: '#0c111c', height: 0.5, density: 0.75, windows: '#7fd4ff' },
    stars: 1,
  },
  arena04: {  // пятак — багровое зарево
    zenith: '#2b0a18', horizon: '#ff5030', ground: '#2a0f10',
    sun: { lon: 0.6, lat: 0.015, color: '#ffd08a', size: 0.09 },
    cloud: { color: '#d43a2a', amount: 0.7, height: 0.45 },
    city: { color: '#2c1220', height: 0.45, density: 0.55, windows: '#ff8855' },
    stars: 0.2,
  },
  arena05: {  // мосты — рассвет над дымкой
    zenith: '#123055', horizon: '#ffc98f', ground: '#1d2a30',
    sun: { lon: 0.88, lat: 0.08, color: '#fff6d8', size: 0.06 },
    cloud: { color: '#e8b48a', amount: 0.6, height: 0.65 },
    city: { color: '#1c2a3e', height: 0.35, density: 0.5, windows: '#ffd9a0' },
    stars: 0.15,
  },
};

function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/** Кольцевой value-noise: по долготе он обязан замыкаться без шва. */
function ringNoise(size, rand) {
  const values = Array.from({ length: size }, rand);
  return (u) => {
    const x = u * size;
    const i = Math.floor(x) % size;
    const k = smooth(x - Math.floor(x));
    return values[i] * (1 - k) + values[(i + 1) % size] * k;
  };
}

/** Профиль высот города: тоже кольцевой, иначе на стыке 0°/360° будет обрыв. */
function skyline(preset, rand) {
  const towers = 96;
  const tops = new Array(towers);
  for (let i = 0; i < towers; i++) {
    const tall = rand() < preset.city.density;
    tops[i] = tall ? 0.25 + rand() * 0.75 : 0.06 + rand() * 0.22;
  }
  return { towers, tops };
}

function render(name, preset, width) {
  const height = Math.round(width / 2);
  const data = Buffer.alloc(width * height * 3);
  const rand = makeRandom([...name].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 0x01000193) >>> 0, 0x811c9dc5));

  const zenith = hex(preset.zenith);
  const horizon = hex(preset.horizon);
  const ground = hex(preset.ground);
  const sunColor = hex(preset.sun.color);
  const cloudColor = hex(preset.cloud.color);
  const cityColor = hex(preset.city.color);
  const windowColor = hex(preset.city.windows);

  const cloudLow = ringNoise(64, rand);
  const cloudHigh = ringNoise(211, rand);
  const { towers, tops } = skyline(preset, rand);
  const starRand = makeRandom(0x51ee7);

  // Горизонт ровно посередине развёртки: широта 0 — строка height/2.
  const horizonRow = height / 2;

  for (let y = 0; y < height; y++) {
    // lat: +1 зенит, 0 горизонт, -1 надир
    const lat = 1 - (y / (height - 1)) * 2;
    const above = lat >= 0;
    const t = clamp01(Math.abs(lat));
    const base = above
      ? mix(horizon, zenith, smooth(Math.pow(t, 0.7)))
      : mix(horizon, ground, smooth(Math.pow(t, 0.45)));

    for (let x = 0; x < width; x++) {
      const u = x / width;
      let r = base[0], g = base[1], b = base[2];

      if (above) {
        // Солнце: диск плюс мягкое гало, расстояние считается по сфере.
        const dLon = Math.min(Math.abs(u - preset.sun.lon), 1 - Math.abs(u - preset.sun.lon)) * 2;
        const dLat = lat - preset.sun.lat;
        const dist = Math.hypot(dLon * Math.cos(preset.sun.lat * Math.PI / 2), dLat);
        if (dist < preset.sun.size * 4) {
          const glow = Math.pow(clamp01(1 - dist / (preset.sun.size * 4)), 2.2);
          const disk = dist < preset.sun.size ? 1 : 0;
          const k = clamp01(glow * 0.75 + disk);
          [r, g, b] = mix([r, g, b], sunColor, k);
        }

        // Облака — полосами вдоль широты, гуще у середины неба.
        const band = clamp01(1 - Math.abs(t - preset.cloud.height * 0.5) / (preset.cloud.height * 0.75));
        if (band > 0) {
          const n = cloudLow(u + t * 0.15) * 0.65 + cloudHigh(u * 1.7 + t * 0.4) * 0.35;
          const density = clamp01((n - (1 - preset.cloud.amount * 0.75)) * 3.2) * band * band;
          if (density > 0) [r, g, b] = mix([r, g, b], cloudColor, density * 0.85);
        }

        // Звёзды только у зенита: у полюса они не сходятся в «фейерверк»,
        // потому что рисуются точками с плотностью, падающей к горизонту.
        if (preset.stars > 0 && t > 0.35) {
          const chance = preset.stars * 0.0016 * Math.pow((t - 0.35) / 0.65, 1.5) / Math.max(0.25, Math.cos(lat * Math.PI / 2));
          if (starRand() < chance) {
            const bright = 140 + starRand() * 115;
            r = Math.max(r, bright); g = Math.max(g, bright); b = Math.max(b, bright * 1.05);
          }
        }
      }

      // Город стоит на горизонте и уходит вниз: силуэт + редкие окна.
      const tower = Math.floor(u * towers) % towers;
      const towerTop = tops[tower] * preset.city.height * (height * 0.16);
      const rowFromHorizon = horizonRow - y;
      if (rowFromHorizon >= -height * 0.02 && rowFromHorizon <= towerTop) {
        const shade = 0.82 + 0.18 * ((tower % 3) / 2);
        [r, g, b] = [cityColor[0] * shade, cityColor[1] * shade, cityColor[2] * shade];
        const insideX = (u * towers) % 1;
        const litRow = Math.floor((towerTop - rowFromHorizon) / Math.max(2, height * 0.006));
        const litCol = Math.floor(insideX * 4);
        if (rowFromHorizon > 1 && ((litRow * 7 + litCol * 13 + tower * 5) % 11) === 0) {
          [r, g, b] = mix([r, g, b], windowColor, 0.85);
        }
      }

      const o = (y * width + x) * 3;
      data[o] = Math.max(0, Math.min(255, Math.round(r)));
      data[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
      data[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }
  return { data, width, height };
}

function writeJpeg({ data, width, height }, outPath, tmp) {
  const ppm = path.join(tmp, 'sky.ppm');
  fs.writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${width} ${height}\n255\n`, 'ascii'), data]));
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', ppm, '-q:v', '5', outPath]);
}

function main() {
  const args = process.argv.slice(2);
  const only = args.find(a => a.startsWith('--only='))?.split('=')[1];
  const width = Number(args.find(a => a.startsWith('--width='))?.split('=')[1] ?? 2048);
  if (!Number.isInteger(width) || width < 512 || width > 8192) throw new Error('--width вне диапазона');

  const names = only ? [only] : Object.keys(PRESETS);
  for (const name of names) if (!PRESETS[name]) throw new Error(`нет пресета "${name}"`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostfire-sky-'));
  const rows = [];
  for (const name of names) {
    process.stdout.write(`… ${name} ${width}×${width / 2}`);
    const image = render(name, PRESETS[name], width);
    const outPath = path.join(OUT_DIR, `${name}.jpg`);
    writeJpeg(image, outPath, tmp);
    const bytes = fs.readFileSync(outPath);
    rows.push({ name, kb: Math.round(bytes.length / 1024), sha: createHash('sha256').update(bytes).digest('hex') });
    console.log(` → ${Math.round(bytes.length / 1024)} КБ`);
  }
  fs.rmSync(tmp, { recursive: true, force: true });

  fs.writeFileSync(path.join(OUT_DIR, 'PROVENANCE.md'), [
    '# Провенанс купола',
    '',
    'Панорамы построены кодом: `node tools/gen_skydome.mjs`. Это честная',
    'equirect-развёртка 2:1 — шва по долготе нет по построению, полюса сходятся',
    'в чистый цвет. Генераторы изображений давали обычный кадр, а не развёртку,',
    'из-за чего на куполе были видны стык и «воронка» у зенита.',
    '',
    '| файл | КБ | SHA-256 |',
    '| --- | --- | --- |',
    ...rows.map(r => `| ${r.name}.jpg | ${r.kb} | ${r.sha.slice(0, 16)}… |`),
    '',
  ].join('\n'), 'utf8');
  console.log(`\n${rows.length} панорам, ${rows.reduce((s, r) => s + r.kb, 0)} КБ.`);
}

main();
