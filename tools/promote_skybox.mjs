// Promote a reviewed candidate atomically and optionally assign it to a map.
// node tools/promote_skybox.mjs --candidate=candidate_3.jpg --target=skybox_arena03.jpg --map=arena03
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const ROOT = new URL('../', import.meta.url);
const CANDIDATES = new URL('../assets/skybox_candidates/', import.meta.url);
const ASSETS = new URL('../assets/', import.meta.url);
const valueOf = (name) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const candidate = valueOf('candidate');
const target = valueOf('target') ?? 'skybox.jpg';
const mapId = valueOf('map');

if (!candidate || basename(candidate) !== candidate || !/^candidate_[1-9][0-9]*\.(?:jpe?g|png|webp)$/i.test(candidate)) {
  throw new Error('Pass a candidate filename such as --candidate=candidate_3.jpg');
}
if (basename(target) !== target || !/^skybox(?:_[a-z0-9_-]+)?\.(?:jpe?g|png|webp)$/i.test(target)) {
  throw new Error('Target must be skybox.jpg or skybox_<name>.<jpg|png|webp>');
}
if (mapId && !/^[a-z0-9_-]+$/i.test(mapId)) throw new Error('Invalid map id');

const source = new URL(candidate, CANDIDATES);
if (!existsSync(source)) throw new Error(`Candidate not found: ${candidate}`);
const buffer = readFileSync(source);
const digest = createHash('sha256').update(buffer).digest('hex');

function atomicWrite(url, data) {
  const temp = new URL(`${url.pathname}.tmp-${process.pid}`, url);
  writeFileSync(temp, data);
  renameSync(temp, url);
}

atomicWrite(new URL(target, ASSETS), buffer);
if (mapId) {
  const mapUrl = new URL(`maps/${mapId}.json`, ROOT);
  if (!existsSync(mapUrl)) throw new Error(`Map not found: ${mapId}`);
  const map = JSON.parse(readFileSync(mapUrl, 'utf8'));
  map.skybox = `assets/${target}`;
  atomicWrite(mapUrl, `${JSON.stringify(map)}\n`);
}

const recordUrl = new URL('skybox-selection.json', ASSETS);
let history = [];
if (existsSync(recordUrl)) {
  try { history = JSON.parse(readFileSync(recordUrl, 'utf8')).history ?? []; } catch { history = []; }
}
history.push({ candidate, target, map: mapId ?? null, sha256: digest, selectedAt: new Date().toISOString() });
atomicWrite(recordUrl, `${JSON.stringify({ schema: 1, history }, null, 2)}\n`);
console.log(`Promoted ${candidate} -> assets/${target}${mapId ? ` and maps/${mapId}.json` : ''}`);
