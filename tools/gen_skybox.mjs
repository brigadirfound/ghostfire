// Генерация скайбокса и фона меню через nano-banana-pro (Visionary API).
// Ключ читается в рантайме из .env (ghostfire → chislopad → berry-merge),
// в репозиторий не попадает. Запуск: node tools/gen_skybox.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const ENV_CANDIDATES = [
  new URL('../.env', import.meta.url),
  'D:/games/chislopad/.env',
  'D:/games/berry-merge/.env',
];

let TOKEN = null, BASE = 'https://visionary.beer';
for (const p of ENV_CANDIDATES) {
  try {
    const text = readFileSync(p, 'utf-8');
    for (const line of text.split('\n')) {
      const [k, ...rest] = line.trim().split('=');
      const v = rest.join('=').trim().replace(/^["']|["']$/g, '');
      if (k === 'VISIONARY_API_KEY') TOKEN = v;
      if (k === 'VISIONARY_BASE') BASE = v;
    }
    if (TOKEN) { console.log(`ключ найден в: ${p}`); break; }
  } catch { /* нет файла — следующий кандидат */ }
}
if (!TOKEN) {
  console.error('VISIONARY_API_KEY не найден ни в одном .env — пропуск генерации');
  process.exit(1);
}

const OUT = new URL('../assets/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const JOBS = [
  {
    file: 'skybox.jpg',
    aspectRatio: '16:9',
    imageSize: '4K',
    prompt: 'seamless equirectangular 360 panorama skybox, voxel cube city skyline at sunset, ' +
      'blocky minecraft-style buildings silhouettes on the horizon low near the bottom edge, ' +
      'huge warm gradient sky from deep orange at horizon to purple and dark blue at top, ' +
      'smooth clean gradient with no banding or noise, a few blocky voxel clouds, ' +
      'soft sun glow on the left side, stylized game art, crisp clean shapes, ' +
      'no text, no watermark, horizon line exactly at the lower third',
  },
  {
    file: 'menu_bg.jpg',
    aspectRatio: '16:9',
    prompt: 'voxel cube city at sunset viewed from a rooftop, minecraft-style blocky buildings ' +
      'with glowing neon windows, two voxel characters silhouettes facing each other in a duel on a rooftop, ' +
      'warm orange-purple dramatic sky with blocky clouds, cinematic wide shot, stylized game key art, ' +
      'darker at the bottom for UI overlay, no text, no watermark, no logo',
  },
];

async function generate(job) {
  console.log(`генерация ${job.file}...`);
  const res = await fetch(`${BASE}/v1/api/nano-banana`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'nano-banana-pro',
      prompt: job.prompt,
      images: [],
      aspectRatio: job.aspectRatio,
      imageSize: job.imageSize ?? '2K',
      optimizeChineseText: false,
      replyType: 'json',
    }),
  });
  const data = await res.json();
  if (data.status !== 'succeeded' || !data.results?.[0]?.url) {
    throw new Error(`генерация не удалась: ${JSON.stringify(data).slice(0, 300)}`);
  }
  const img = await fetch(data.results[0].url);
  const buf = Buffer.from(await img.arrayBuffer());
  writeFileSync(new URL(job.file, OUT), buf);
  console.log(`  сохранено assets/${job.file} (${Math.round(buf.length / 1024)} КБ)`);
}

for (const job of JOBS) {
  if (existsSync(new URL(job.file, OUT)) && process.argv[2] !== '--force') {
    console.log(`assets/${job.file} уже есть — пропуск (перегенерация: --force)`);
    continue;
  }
  await generate(job);
}
console.log('готово');
