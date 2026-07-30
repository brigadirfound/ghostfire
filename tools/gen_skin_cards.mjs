// Карточки скинов для магазина: Visionary рисует воксельного бойца в палитре
// каждого скина. Палитра берётся из skins/shop.json — картинка и настоящие
// цвета в игре не расходятся.
//
//   node tools/gen_skin_cards.mjs               # только недостающие
//   node tools/gen_skin_cards.mjs --force
//   node tools/gen_skin_cards.mjs --only=void

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets/skins');
const MANIFEST = path.join(OUT_DIR, 'PROVENANCE.md');
const WIDTH = 384;
const HEIGHT = 288;

// Настроение карточки, а не только цвет: «фиолетовый боец» и «боец из пустоты»
// читаются по-разному, и второе продаёт лучше.
const MOODS = {
  neon: 'neon cyberpunk alley at night, magenta rim light, wet asphalt reflections',
  gold: 'golden trophy hall, warm spotlights, luxurious and boastful',
  forest: 'misty pine forest at dawn, soft green light, camouflage mood',
  void: 'deep space void, violet energy glow around the silhouette, mysterious',
  crimson: 'burning red battlefield haze, embers in the air, aggressive',
  custom: 'bright creative workshop with paint splashes and color swatches',
};

const STYLE = 'blocky voxel character in a first-person shooter, cube head with large flat face, ' +
  'chunky minecraft-like proportions, holding a stylized sci-fi rifle, dynamic three-quarter pose, ' +
  'game shop card art, dramatic rim lighting, clean composition, centered, ' +
  'no text, no letters, no watermark, no UI, no logo';

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

function jobs() {
  const shop = JSON.parse(fs.readFileSync(path.join(ROOT, 'skins/shop.json'), 'utf8'));
  const list = shop.skins.map((item) => {
    const body = item.skin?.body ?? {};
    const palette = `body color ${body.torso}, skin tone ${body.head}, legs ${body.legs}, ` +
      `glowing accents ${item.skin?.tracer}`;
    return {
      id: item.id,
      prompt: `${STYLE}, ${palette}, background: ${MOODS[item.id] ?? 'dark arena'}`,
    };
  });
  list.push({
    id: 'custom',
    prompt: `${STYLE}, character painted in several bright mismatched colors as if customized by hand, ` +
      `background: ${MOODS.custom}`,
  });
  return list;
}

async function generateOnce(prompt) {
  const response = await fetch(`${baseUrl}/v1/api/nano-banana`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, prompt, images: [], aspectRatio: '4:3', imageSize: '2K',
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
  if (buffer.length < 2048) throw new Error('картинка подозрительно мала');
  return { buffer, requestId: data.id ?? null };
}

/** Сеть до провайдера рвётся, а генерация платная — повторяем сам запрос. */
async function generate(prompt, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try { return await generateOnce(prompt); }
    catch (error) {
      if (attempt >= attempts) throw error;
      process.stdout.write(` (повтор ${attempt})`);
      await new Promise(r => setTimeout(r, 4_000 * attempt));
    }
  }
}

/** Карточка в магазине занимает ~200 px — 2K держать незачем. */
function shrink(rawPath, outPath) {
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y', '-i', rawPath,
    '-vf', `scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,crop=${WIDTH}:${HEIGHT}`,
    '-q:v', '6', outPath,
  ]);
}

async function main() {
  if (!token) throw new Error('нет VISIONARY_API_KEY (окружение или локальный .env)');
  const args = new Set(process.argv.slice(2));
  const force = args.has('--force');
  const only = [...args].find(a => a.startsWith('--only='))?.split('=')[1];
  const all = jobs();
  const wanted = only ? all.filter(j => j.id === only) : all;
  if (!wanted.length) throw new Error(`нет карточки "${only}"`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostfire-skins-'));
  const records = [];

  for (const job of all) {
    const file = `${job.id}.jpg`;
    const outPath = path.join(OUT_DIR, file);
    if (wanted.includes(job) && (force || !fs.existsSync(outPath))) {
      process.stdout.write(`… ${file}`);
      const { buffer, requestId } = await generate(job.prompt);
      const rawPath = path.join(tmp, `${job.id}.png`);
      fs.writeFileSync(rawPath, buffer);
      shrink(rawPath, outPath);
      const bytes = fs.readFileSync(outPath);
      console.log(` → ${Math.round(bytes.length / 1024)} КБ`);
      records.push({ file, prompt: job.prompt, requestId, sha256: sha(bytes), kb: Math.round(bytes.length / 1024) });
      continue;
    }
    if (fs.existsSync(outPath)) {
      const bytes = fs.readFileSync(outPath);
      records.push({ file, prompt: job.prompt, requestId: null, sha256: sha(bytes), kb: Math.round(bytes.length / 1024) });
    }
  }

  fs.writeFileSync(MANIFEST, [
    '# Провенанс карточек магазина',
    '',
    `Сгенерированы через Visionary (\`${model}\`) инструментом \`tools/gen_skin_cards.mjs\`.`,
    `Палитра каждой карточки взята из \`skins/shop.json\`, размер ${WIDTH}×${HEIGHT}.`,
    '',
    '| файл | SHA-256 | КБ | request id |',
    '| --- | --- | --- | --- |',
    ...records.map(r => `| ${r.file} | ${r.sha256.slice(0, 16)}… | ${r.kb} | ${r.requestId ?? '—'} |`),
    '',
    '## Промпты',
    '',
    ...records.flatMap(r => [`### ${r.file}`, '', '```', r.prompt, '```', '']),
  ].join('\n'), 'utf8');

  console.log(`\n${records.length} карточек, ${records.reduce((s, r) => s + r.kb, 0)} КБ.`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

main().catch((error) => {
  console.error(String(error.message ?? error));
  process.exit(1);
});
