// Stages exactly the same runtime whitelist used by pack_release.mjs.
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRuntimeFiles, copyRuntimeFiles, createRuntimeManifest } from './lib/runtime.mjs';
import { releaseContext } from './lib/release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const outputArg = args.find((arg) => !arg.startsWith('--')) ?? '.release/site';
const output = resolve(root, outputArg);
const files = collectRuntimeFiles(root);
const context = releaseContext(root);
const manifest = createRuntimeManifest(root, context);

if (checkOnly) {
  console.log(`Runtime whitelist: ${files.length} files, version ${context.version}`);
  process.exit(0);
}

const temp = `${output}.tmp-${process.pid}`;
const backup = `${output}.backup-${process.pid}`;
rmSync(temp, { recursive: true, force: true });
rmSync(backup, { recursive: true, force: true });
mkdirSync(temp, { recursive: true });
copyRuntimeFiles(root, temp, files);
writeFileSync(join(temp, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
const timestamp = new Date(context.sourceDateEpoch * 1000);
for (const file of [...files, 'release-manifest.json']) {
  try { utimesSync(join(temp, file), timestamp, timestamp); } catch { /* timestamps are best-effort for Pages */ }
}

try {
  if (existsSync(output)) renameSync(output, backup);
  mkdirSync(dirname(output), { recursive: true });
  renameSync(temp, output);
  rmSync(backup, { recursive: true, force: true });
} catch (error) {
  if (!existsSync(output) && existsSync(backup)) renameSync(backup, output);
  rmSync(temp, { recursive: true, force: true });
  throw error;
}
console.log(`Staged ${files.length + 1} files at ${output}`);
