// Опциональная генерация фонов через Visionary API.
// Базовые арты: node tools/gen_skybox.mjs --mode=base
// Кандидаты:    node tools/gen_skybox.mjs --mode=candidates
// Повторная генерация требует явного --force; API-ключ берётся только из env или ./.env.
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = new URL('../', import.meta.url);
const ASSETS = new URL('../assets/', import.meta.url);
const CANDIDATES = new URL('../assets/skybox_candidates/', import.meta.url);
const args = new Set(process.argv.slice(2));
const modeArg = process.argv.find((arg) => arg.startsWith('--mode='));
const mode = modeArg?.slice(7) ?? 'base';
const force = args.has('--force');
if (!['base', 'candidates', 'all'].includes(mode)) {
  throw new Error('Use --mode=base, --mode=candidates, or --mode=all');
}

function readLocalEnv() {
  const values = {};
  const file = new URL('.env', ROOT);
  if (!existsSync(file)) return values;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const [key, ...rest] = line.split('=');
    values[key.trim()] = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
  }
  return values;
}

const localEnv = readLocalEnv();
const token = process.env.VISIONARY_API_KEY || localEnv.VISIONARY_API_KEY;
const baseUrl = process.env.VISIONARY_BASE || localEnv.VISIONARY_BASE || 'https://visionary.beer';
if (!token) throw new Error('VISIONARY_API_KEY is missing (set it in the environment or repository-local .env)');

const BASE_JOBS = [
  {
    file: 'skybox.jpg',
    aspectRatio: '16:9',
    imageSize: '4K',
    prompt: 'seamless equirectangular 360 panorama skybox, voxel cube city skyline at sunset, ' +
      'blocky buildings low near the bottom edge, huge warm gradient sky from deep orange at horizon to purple ' +
      'and dark blue at top, a few blocky clouds, soft sun glow on the left, clean stylized game art, ' +
      'no text, no watermark, horizon exactly at the lower third',
  },
  {
    file: 'menu_bg.jpg',
    aspectRatio: '16:9',
    imageSize: '2K',
    prompt: 'voxel cube city at sunset viewed from a rooftop, blocky buildings with glowing neon windows, ' +
      'two voxel character silhouettes facing each other in a duel, warm orange-purple dramatic sky, ' +
      'cinematic wide game key art, darker at the bottom for UI overlay, no text, no watermark, no logo',
  },
];

const CANDIDATE_FOCUSES = [
  'orange sunset and distant voxel skyline',
  'purple dusk and sparse blocky clouds',
  'deep blue nightfall with a warm horizon',
  'neon city haze with a clear zenith',
  'high-contrast golden hour with restrained silhouettes',
];
const CANDIDATE_JOBS = CANDIDATE_FOCUSES.map((focus, index) => ({
  file: `candidate_${index + 1}.jpg`,
  aspectRatio: '16:9',
  imageSize: '4K',
  prompt: `wide voxel arena sky source, ${focus}, seamless left and right edges, horizon in lower third, ` +
    'large clean sky area suitable for conversion to an equirectangular dome, no characters, no text, ' +
    'no logo, no watermark, crisp stylized game art',
}));

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
function atomicWrite(url, data) {
  const temp = new URL(`${url.pathname}.tmp-${process.pid}`, url);
  writeFileSync(temp, data);
  renameSync(temp, url);
}

async function generate(job, directory) {
  const response = await fetch(`${baseUrl}/v1/api/nano-banana`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'nano-banana-pro',
      prompt: job.prompt,
      images: [],
      aspectRatio: job.aspectRatio,
      imageSize: job.imageSize,
      optimizeChineseText: false,
      replyType: 'json',
    }),
  });
  if (!response.ok) throw new Error(`Generation request failed: HTTP ${response.status}`);
  const data = await response.json();
  const imageUrl = data.results?.[0]?.url;
  if (data.status !== 'succeeded' || !imageUrl) {
    throw new Error(`Generation failed: ${JSON.stringify(data).slice(0, 300)}`);
  }
  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) throw new Error(`Generated image download failed: HTTP ${imageResponse.status}`);
  const buffer = Buffer.from(await imageResponse.arrayBuffer());
  if (buffer.length < 1024) throw new Error('Generated image is unexpectedly small');
  atomicWrite(new URL(job.file, directory), buffer);
  return {
    file: job.file,
    bytes: buffer.length,
    sha256: sha256(buffer),
    promptSha256: sha256(Buffer.from(job.prompt)),
    model: 'nano-banana-pro',
    provider: baseUrl,
    requestId: data.id ?? data.requestId ?? null,
    generatedAt: new Date().toISOString(),
  };
}

async function runJobs(jobs, directory, manifestName) {
  mkdirSync(directory, { recursive: true });
  const records = [];
  for (const job of jobs) {
    const output = new URL(job.file, directory);
    if (existsSync(output) && !force) {
      const buffer = readFileSync(output);
      records.push({
        file: job.file,
        bytes: buffer.length,
        sha256: sha256(buffer),
        promptSha256: sha256(Buffer.from(job.prompt)),
        model: null,
        provider: null,
        requestId: null,
        generatedAt: null,
        source: 'pre-existing; generation provenance unavailable',
      });
      console.log(`skip ${job.file} (use --force to replace)`);
      continue;
    }
    console.log(`generate ${job.file}`);
    records.push(await generate(job, directory));
  }
  const manifest = {
    schema: 1,
    kind: 'ghostfire-image-generation-provenance',
    records,
  };
  atomicWrite(new URL(manifestName, directory), `${JSON.stringify(manifest, null, 2)}\n`);
}

if (mode === 'base' || mode === 'all') await runJobs(BASE_JOBS, ASSETS, 'skybox-provenance.json');
if (mode === 'candidates' || mode === 'all') {
  await runJobs(CANDIDATE_JOBS, CANDIDATES, 'provenance.json');
  console.log('Review candidates, then promote one with tools/promote_skybox.mjs.');
}
