// Synthetic Acme consumers; behavioral assertions adapted from dalmaer/plates
// tests/rename.test.mjs at fa7477f2, 85316dac and 998b297d (Apache-2.0).
import { execFileSync } from 'node:child_process';
import { mkdtemp, realpath, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const put = async (root, path, bytes) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), bytes); };
export const get = (root, path) => readFile(join(root, path), 'utf8');
export function command(root, executable, args, extra = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('NODE_TEST_') && !key.startsWith('GIT_') && !key.startsWith('npm_config_')));
  Object.assign(env, { HOME: root, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 'Acme', GIT_AUTHOR_EMAIL: 'acme@example.test', GIT_COMMITTER_NAME: 'Acme', GIT_COMMITTER_EMAIL: 'acme@example.test', GIT_CONFIG_COUNT: '3', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false', GIT_CONFIG_KEY_1: 'commit.gpgsign', GIT_CONFIG_VALUE_1: 'false', GIT_CONFIG_KEY_2: 'core.hooksPath', GIT_CONFIG_VALUE_2: '/dev/null', npm_config_cache: join(root, '.npm-cache'), ...extra });
  return execFileSync(executable, args, { cwd: root, env, encoding: 'utf8', timeout: 15000, maxBuffer: 512 * 1024 });
}
export const git = (root, ...args) => command(root, 'git', args);
export async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'acme-corpus-')));
  const managed = '// Keel care\nexport const acme = true;\n';
  await put(root, '.keel/keel.json', JSON.stringify({ name: 'Acme', repo: 'Acme/widget', keel: 'github:dalmaer/keel', practice: '1.0.0', practices: [], check: 'node managed.mjs' }));
  await put(root, 'managed.mjs', managed);
  await put(root, '.keel/lock.json', JSON.stringify({ practice: '1.0.0', files: { 'managed.mjs': { practice: 'night', sha256: hash(managed) } } }));
  git(root, 'init', '-q');
  return root;
}
export const commit = root => { git(root, 'add', '.'); git(root, 'commit', '-qm', 'Acme fixture'); };
export const cleanup = root => rm(root, { recursive: true, force: true });
