import {
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const RUNTIME_ROOT_FILES = [
  'index.html',
  'editor.html',
  'LICENSE',
  'NOTICE.md',
  'release-metadata.json',
];
export const RUNTIME_DIRECTORIES = ['js', 'maps', 'skins', 'ghosts', 'vendor', 'assets'];

export const toPosix = (value) => value.split(sep).join('/');
export const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

export function isRuntimePath(relativePath) {
  const path = relativePath.replaceAll('\\', '/');
  if (!path || path.startsWith('/') || path.includes('/../') || path.startsWith('../')) return false;
  if (RUNTIME_ROOT_FILES.includes(path)) return true;
  return RUNTIME_DIRECTORIES.some((directory) => path.startsWith(`${directory}/`));
}

function walk(root, directory, files) {
  const absolute = join(root, directory);
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    const relativePath = toPosix(join(directory, entry.name));
    if (!isRuntimePath(relativePath)) continue;
    const path = join(root, relativePath);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`Runtime symlinks are not allowed: ${relativePath}`);
    if (entry.isDirectory()) walk(root, relativePath, files);
    else if (entry.isFile()) files.push(relativePath);
  }
}

export function collectRuntimeFiles(rootDirectory) {
  const root = resolve(rootDirectory);
  const files = [];
  for (const file of RUNTIME_ROOT_FILES) {
    const stat = lstatSync(join(root, file));
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Missing regular runtime file: ${file}`);
    files.push(file);
  }
  for (const directory of RUNTIME_DIRECTORIES) {
    const stat = lstatSync(join(root, directory));
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Missing runtime directory: ${directory}`);
    walk(root, directory, files);
  }
  return files.sort((a, b) => a.localeCompare(b, 'en'));
}

export function runtimeRecords(rootDirectory, files = collectRuntimeFiles(rootDirectory)) {
  const root = resolve(rootDirectory);
  return files.map((path) => {
    const data = readFileSync(join(root, path));
    return { path, bytes: data.length, sha256: sha256(data) };
  });
}

export function createRuntimeManifest(rootDirectory, metadata) {
  const records = runtimeRecords(rootDirectory);
  return {
    schema: 1,
    product: 'ghostfire',
    version: metadata.version,
    commit: metadata.commit,
    dirty: Boolean(metadata.dirty),
    sourceDateEpoch: metadata.sourceDateEpoch,
    createdAt: new Date(metadata.sourceDateEpoch * 1000).toISOString(),
    files: records,
  };
}

export function copyRuntimeFiles(rootDirectory, outputDirectory, files = collectRuntimeFiles(rootDirectory)) {
  const root = resolve(rootDirectory);
  const output = resolve(outputDirectory);
  const back = relative(root, output);
  if (!back) throw new Error('Runtime output cannot be the repository root');
  const relativeOutput = toPosix(back);
  if (RUNTIME_DIRECTORIES.some((directory) => relativeOutput === directory || relativeOutput.startsWith(`${directory}/`))) {
    throw new Error('Runtime output must not be inside a whitelisted source directory tree');
  }
  for (const path of files) {
    const target = join(output, path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, path), target);
  }
}
