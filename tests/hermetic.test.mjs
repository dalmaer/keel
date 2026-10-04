// The guard on tests/helpers/hermetic.mjs: inside the suite, git reads none of
// the developer's own config — in this process and in every child it spawns.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './helpers/run.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// What git sees: the global config, the fsmonitor and gpgsign settings, the branch new repos get, and who commits.
const PROBE = `
const { execFileSync } = require('node:child_process');
const git = (...a) => { try { return execFileSync('git', a, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return ''; } };
console.log(JSON.stringify({
  global: git('config', '--global', '--list'),
  fsmonitor: git('config', '--get', 'core.fsmonitor'),
  gpgsign: git('config', '--get', 'commit.gpgsign'),
  branch: git('config', '--get', 'init.defaultBranch'),
  ident: git('var', 'GIT_AUTHOR_IDENT').replace(/>.*/, '>'),
}));`;
const EXPECTED = { global: '', fsmonitor: 'false', gpgsign: 'false', branch: 'main', ident: 'Acme Builder <builder@acme.test>' };

test('npm test loads the hermetic bootstrap before every test file', async () => {
  const { scripts } = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.match(scripts.test, /^node --import \.\/tests\/helpers\/hermetic\.mjs --test /);
});

test('inside the suite, git reads no global config and pins fsmonitor off', () => {
  assert.equal(execFileSync('git', ['config', '--global', '--list'], { encoding: 'utf8' }), '');
  assert.equal(execFileSync('git', ['config', '--get', 'core.fsmonitor'], { encoding: 'utf8' }).trim(), 'false');
  assert.equal(process.env.GIT_CONFIG_NOSYSTEM, '1');
});

test('a spawned child sees the same git', () => {
  const r = run(process.execPath, ['-e', PROBE]);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout), EXPECTED);
});
