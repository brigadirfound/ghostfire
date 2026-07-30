// Deterministic release archive. Refuses dirty worktrees unless --allow-dirty is explicit.
import {
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRuntimeFiles, createRuntimeManifest, sha256 } from './lib/runtime.mjs';
import { releaseContext } from './lib/release.mjs';
import { createDeterministicZip } from './lib/zip.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const allowDirty = args.includes('--allow-dirty') || process.env.GHOSTFIRE_ALLOW_DIRTY === '1';
const outputValue = args.find((arg) => arg.startsWith('--output='))?.slice('--output='.length) ?? 'ghostfire_yandex.zip';
const output = resolve(root, outputValue);
const context = releaseContext(root);
if (context.dirty && !allowDirty) {
  throw new Error(`Refusing to package a dirty worktree. Commit/stash changes or pass --allow-dirty explicitly.\n${context.dirtyStatus}`);
}

const files = collectRuntimeFiles(root);
const manifest = createRuntimeManifest(root, context);
const manifestData = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
const entries = files.map((path) => ({ path, data: readFileSync(new URL(`../${path}`, import.meta.url)) }));
entries.push({ path: 'release-manifest.json', data: manifestData });
const archive = createDeterministicZip(entries, context.sourceDateEpoch);
const archiveHash = sha256(archive);

function durableTemp(path, data) {
  const descriptor = openSync(path, 'w');
  try {
    writeFileSync(descriptor, data);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function atomicReplace(path, data) {
  const temp = `${path}.tmp-${process.pid}`;
  const backup = `${path}.backup-${process.pid}`;
  rmSync(temp, { force: true });
  rmSync(backup, { force: true });
  durableTemp(temp, data);
  try {
    renameSync(temp, path);
    return;
  } catch (error) {
    // rename() is an atomic replacement on supported filesystems. A few
    // Windows/network filesystems reject replacing an existing destination;
    // retain the previous file and use a rollback-capable fallback there.
    if (!existsSync(path)) {
      rmSync(temp, { force: true });
      throw error;
    }
  }
  try {
    renameSync(path, backup);
    renameSync(temp, path);
    rmSync(backup, { force: true });
  } catch (error) {
    if (!existsSync(path) && existsSync(backup)) renameSync(backup, path);
    rmSync(temp, { force: true });
    throw error;
  }
}

atomicReplace(output, archive);
atomicReplace(`${output}.sha256`, `${archiveHash}  ${basename(output)}\n`);
atomicReplace(`${output}.manifest.json`, manifestData);
console.log(`Packed ${files.length + 1} files: ${output}`);
console.log(`SHA-256 ${archiveHash}`);
