// Небо для куполов: HDRI с Poly Haven (CC0) → тонмаппинг → jpg 2:1.
//
//   node tools/fetch_sky.mjs                 # только недостающие
//   node tools/fetch_sky.mjs --force
//   node tools/fetch_sky.mjs --only=arena03
//
// Почему не генератор картинок и не свой рисовальщик: нужна настоящая
// 360°-развёртка. Нейросети рисуют обычный кадр (шов и «воронка» на куполе),
// а процедурное небо выходит плоским. Poly Haven отдаёт честные панорамы под
// CC0 — их можно брать и в коммерческий проект.
//
// ffmpeg собран без zimg, поэтому его tonemap недоступен: HDR читается и
// сжимается по диапазону здесь, ffmpeg делает только jpeg из готового PPM.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets/sky');
const API = 'https://api.polyhaven.com';
const WIDTH = 2048;
const HEIGHT = 1024;

// Экспозиция считается автоматически по яркости самой панорамы (см. autoExposure);
// bias — только художественная поправка: темнее для ночи, светлее для рассвета.
// Только варианты *_puresky: у них в панораме одно небо. Обычные HDRI тащат
// фотографическую землю — дорогу, дома, — и у горизонта она спорит с вокселями.
const SKIES = [
  { id: 'skybox', slug: 'kloppenheim_06_puresky', bias: 1, note: 'общий фолбэк: облачный день с солнцем' },
  { id: 'arena01', slug: 'rosendal_park_sunset_puresky', bias: 0.95, note: 'тесная арена: закат' },
  { id: 'arena02', slug: 'kloppenheim_02_puresky', bias: 1, note: 'два уровня: ясный день с облаками' },
  // Ночь автоэкспозиция вытягивает до серого дня — сажаем яркость руками.
  { id: 'arena03', slug: 'qwantani_night_puresky', bias: 0.16, note: 'блоки: глубокая ночь со звёздами' },
  { id: 'arena04', slug: 'industrial_sunset_02_puresky', bias: 0.9, note: 'пятак: сумеречное зарево' },
  { id: 'arena05', slug: 'kloofendal_48d_partly_cloudy_puresky', bias: 1.05, note: 'мосты: светлый день' },
];

/** Radiance RGBE: заголовок текстом, дальше RLE-сканлайны. */
function decodeHdr(buffer) {
  let offset = 0;
  const line = () => {
    const end = buffer.indexOf(0x0a, offset);
    const text = buffer.toString('ascii', offset, end);
    offset = end + 1;
    return text;
  };
  if (!line().startsWith('#?')) throw new Error('не Radiance HDR');
  let resolution = line();
  while (resolution.trim() !== '') resolution = line();
  const dims = line().match(/-Y (\d+) \+X (\d+)/);
  if (!dims) throw new Error('неподдерживаемая ориентация HDR');
  const height = Number(dims[1]);
  const width = Number(dims[2]);

  const rgb = new Float32Array(width * height * 3);
  const scan = new Uint8Array(width * 4);
  for (let y = 0; y < height; y++) {
    if (buffer[offset] !== 2 || buffer[offset + 1] !== 2) throw new Error('ожидался RLE-сканлайн');
    offset += 4;
    for (let channel = 0; channel < 4; channel++) {
      let x = 0;
      while (x < width) {
        let count = buffer[offset++];
        if (count > 128) {                     // серия одинаковых байт
          const value = buffer[offset++];
          for (let i = 0; i < count - 128; i++) scan[(x++) * 4 + channel] = value;
        } else {                               // просто count байт подряд
          for (let i = 0; i < count; i++) scan[(x++) * 4 + channel] = buffer[offset++];
        }
      }
    }
    for (let x = 0; x < width; x++) {
      const e = scan[x * 4 + 3];
      const scale = e ? Math.pow(2, e - 136) : 0; // 128 + 8 бит мантиссы
      const o = (y * width + x) * 3;
      rgb[o] = scan[x * 4] * scale;
      rgb[o + 1] = scan[x * 4 + 1] * scale;
      rgb[o + 2] = scan[x * 4 + 2] * scale;
    }
  }
  return { width, height, rgb };
}

/**
 * Экспозиция по медиане яркости неба: HDRI отличаются на порядки, и любое
 * фиксированное число выбеливает одни панорамы и топит другие. Считаем по
 * верхней половине (это и есть небо), медиану уводим в комфортные ~0.22.
 */
function autoExposure(image) {
  const samples = [];
  const rows = Math.floor(image.height / 2);
  const stepY = Math.max(1, Math.floor(rows / 180));
  const stepX = Math.max(1, Math.floor(image.width / 320));
  for (let y = 0; y < rows; y += stepY) {
    for (let x = 0; x < image.width; x += stepX) {
      const o = (y * image.width + x) * 3;
      samples.push(0.2126 * image.rgb[o] + 0.7152 * image.rgb[o + 1] + 0.0722 * image.rgb[o + 2]);
    }
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length * 0.5)] || 0.001;
  const bright = samples[Math.floor(samples.length * 0.95)] || median;
  // Одной медианы мало: у равномерно светлого неба она низкая, и панорама
  // уходит в белое. Верхний перцентиль держит облака от выжигания.
  return Math.min(60, Math.max(0.02, Math.min(0.22 / median, 1.5 / bright)));
}

/** ACES-подобная кривая: солнце перестаёт выжигать половину кадра. */
function tonemap(value) {
  const v = Math.max(0, value);
  const mapped = (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
  return Math.pow(Math.min(1, mapped), 1 / 2.2);
}

/** Box-ресайз в целевой размер: панорама всегда 2:1, дробных краёв нет. */
function resize(source, width, height, exposure) {
  const out = Buffer.alloc(width * height * 3);
  const sx = source.width / width;
  const sy = source.height / height;
  for (let y = 0; y < height; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy));
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const o = (yy * source.width + xx) * 3;
          r += source.rgb[o]; g += source.rgb[o + 1]; b += source.rgb[o + 2];
          n++;
        }
      }
      const o = (y * width + x) * 3;
      out[o] = Math.round(tonemap((r / n) * exposure) * 255);
      out[o + 1] = Math.round(tonemap((g / n) * exposure) * 255);
      out[o + 2] = Math.round(tonemap((b / n) * exposure) * 255);
    }
  }
  return out;
}

/** Сеть до Poly Haven периодически рвётся — повторяем сам запрос. */
async function retry(job, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try { return await job(); }
    catch (error) {
      if (attempt >= attempts) throw error;
      process.stdout.write(` (повтор ${attempt})`);
      await new Promise(r => setTimeout(r, 3_000 * attempt));
    }
  }
}

async function fetchJson(url) {
  return retry(async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
    return response.json();
  });
}

async function download(url) {
  return retry(async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`скачивание → HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  });
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const force = args.has('--force');
  const only = [...args].find(a => a.startsWith('--only='))?.split('=')[1];
  const wanted = only ? SKIES.filter(s => s.id === only) : SKIES;
  if (!wanted.length) throw new Error(`нет неба "${only}"`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostfire-sky-'));
  const records = [];

  for (const sky of SKIES) {
    const outPath = path.join(OUT_DIR, `${sky.id}.jpg`);
    const needs = wanted.includes(sky) && (force || !fs.existsSync(outPath));
    if (needs) {
      process.stdout.write(`… ${sky.id} ← ${sky.slug}`);
      const files = await fetchJson(`${API}/files/${sky.slug}`);
      const url = files.hdri?.['2k']?.hdr?.url;
      if (!url) throw new Error(`${sky.slug}: нет 2k hdr`);
      const hdr = await download(url);
      const image = decodeHdr(hdr);
      const exposure = autoExposure(image) * (sky.bias ?? 1);
      sky.exposure = Number(exposure.toFixed(3));
      const pixels = resize(image, WIDTH, HEIGHT, exposure);
      const ppm = path.join(tmp, `${sky.id}.ppm`);
      fs.writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${WIDTH} ${HEIGHT}\n255\n`, 'ascii'), pixels]));
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', ppm, '-q:v', '5', outPath]);
      console.log(` → ${Math.round(fs.statSync(outPath).size / 1024)} КБ`);
    }
    if (!fs.existsSync(outPath)) continue;
    const info = await fetchJson(`${API}/info/${sky.slug}`).catch(() => ({}));
    const bytes = fs.readFileSync(outPath);
    records.push({
      ...sky,
      authors: Object.keys(info.authors ?? {}).join(', ') || '—',
      kb: Math.round(bytes.length / 1024),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }

  fs.writeFileSync(path.join(OUT_DIR, 'PROVENANCE.md'), [
    '# Провенанс купола',
    '',
    'Панорамы — HDRI с [Poly Haven](https://polyhaven.com/hdris) под лицензией',
    'CC0 (общественное достояние, коммерческое использование разрешено).',
    '`tools/fetch_sky.mjs` скачивает 2k HDR, считает экспозицию по медиане',
    'яркости неба, применяет ACES-тонмаппинг и сохраняет jpg 2048×1024 —',
    'честную 360°-развёртку.',
    '',
    '| файл | источник | автор | экспозиция | КБ | SHA-256 |',
    '| --- | --- | --- | --- | --- | --- |',
    ...records.map(r => `| ${r.id}.jpg | [${r.slug}](https://polyhaven.com/a/${r.slug}) | ${r.authors} | ${r.exposure ?? '—'} | ${r.kb} | ${r.sha256.slice(0, 16)}… |`),
    '',
    '## Назначение',
    '',
    ...records.map(r => `- \`${r.id}.jpg\` — ${r.note}`),
    '',
  ].join('\n'), 'utf8');

  console.log(`\n${records.length} панорам, ${records.reduce((s, r) => s + r.kb, 0)} КБ.`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(String(error.message ?? error));
  process.exit(1);
});
