import './helpers/hermetic.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, realpath, rm, symlink, stat, readdir, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { staleWorktrees } from '../lib/worktree-hygiene.mjs';

const DAY = 86_400_000;
async function fixture(t) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'acme-worktrees-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, 'Acme');
  await mkdir(root);
  const env = { ...process.env, CI: '', GITHUB_ACTIONS: '', GITLAB_CI: '', TF_BUILD: '', BUILDKITE: '',
    GIT_AUTHOR_DATE: '2020-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2020-01-01T00:00:00Z' };
  delete env.PLATES_GIT;
  const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(root, 'init', '-b', 'main');
  await writeFile(join(root, 'source.txt'), 'Acme\n');
  await writeFile(join(root, '.gitignore'), 'ignored/\n');
  git(root, 'add', '.'); git(root, 'commit', '-m', 'Acme initial');
  async function tree(name, unmerged = false) {
    const path = join(parent, name);
    git(root, 'worktree', 'add', '-b', `acme-${name.replace(/[^a-z0-9]/gi, '-')}`, path);
    if (unmerged) {
      await writeFile(join(path, 'feature.txt'), 'Acme feature\n');
      git(path, 'add', '.'); git(path, 'commit', '-m', 'Acme unmerged');
    }
    return path;
  }
  return { root, parent, env, git, tree };
}
const record = (result, path) => result.facts.worktrees.find(item => item.path === path);

test('merged reachability and owner-only commands are separate from inactivity; current and primary protected', async t => {
  const f = await fixture(t);
  const merged = await f.tree("merged ' $(echo unsafe)\nAcme", true);
  f.git(f.root, 'merge', '--ff-only', f.git(merged, 'rev-parse', 'HEAD'));
  await writeFile(join(f.root, 'later.txt'), 'Acme later main commit\n');
  f.git(f.root, 'add', '.'); f.git(f.root, 'commit', '-m', 'Acme main advances');
  const current = await f.tree('current');
  await writeFile(join(current, 'current-only.txt'), 'Acme current work\n');
  f.git(current, 'add', '.'); f.git(current, 'commit', '-m', 'Acme current unmerged');
  const before = f.git(f.root, 'worktree', 'list', '--porcelain');
  const result = await staleWorktrees({ root: current, env: f.env });
  assert.equal(result.value, 1);
  assert.equal(result.facts.mainRef, 'refs/heads/main');
  assert.deepEqual(record(result, merged).reasons, ['merged-into-main']);
  assert.equal(record(result, merged).merged, true);
  assert.notEqual(record(result, merged).head, result.facts.mainCommit);
  assert.match(record(result, merged).command, /'\\''/);
  assert.equal(record(result, merged).command, `git -C '${current}' worktree remove -- '${merged.replaceAll("'", "'\\''")}'`);
  const words = execFileSync('/bin/sh', ['-c', `printf '%s\\0' ${record(result, merged).command}`], { env: f.env, encoding: 'utf8' }).split('\0').slice(0, -1);
  assert.deepEqual(words, ['git', '-C', current, 'worktree', 'remove', '--', merged]);
  assert.equal(record(result, f.root).command, null);
  assert.ok(record(result, f.root).protectedReasons.includes('primary'));
  assert.ok(record(result, current).protectedReasons.includes('current'));
  assert.equal(record(result, current).merged, false);
  assert.equal(f.git(f.root, 'worktree', 'list', '--porcelain'), before);
});

test('old HEAD with recent ignored filesystem activity is not inactive; logical size includes ignored bytes', async t => {
  const f = await fixture(t);
  const path = await f.tree('recent', true);
  await mkdir(join(path, 'ignored'));
  await writeFile(join(path, 'ignored', 'data'), Buffer.alloc(12345));
  const result = await staleWorktrees({ root: f.root, env: f.env });
  const item = record(result, path);
  assert.equal(result.value, 0);
  assert.equal(item.merged, false);
  assert.equal(item.stale, false);
  assert.equal(item.dirty, false);
  assert.equal(item.logicalBytes, Buffer.byteLength('Acme\nignored/\nAcme feature\n') + 12345);
  assert.ok(Date.now() - Date.parse(item.lastActivityAt) < DAY);
  assert.equal(item.command, null);
});

test('inactive unmerged trees use configured activity age; locked and dirty trees never get commands', async t => {
  const f = await fixture(t);
  const old = await f.tree('inactive', true);
  const dirty = await f.tree('dirty');
  const locked = await f.tree('locked');
  await writeFile(join(dirty, 'untracked'), 'Acme unsaved');
  f.git(f.root, 'worktree', 'lock', locked);
  const now = Date.now() + 8 * DAY;
  const result = await staleWorktrees({ root: f.root, env: f.env, now });
  assert.equal(result.value, 1);
  assert.deepEqual(record(result, old).reasons, ['inactive']);
  assert.equal(record(result, old).merged, false);
  assert.ok(record(result, old).command);
  for (const [path, reason] of [[dirty, 'dirty'], [locked, 'locked']]) {
    assert.ok(record(result, path).protectedReasons.includes(reason));
    assert.equal(record(result, path).command, null);
  }
  const longer = await staleWorktrees({ root: f.root, env: f.env, now, staleDays: 9 });
  assert.equal(record(longer, old).stale, false);
});

test('external symlinks are not followed for size or activity', async t => {
  const f = await fixture(t);
  const path = await f.tree('links', true);
  const outside = join(f.parent, 'outside');
  await mkdir(outside);
  const external = join(outside, 'large');
  await writeFile(external, Buffer.alloc(200_000));
  const future = new Date(Date.now() + 100 * DAY);
  await utimes(external, future, future);
  await mkdir(join(path, 'ignored'));
  await symlink(outside, join(path, 'ignored', 'outside'));
  const result = await staleWorktrees({ root: f.root, env: f.env, now: Date.now() + 8 * DAY });
  const item = record(result, path);
  assert.equal(item.logicalBytes, Buffer.byteLength('Acme\nignored/\nAcme feature\n'));
  assert.deepEqual(item.reasons, ['inactive']);
  assert.ok(item.command);
});

test('entry, output, count and deadline bounds preserve unknown rather than zero', async t => {
  const f = await fixture(t);
  const path = await f.tree('bounded');
  for (const limits of [{ maxEntries: 1 }, { maxOutputBytes: 1 }, { maxWorktrees: 1 }, { maxMs: 1 }]) {
    const result = await staleWorktrees({ root: f.root, env: f.env, limits });
    assert.ok(result.na, JSON.stringify(limits));
    assert.equal(result.value, undefined);
    assert.equal(result.facts.complete, false);
    assert.ok(result.facts.gaps.length);
    for (const item of result.facts.worktrees.filter(item => !item.complete)) {
      assert.equal(item.command, null);
      assert.equal(item.logicalBytes, null);
    }
  }
  assert.ok(await stat(path));
});

test('unavailable main and missing trees are unknown and never removal recommendations', async t => {
  const f = await fixture(t);
  const path = await f.tree('missing', true);
  f.git(f.root, 'branch', '-m', 'main', 'trunk');
  const noMain = await staleWorktrees({ root: f.root, env: f.env, now: Date.now() + 8 * DAY });
  assert.ok(noMain.na);
  assert.equal(record(noMain, path).merged, null);
  assert.equal(record(noMain, path).command, null);
  f.git(f.root, 'branch', '-m', 'trunk', 'main');
  await rm(path, { recursive: true });
  const missing = await staleWorktrees({ root: f.root, env: f.env });
  assert.ok(missing.na);
  assert.equal(record(missing, path).logicalBytes, null);
  assert.equal(record(missing, path).command, null);
});

test('a registered directory replaced by an external symlink is protected', async t => {
  const f = await fixture(t);
  const path = await f.tree('replaced');
  const outside = join(f.parent, 'external');
  await mkdir(outside);
  await writeFile(join(outside, 'private'), 'Acme external');
  await rm(path, { recursive: true });
  await symlink(outside, path);
  const result = await staleWorktrees({ root: f.root, env: f.env });
  assert.ok(result.na);
  assert.equal(record(result, path).logicalBytes, null);
  assert.equal(record(result, path).command, null);
  assert.deepEqual(await readdir(outside), ['private']);
});

test('CI and invalid inputs do not touch Git', async () => {
  for (const env of [{ CI: 'true' }, { GITHUB_ACTIONS: 'true' }]) {
    const result = await staleWorktrees({ root: '/does-not-exist', env: { ...env, PLATES_GIT: '/not-a-command' } });
    assert.match(result.na, /CI/);
    assert.equal(result.value, undefined);
    assert.deepEqual(result.facts.worktrees, []);
  }
  for (const staleDays of [0, -1, Infinity, NaN]) {
    assert.match((await staleWorktrees({ root: '/does-not-exist', env: {}, staleDays })).na, /invalid/);
  }
});
