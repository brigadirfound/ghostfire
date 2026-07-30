import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const checks = [
  'tools/check_syntax.mjs',
  'tools/check_data.mjs',
  'tools/check_validation.mjs',
  'tools/check_maps.mjs',
  'tools/check_pickups.mjs',
  'tools/check_replay.mjs',
  'tests/run.mjs',
  'tools/stage_runtime.mjs',
];
for (const check of checks) {
  const args = check === 'tools/stage_runtime.mjs' ? [check, '--check'] : [check];
  const result = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('All checks passed');
