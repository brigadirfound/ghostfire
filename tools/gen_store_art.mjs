// Мастера витрины (иконка, maskable-иконка, обложка, hero) через Visionary.
// Дальше их режет общий студийный конвейер:
//   node tools/gen_store_art.mjs
//   python ../tools/store-assets.py . assets/store/visuals/masters/src-icon.png \
//     ...src-maskable.png ...src-cover.png ...src-hero.png
//
// Мастера сознательно генерируются крупнее целевых размеров: store-assets.py
// делает ImageOps.fit, и запас по краям позволяет ему кадрировать без потери
// смысла. Для maskable запас критичен — площадка режет иконку в круг.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets/store/visuals/masters');

// Общая рамка: узнаваемый воксельный шутер, никакого текста — подписи на
// карточке рисует сама площадка, а надписи на картинке модерация не любит.
const WORLD = 'blocky voxel first-person shooter world, chunky cube arena, ' +
  'stylized low-poly 3d game art, dramatic rim lighting, vivid saturated colors, ' +
  'no text, no letters, no numbers, no watermark, no logo, no UI elements';

const JOBS = [
  {
    id: 'src-icon',
    aspectRatio: '1:1',
    prompt: `${WORLD}, app icon composition: a single voxel soldier head in a helmet ` +
      'facing the viewer, a glowing cyan ghost silhouette rising right behind him, ' +
      'orange sunset rim light, tight crop, centered, high contrast, reads clearly at small size',
  },
  {
    id: 'src-maskable',
    aspectRatio: '1:1',
    prompt: `${WORLD}, app icon composition with generous empty margins on all sides, ` +
      'a single voxel soldier head in a helmet with a glowing cyan ghost behind him, ' +
      'subject strictly inside the central circle, plain dark blue-violet background at the edges, ' +
      'nothing important near the corners',
  },
  {
    id: 'src-cover',
    aspectRatio: '4:3',
    prompt: `${WORLD}, key art: a voxel soldier in the foreground aiming a stylized rifle to the right, ` +
      'a translucent cyan ghost duplicate of him charging from the left, cube crates and walls between them, ' +
      'orange and violet sunset sky, cinematic duel composition, empty darker area in the lower third',
  },
  {
    id: 'src-hero',
    aspectRatio: '16:9',
    prompt: `${WORLD}, ultra wide banner: voxel arena seen from the side, two fighters facing each other ` +
      'across cube cover — a solid soldier on the right, a glowing cyan ghost on the left, ' +
      'tracer streaks between them, wide sunset sky above, lots of horizontal space, subjects near the center',
  },
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

async function generateOnce(job) {
  const response = await fetch(`${baseUrl}/v1/api/nano-banana`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, prompt: job.prompt, images: [], aspectRatio: job.aspectRatio, imageSize: '2K',
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
  if (buffer.length < 4096) throw new Error('картинка подозрительно мала');
  return { buffer, requestId: data.id ?? null };
}

async function generate(job, attempts = 3) {
  for (let attempt = 1; ; attempt++) {
    try { return await generateOnce(job); }
    catch (error) {
      if (attempt >= attempts) throw error;
      process.stdout.write(` (повтор ${attempt})`);
      await new Promise(r => setTimeout(r, 4_000 * attempt));
    }
  }
}

async function main() {
  if (!token) throw new Error('нет VISIONARY_API_KEY (окружение или локальный .env)');
  const args = new Set(process.argv.slice(2));
  const force = args.has('--force');
  const only = [...args].find(a => a.startsWith('--only='))?.split('=')[1];
  const wanted = only ? JOBS.filter(j => j.id === only) : JOBS;
  if (!wanted.length) throw new Error(`нет мастера "${only}"`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const records = [];
  for (const job of JOBS) {
    const outPath = path.join(OUT_DIR, `${job.id}.png`);
    if (wanted.includes(job) && (force || !fs.existsSync(outPath))) {
      process.stdout.write(`… ${job.id}`);
      const { buffer, requestId } = await generate(job);
      // ffmpeg приводит к PNG без альфы: площадка требует непрозрачные промо.
      // Пишем через временный файл — ffmpeg не умеет читать и писать один и тот же.
      const raw = `${outPath}.raw.png`;
      fs.writeFileSync(raw, buffer);
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', raw,
        '-vf', 'format=rgb24', '-update', '1', outPath]);
      fs.rmSync(raw, { force: true });
      console.log(` → ${Math.round(fs.statSync(outPath).size / 1024)} КБ (${job.aspectRatio}) ${requestId ?? ''}`);
    }
    if (fs.existsSync(outPath)) {
      const bytes = fs.readFileSync(outPath);
      records.push({ id: job.id, kb: Math.round(bytes.length / 1024), sha256: createHash('sha256').update(bytes).digest('hex') });
    }
  }

  const promptsFile = path.join(ROOT, 'assets/store/submission/imagegen-prompts.md');
  fs.mkdirSync(path.dirname(promptsFile), { recursive: true });
  fs.writeFileSync(promptsFile, [
    '# Промпты витрины',
    '',
    `Мастера сгенерированы через Visionary (\`${model}\`) инструментом \`tools/gen_store_art.mjs\`,`,
    'затем нарезаны общим конвейером студии `tools/store-assets.py`.',
    '',
    '| мастер | соотношение | КБ | SHA-256 |',
    '| --- | --- | --- | --- |',
    ...records.map(r => {
      const job = JOBS.find(j => j.id === r.id);
      return `| ${r.id}.png | ${job.aspectRatio} | ${r.kb} | ${r.sha256.slice(0, 16)}… |`;
    }),
    '',
    ...JOBS.flatMap(job => [`## ${job.id}`, '', '```', job.prompt, '```', '']),
  ].join('\n'), 'utf8');

  console.log(`\n${records.length} мастеров. Промпты: assets/store/submission/imagegen-prompts.md`);
}

main().catch((error) => {
  console.error(String(error.message ?? error));
  process.exit(1);
});
