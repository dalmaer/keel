// A tiny Acme repository with a bug, its fix and a test, for keel prove
// (phase 62): tests/prove.test.mjs, and tests/cli.test.mjs's --json run.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from './run.mjs';

export const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Acme', GIT_AUTHOR_EMAIL: 'acme@acme.test', GIT_COMMITTER_NAME: 'Acme', GIT_COMMITTER_EMAIL: 'acme@acme.test' };

export function git(dir, args) {
  const r = run('git', args, { cwd: dir, env: ENV });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}

export const BUGGY = 'export const add = (a, b) => a - b;\n';
export const FIXED = 'export const add = (a, b) => a + b;\n';
// The test needs its preload (package.json's --import): without it, it fails with or without the fix.
export const TEST = [
  "import { test } from 'node:test';",
  "import assert from 'node:assert/strict';",
  "import { add } from '../lib/add.mjs';",
  "test('adds two anvils', () => { assert.equal(globalThis.acmePreloaded, true, 'the preload ran'); assert.equal(add(1, 2), 3); });",
  "test('zero anvils', () => { assert.equal(add(0, 0), 0); });", ''].join('\n');

/**
 * dir as a git repo: lib/add.mjs committed with its bug, then the fix and its
 * test written but not committed. package.json's test script preloads
 * tests/setup.mjs.
 */
export async function acmeRepo(dir) {
  await mkdir(join(dir, 'lib'), { recursive: true });
  await mkdir(join(dir, 'tests'), { recursive: true });
  await writeFile(join(dir, 'package.json'), `${JSON.stringify({ name: 'acme', type: 'module', scripts: { test: 'node --import ./tests/setup.mjs --test --test-reporter=spec tests/*.test.mjs' } }, null, 2)}\n`);
  await writeFile(join(dir, 'tests', 'setup.mjs'), 'globalThis.acmePreloaded = true;\n');
  await writeFile(join(dir, 'lib', 'add.mjs'), BUGGY);
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'acme: add anvils']);
  await writeFile(join(dir, 'lib', 'add.mjs'), FIXED);
  await writeFile(join(dir, 'tests', 'add.test.mjs'), TEST);
  return dir;
}

/** Every path in dir but .git, with its bytes (or link target), and git's own view: status, worktrees, stashes. */
export async function treeState(dir) {
  const files = {};
  const walk = async d => {
    for (const e of await readdir(d, { withFileTypes: true })) {
      if (e.name === '.git' && d === dir) continue;
      const p = join(d, e.name), rel = p.slice(dir.length + 1);
      if (e.isDirectory()) { files[`${rel}/`] = 'dir'; await walk(p); }
      else if (e.isSymbolicLink()) files[rel] = `link ${(await lstat(p)).size}`;
      else files[rel] = (await readFile(p)).toString('base64');
    }
  };
  await walk(dir);
  return {
    files,
    status: git(dir, ['status', '--porcelain', '--untracked-files=all']),
    worktrees: git(dir, ['worktree', 'list', '--porcelain']),
    stash: git(dir, ['stash', 'list']),
    head: git(dir, ['rev-parse', 'HEAD']),
  };
}
