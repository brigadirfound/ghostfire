import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [];
function walk(directory) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path);
    else if (['.js', '.mjs'].includes(extname(entry.name))) files.push(path);
  }
}
for (const directory of ['js', 'tools', 'tests']) {
  try { walk(directory); } catch (error) {
    if (directory !== 'tests') throw error;
  }
}

let failures = 0;
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { cwd: root, encoding: 'utf8' });
  if (result.status !== 0) {
    failures++;
    process.stderr.write(result.stderr || result.stdout || `${file}: syntax check failed\n`);
  }
}
if (failures) throw new Error(`${failures} JavaScript syntax check(s) failed`);
console.log(`Syntax OK: ${files.length} JavaScript files`);
