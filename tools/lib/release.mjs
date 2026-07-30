import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

function git(root, args) {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : '';
}

export function releaseContext(rootDirectory) {
  const root = resolve(rootDirectory);
  const packageData = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const commit = git(root, ['rev-parse', '--verify', 'HEAD']) || 'unknown';
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=normal']);
  const fromEnvironment = Number(process.env.SOURCE_DATE_EPOCH);
  const fromGit = Number(git(root, ['show', '-s', '--format=%ct', 'HEAD']));
  const sourceDateEpoch = Number.isSafeInteger(fromEnvironment) && fromEnvironment >= 0
    ? fromEnvironment
    : Number.isSafeInteger(fromGit) && fromGit >= 0 ? fromGit : 0;
  return {
    version: packageData.version,
    commit,
    dirty: Boolean(status),
    dirtyStatus: status,
    sourceDateEpoch,
  };
}
