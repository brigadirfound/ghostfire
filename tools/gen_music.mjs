// Генерация музыки через Suno API: тема меню и по треку на каждую арену.
// Ключ берётся из SUNO_API_KEY или из локального файла вне репозитория —
// в git он не попадает никогда.
//
//   node tools/gen_music.mjs                 # только недостающие треки
//   node tools/gen_music.mjs --only=menu     # конкретный трек
//   node tools/gen_music.mjs --force         # перегенерировать существующие
//
// Оригинал Suno — стерео ~3 МБ на трек, для браузерной игры это неприемлемо:
// ffmpeg режет до LOOP_SEC, сводит в моно и кодирует в BITRATE.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'assets/music');
const PROVENANCE = path.join(OUT_DIR, 'PROVENANCE.md');
const API_URL = 'https://www.suno-api.io/v1/chat/completions';
const MODEL = 'suno-v5-5';
const LOOP_SEC = 72;
const FADE_SEC = 3;
const BITRATE = '72k';

// Общая рамка стиля: без вокала, чтобы трек не спорил с выстрелами, и с
// ровным темпом — иначе склейка петли слышна.
const STYLE = 'instrumental only, no vocals, no lyrics, seamless loop, ' +
  'retro arcade FPS soundtrack, punchy drums, analog synths, mixed dry without long reverb tails';

const TRACKS = [
  { id: 'menu', prompt: `${STYLE}, main menu theme, mid-tempo 100 bpm dark synthwave, confident and roomy, restrained melody that can play under UI clicks` },
  { id: 'arena01', prompt: `${STYLE}, tight close-quarters arena, fast 140 bpm industrial breakbeat, tense and claustrophobic, short stabs` },
  { id: 'arena02', prompt: `${STYLE}, two-level arena, driving 128 bpm electro with vertical arpeggios, alert and mobile` },
  { id: 'arena03', prompt: `${STYLE}, sniper duel on open blocks, slow 96 bpm brooding pulse, sparse and patient, long low drones` },
  { id: 'arena04', prompt: `${STYLE}, small circular arena, relentless 150 bpm drum and bass, aggressive and non-stop` },
  { id: 'arena05', prompt: `${STYLE}, bridges over a chasm, 118 bpm airy synth with wide pads and a steady kick, risky and open` },
];

function apiKey() {
  const fromEnv = process.env.SUNO_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  // Файл лежит рядом с репозиторием, а не внутри: ключ не должен уехать в git.
  const external = path.resolve(ROOT, '..', 'suno_key.txt');
  if (fs.existsSync(external)) {
    const first = fs.readFileSync(external, 'utf8').split(/\r?\n/)[0].trim();
    if (first) return first;
  }
  throw new Error('нет ключа: задайте SUNO_API_KEY или положите suno_key.txt рядом с репозиторием');
}

async function generate(prompt, key) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: MODEL, messages: [{ role: 'user', content: prompt }], stream: false }),
  });
  if (!response.ok) throw new Error(`Suno ответил ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const text = await response.text();
  const itemId = text.match(/item_id=([a-f0-9-]{36})/i)?.[1];
  if (!itemId) throw new Error(`в ответе нет ссылки на аудио: ${text.slice(0, 200)}`);
  const title = text.match(/## Song Title:\s*(.+)/)?.[1]?.trim() ?? '';
  return { itemId, title, audioUrl: `https://audiopipe.suno.ai/?item_id=${itemId}` };
}

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`скачивание вернуло ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.subarray(0, 3).toString('ascii') !== 'ID3' && buffer[0] !== 0xff) {
    throw new Error('ответ не похож на mp3');
  }
  return buffer;
}

/** Обрезает до петли, сводит в моно и жмёт: 3 МБ стерео в игре недопустимы. */
function compress(rawPath, outPath) {
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', rawPath,
    '-t', String(LOOP_SEC),
    '-af', `afade=t=out:st=${LOOP_SEC - FADE_SEC}:d=${FADE_SEC},dynaudnorm=p=0.9`,
    '-ac', '1', '-ar', '32000', '-b:a', BITRATE,
    '-map_metadata', '-1',
    outPath,
  ]);
}

function writeProvenance(entries) {
  const lines = [
    '# Провенанс музыки',
    '',
    'Треки сгенерированы через Suno API (`tools/gen_music.mjs`), модель ' + `\`${MODEL}\`` + '.',
    'Оригиналы — стерео ~3 МБ; в игру попадает обрезанная до ' + LOOP_SEC + ' с моно-версия ' + BITRATE + '.',
    '',
    '| файл | item_id | название Suno | SHA-256 | КБ |',
    '| --- | --- | --- | --- | --- |',
    ...entries.map(e => `| ${e.file} | ${e.itemId} | ${e.title} | ${e.sha256.slice(0, 16)}… | ${e.kb} |`),
    '',
    '## Промпты',
    '',
    ...entries.flatMap(e => [`### ${e.file}`, '', '```', e.prompt, '```', '']),
  ];
  fs.writeFileSync(PROVENANCE, lines.join('\n'), 'utf8');
}

function readProvenance() {
  if (!fs.existsSync(PROVENANCE)) return new Map();
  const text = fs.readFileSync(PROVENANCE, 'utf8');
  const rows = [...text.matchAll(/^\| (\S+\.mp3) \| ([a-f0-9-]{36}) \| (.*?) \| (\w+)… \| (\d+) \|$/gm)];
  const prompts = new Map([...text.matchAll(/### (\S+\.mp3)\n\n```\n([\s\S]*?)\n```/g)].map(m => [m[1], m[2]]));
  return new Map(rows.map(r => [r[1], {
    file: r[1], itemId: r[2], title: r[3], sha256: r[4], kb: Number(r[5]),
    prompt: prompts.get(r[1]) ?? '',
  }]));
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const force = args.has('--force');
  const only = [...args].find(a => a.startsWith('--only='))?.split('=')[1];
  const wanted = only ? TRACKS.filter(t => t.id === only) : TRACKS;
  if (!wanted.length) throw new Error(`нет трека "${only}"`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const known = readProvenance();
  const key = apiKey();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostfire-music-'));

  for (const track of wanted) {
    const file = `${track.id}.mp3`;
    const outPath = path.join(OUT_DIR, file);
    if (!force && fs.existsSync(outPath)) {
      console.log(`= ${file} уже есть, пропуск (--force чтобы перегенерировать)`);
      continue;
    }
    process.stdout.write(`… ${file}: запрос к Suno`);
    const { itemId, title, audioUrl } = await generate(track.prompt, key);
    process.stdout.write(` → ${itemId}\n`);
    const raw = await download(audioUrl);
    const rawPath = path.join(tmp, `${track.id}.raw.mp3`);
    fs.writeFileSync(rawPath, raw);
    compress(rawPath, outPath);
    const bytes = fs.readFileSync(outPath);
    known.set(file, {
      file, itemId, title, prompt: track.prompt,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      kb: Math.round(bytes.length / 1024),
    });
    console.log(`  ${Math.round(raw.length / 1024)} КБ оригинал → ${Math.round(bytes.length / 1024)} КБ в игре`);
  }

  const ordered = TRACKS.map(t => known.get(`${t.id}.mp3`)).filter(Boolean);
  writeProvenance(ordered);
  const total = ordered.reduce((sum, e) => sum + e.kb, 0);
  console.log(`\nВсего ${ordered.length} треков, ${total} КБ. Провенанс: assets/music/PROVENANCE.md`);
  fs.rmSync(tmp, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(String(error.message ?? error));
  process.exit(1);
});
