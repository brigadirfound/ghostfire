import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from '../js/replay.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const jsonFiles = [];
const gltfFiles = [];
function walk(directory) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === '.release' || entry.name === 'node_modules') continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (extname(entry.name) === '.json') jsonFiles.push(path);
    else if (extname(entry.name) === '.gltf') gltfFiles.push(path);
  }
}
for (const directory of ['maps', 'skins', 'ghosts', 'assets']) walk(directory);
for (const file of ['package.json', 'release-metadata.json']) if (existsSync(join(root, file))) jsonFiles.push(file);

const parsed = new Map();
let failures = 0;
const fail = (file, message) => {
  failures++;
  console.error(`FAIL ${file}: ${message}`);
};

for (const file of [...jsonFiles, ...gltfFiles]) {
  try { parsed.set(normalize(file), JSON.parse(readFileSync(join(root, file), 'utf8'))); }
  catch (error) { fail(file, `invalid JSON (${error.message})`); }
}

const finiteTuple = (value, count) => Array.isArray(value) && value.length === count && value.every(Number.isFinite);
const mapIds = new Set();
for (const file of jsonFiles.filter((path) => normalize(path).startsWith(`maps${sep}`))) {
  const data = parsed.get(normalize(file));
  if (!data) continue;
  if (typeof data.id !== 'string' || !/^[a-z0-9_-]+$/i.test(data.id)) fail(file, 'invalid id');
  else mapIds.add(data.id);
  if (!data.palette || typeof data.palette !== 'object' || Array.isArray(data.palette)) fail(file, 'invalid palette');
  if (!Array.isArray(data.blocks) || !data.blocks.length || data.blocks.length > 50_000) fail(file, 'invalid block count');
  else {
    const seen = new Set();
    for (const block of data.blocks) {
      if (!finiteTuple(block, 4) || !block.every(Number.isInteger)) { fail(file, 'invalid block tuple'); break; }
      const key = block.slice(0, 3).join('|');
      if (seen.has(key)) { fail(file, `duplicate block ${key}`); break; }
      seen.add(key);
      if (!data.palette?.[block[3]]) { fail(file, `block uses missing palette type ${block[3]}`); break; }
    }
  }
  if (!Array.isArray(data.spawns) || data.spawns.length !== 2 || !data.spawns.every((spawn) => finiteTuple(spawn, 4))) {
    fail(file, 'expected two finite spawns');
  }
  if (!Array.isArray(data.weapons) || !data.weapons.length || data.weapons.some((weapon) =>
    !Number.isInteger(weapon?.type) || weapon.type < 1 || weapon.type > 5 || !finiteTuple(weapon.pos, 3))) {
    fail(file, 'invalid weapon points');
  }
  if (data.skybox !== undefined) {
    if (typeof data.skybox !== 'string' || data.skybox.includes('..') || !existsSync(join(root, data.skybox))) {
      fail(file, `missing or unsafe skybox ${data.skybox}`);
    }
  }
}

for (const file of jsonFiles.filter((path) => normalize(path).startsWith(`ghosts${sep}`))) {
  const data = parsed.get(normalize(file));
  if (!data) continue;
  if (data.v !== 1 || typeof data.map !== 'string' || typeof data.name !== 'string' || typeof data.data !== 'string') {
    fail(file, 'invalid ghost wrapper');
    continue;
  }
  if (!mapIds.has(data.map)) fail(file, `unknown map ${data.map}`);
  try {
    const replay = decode(data.data);
    if (!replay.frames.length) fail(file, 'empty replay');
  } catch (error) { fail(file, `invalid replay (${error.message})`); }
  if (data.generator !== undefined && (typeof data.generator?.id !== 'string' || typeof data.generator?.seed !== 'string')) {
    fail(file, 'invalid generator metadata');
  }
}

function checkUri(file, uri) {
  if (typeof uri !== 'string' || uri.startsWith('data:')) return;
  if (/^[a-z][a-z0-9+.-]*:/i.test(uri) || uri.startsWith('/') || uri.includes('..')) {
    fail(file, `unsafe external URI ${uri}`);
    return;
  }
  const target = resolve(root, dirname(file), decodeURIComponent(uri));
  const fromRoot = relative(root, target);
  if (fromRoot.startsWith('..')) fail(file, `URI escapes repository ${uri}`);
  else if (!existsSync(target)) fail(file, `missing URI ${uri}`);
}
for (const file of gltfFiles) {
  const data = parsed.get(normalize(file));
  if (!data) continue;
  if (data.asset?.version !== '2.0') fail(file, 'asset.version must be 2.0');
  for (const buffer of data.buffers ?? []) checkUri(file, buffer.uri);
  for (const image of data.images ?? []) checkUri(file, image.uri);
  for (const accessor of data.accessors ?? []) {
    if (accessor.bufferView !== undefined && !data.bufferViews?.[accessor.bufferView]) fail(file, 'accessor references missing bufferView');
  }
}

if (failures) throw new Error(`${failures} data validation error(s)`);
console.log(`Data OK: ${jsonFiles.length} JSON and ${gltfFiles.length} glTF files`);
