// Иконки интерфейса через Visionary (nano-banana), тот же провайдер, что у
// скайбоксов. Ключ — только из окружения или локального .env.
//
//   node tools/gen_icons.mjs             # только недостающие
//   node tools/gen_icons.mjs --force     # перерисовать все
//   node tools/gen_icons.mjs --only=heart
//
// Генератор отдаёт картинку с фоном, поэтому ffmpeg вырезает чёрный в альфу и
// ужимает до 128 px: иконка в UI занимает 24–32 px, больше не нужно.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets/icons');
const MANIFEST = path.join(OUT_DIR, 'PROVENANCE.md');
const SIZE = 128;

// Единый стиль для всех иконок: без него набор выглядит как случайная сборка.
const STYLE = 'flat vector game UI icon, single centered symbol, thick bold shapes, ' +
  'no gradients, no text, no letters, no watermark, high contrast, ' +
  'pure white symbol on pure black background, sharp edges, minimal detail';

const ICONS = [
  { id: 'play', prompt: `${STYLE}, a solid triangular play arrow pointing right` },
  { id: 'code', prompt: `${STYLE}, a key symbol with a square bow and simple teeth` },
  { id: 'shop', prompt: `${STYLE}, a shopping bag with a handle` },
  { id: 'editor', prompt: `${STYLE}, a pencil crossing a wrench, nothing else, no paper, no background objects` },
  { id: 'settings', prompt: `${STYLE}, a gear with six teeth and a round hole` },
  { id: 'heart', prompt: `${STYLE}, a chunky heart shape with square pixel corners` },
  { id: 'ammo', prompt: `${STYLE}, a rifle magazine seen from the side, rounded top` },
  { id: 'reload', prompt: `${STYLE}, two arrows forming a circular refresh loop` },
  { id: 'ghost', prompt: `${STYLE}, a blocky voxel ghost with a wavy bottom edge and two eyes` },
  { id: 'howto', prompt: `${STYLE}, a question mark inside a rounded square badge` },
  // Килфид и экраны раунда/матча: смысловые значки в том же стиле.
  { id: 'skull', prompt: `${STYLE}, a blocky voxel skull, front view, two square eye sockets` },
  { id: 'torso', prompt: `${STYLE}, a blocky voxel torso silhouette with a target ring on the chest` },
  { id: 'victory', prompt: `${STYLE}, a laurel wreath open at the top, symmetrical` },
  { id: 'defeat', prompt: `${STYLE}, a cracked shield broken in two along a jagged line` },
  { id: 'badge', prompt: `${STYLE}, an empty hexagonal frame with thick beveled border and hollow center, nothing inside` },
  { id: 'streak', prompt: `${STYLE}, a bold lightning bolt` },
];

function readLocalEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return {};
  const values = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [key, ...rest] = line.split('=');
    values[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

const env = readLocalEnv();
const token = process.env.VISIONARY_API_KEY || env.VISIONARY_API_KEY;
const baseUrl = process.env.VISIONARY_BASE || env.VISIONARY_BASE || 'https://visionary.beer';
const model = process.env.VISIONARY_MODEL || env.VISIONARY_MODEL || 'nano-banana-pro';

/** Сеть до провайдера рвётся, а генерация платная — повторяем сам запрос. */
async function generate(prompt, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try { return await generateOnce(prompt); }
    catch (error) {
      if (attempt >= attempts) throw error;
      process.stdout.write(` (повтор ${attempt}: ${String(error.message).slice(0, 40)})`);
      await new Promise(r => setTimeout(r, 4_000 * attempt));
    }
  }
}

async function generateOnce(prompt) {
  const response = await fetch(`${baseUrl}/v1/api/nano-banana`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      // 1K модель не принимает — минимальный поддерживаемый размер 2K.
      model, prompt, images: [], aspectRatio: '1:1', imageSize: '2K',
      optimizeChineseText: false, replyType: 'json',
    }),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const url = data.results?.[0]?.url;
  if (data.status !== 'succeeded' || !url) throw new Error(JSON.stringify(data).slice(0, 200));
  const image = await fetch(url);
  if (!image.ok) throw new Error(`скачивание HTTP ${image.status}`);
  const buffer = Buffer.from(await image.arrayBuffer());
  if (buffer.length < 1024) throw new Error('картинка подозрительно мала');
  return { buffer, requestId: data.id ?? null };
}

/** Чёрный фон → альфа, плюс уменьшение: в UI иконка занимает 24–32 px. */
function toAlphaPng(rawPath, outPath) {
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', rawPath,
    '-vf', `scale=${SIZE}:${SIZE}:flags=lanczos,colorkey=0x000000:0.32:0.12,format=rgba`,
    outPath,
  ]);
}

function writeManifest(records) {
  const lines = [
    '# Провенанс иконок',
    '',
    `Сгенерированы через Visionary (\`${model}\`) инструментом \`tools/gen_icons.mjs\`.`,
    'Чёрный фон вырезан в альфу, размер приведён к ' + SIZE + '×' + SIZE + '.',
    '',
    '| файл | SHA-256 | КБ | request id |',
    '| --- | --- | --- | --- |',
    ...records.map(r => `| ${r.file} | ${r.sha256.slice(0, 16)}… | ${r.kb} | ${r.requestId ?? '—'} |`),
    '',
    '## Промпты',
    '',
    ...records.flatMap(r => [`### ${r.file}`, '', '```', r.prompt, '```', '']),
  ];
  fs.writeFileSync(MANIFEST, lines.join('\n'), 'utf8');
}

async function main() {
  if (!token) throw new Error('нет VISIONARY_API_KEY (окружение или локальный .env)');
  const args = new Set(process.argv.slice(2));
  const force = args.has('--force');
  const only = [...args].find(a => a.startsWith('--only='))?.split('=')[1];
  const wanted = only ? ICONS.filter(i => i.id === only) : ICONS;
  if (!wanted.length) throw new Error(`нет иконки "${only}"`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostfire-icons-'));
  const records = [];

  for (const icon of ICONS) {
    const file = `${icon.id}.png`;
    const outPath = path.join(OUT_DIR, file);
    const needs = wanted.includes(icon) && (force || !fs.existsSync(outPath));
    if (needs) {
      process.stdout.write(`… ${file}`);
      const { buffer, requestId } = await generate(icon.prompt);
      const rawPath = path.join(tmp, `${icon.id}.png`);
      fs.writeFileSync(rawPath, buffer);
      toAlphaPng(rawPath, outPath);
      console.log(` → ${Math.round(fs.statSync(outPath).size / 1024)} КБ`);
      records.push({ file, prompt: icon.prompt, requestId, ...digest(outPath) });
      continue;
    }
    if (fs.existsSync(outPath)) records.push({ file, prompt: icon.prompt, requestId: null, ...digest(outPath) });
  }

  writeManifest(records);
  const total = records.reduce((sum, r) => sum + r.kb, 0);
  console.log(`\n${records.length} иконок, ${total} КБ. Провенанс: assets/icons/PROVENANCE.md`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

function digest(file) {
  const bytes = fs.readFileSync(file);
  return { sha256: createHash('sha256').update(bytes).digest('hex'), kb: Math.round(bytes.length / 1024) };
}

main().catch((error) => {
  console.error(String(error.message ?? error));
  process.exit(1);
});
