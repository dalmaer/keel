// keel release: a practice version is package.json's version, tagged
// v<version>, with a WHATSNEW entry written for the person receiving it.
// Run against a synthetic keel-shaped repo ("keel": "self"), never keel's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { run } from './helpers/run.mjs';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { release, entries, between, prepend, WHATSNEW_HEADER } from '../lib/release.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Acme Builder', GIT_AUTHOR_EMAIL: 'builder@acme.test',
  GIT_COMMITTER_NAME: 'Acme Builder', GIT_COMMITTER_EMAIL: 'builder@acme.test',
  GIT_CONFIG_NOSYSTEM: '1',
};
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const NOTES = 'Acme projects get a conductor that names their gate.\n';

/** A keel-shaped repo on 0.0.0: package.json, .keel/keel.json ("keel": "self"), a lock, WHATSNEW.md. */
async function keelLike(t, { self = true } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-release-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.keel'));
  await writeFile(join(dir, 'package.json'), '{\n  "name": "keel",\n  "version": "0.0.0",\n  "type": "module"\n}\n');
  await writeFile(join(dir, '.keel/keel.json'), `{\n  "name": "Acme Keel",\n  ${self ? '"keel": "self",\n  ' : ''}"practice": "0.0.0",\n  "practices": ["base", "phases"]\n}\n`);
  await writeFile(join(dir, '.keel/lock.json'), '{\n  "practice": "0.0.0",\n  "files": {}\n}\n');
  await writeFile(join(dir, 'WHATSNEW.md'), WHATSNEW_HEADER);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'acme keel');
  return dir;
}
const attempt = p => p.then(r => ({ ...r, exitCode: r.exitCode ?? 0 }), error => ({ error, exitCode: error.exitCode ?? 1, text: error.message }));
const files = async dir => Promise.all(['package.json', '.keel/keel.json', '.keel/lock.json', 'WHATSNEW.md'].map(f => readFile(join(dir, f), 'utf8')));

test('release refuses outside keel, a version that does not increase, and empty notes', async t => {
  const project = await keelLike(t, { self: false });
  let r = await attempt(release({ root: project, version: '0.1.0', notes: NOTES }));
  assert.equal(r.exitCode, 2);
  assert.match(r.text, /runs only in keel itself/);

  const dir = await keelLike(t);
  const before = await files(dir);
  for (const [version, notes, why] of [['0.0.0', NOTES, /must be newer than the current version 0\.0\.0/], ['banana', NOTES, /not a version/],
    ['0.1.0', '  \n', /--notes is required/], ['0.1.0', undefined, /--notes is required/]]) {
    r = await attempt(release({ root: dir, version, notes }, { env: ENV }));
    assert.equal(r.exitCode, 2, version);
    assert.match(r.text, why);
  }
  await writeFile(join(dir, 'scratch.txt'), 'x\n');
  r = await attempt(release({ root: dir, version: '0.1.0', notes: NOTES }, { env: ENV }));
  assert.equal(r.exitCode, 2);
  assert.match(r.text, /working tree is not clean/);
  await rm(join(dir, 'scratch.txt'));
  assert.deepEqual(await files(dir), before);
});

test('a dry run shows the entry and writes nothing', async t => {
  const dir = await keelLike(t);
  const before = await files(dir);
  const r = await release({ root: dir, version: 'v0.1.0', notes: NOTES, dryRun: true }, { env: ENV, date: '2026-10-02' });
  assert.equal(r.data.dryRun, true);
  assert.equal(r.data.entry.heading, '## v0.1.0 — 2026-10-02');
  assert.equal(r.data.entry.body, NOTES.trim());
  assert.match(r.text, /git push origin main v0\.1\.0/);
  assert.deepEqual(await files(dir), before);
  assert.equal(git(dir, 'tag', '--list'), '');
});

test('release bumps the version, prepends the entry, commits and tags locally, and never pushes', async t => {
  const dir = await keelLike(t);
  const origin = join(dir, '..', `${dir.split('/').pop()}-origin.git`);
  execFileSync('git', ['init', '-q', '--bare', origin], { env: ENV });
  t.after(() => rm(origin, { recursive: true, force: true }));
  git(dir, 'remote', 'add', 'origin', origin);

  const r = await release({ root: dir, version: '0.1.0', notes: NOTES }, { env: ENV, date: '2026-10-02' });
  assert.match(r.text, /Nothing was pushed/);
  assert.equal(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version, '0.1.0');
  assert.equal(JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8')).practice, '0.1.0');
  assert.match(await readFile(join(dir, '.keel/keel.json'), 'utf8'), /"practices": \["base", "phases"\]/, 'keel.json keeps its own formatting');
  assert.equal(JSON.parse(await readFile(join(dir, '.keel/lock.json'), 'utf8')).practice, '0.1.0');
  assert.equal(git(dir, 'log', '-1', '--format=%s'), 'release v0.1.0');
  assert.equal(git(dir, 'rev-parse', 'v0.1.0^{commit}'), git(dir, 'rev-parse', 'HEAD'));
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.equal(git(origin, 'tag', '--list'), '', 'nothing reached the remote');

  // A second release goes above the first; update's PR takes the ones between.
  await release({ root: dir, version: '0.2.0', notes: 'Acme gets migrations.' }, { env: ENV, date: '2026-10-09' });
  const text = await readFile(join(dir, 'WHATSNEW.md'), 'utf8');
  assert.ok(text.startsWith(WHATSNEW_HEADER));
  assert.deepEqual(entries(text).map(e => e.version), ['0.2.0', '0.1.0']);
  assert.deepEqual(between(text, '0.1.0', '0.2.0').map(e => e.body), ['Acme gets migrations.']);
  assert.deepEqual(between(text, '0.0.0', '0.2.0').map(e => e.version), ['0.2.0', '0.1.0']);
  const again = await attempt(release({ root: dir, version: '0.2.0', notes: NOTES }, { env: ENV }));
  assert.equal(again.exitCode, 2);
});

test('the CLI: notes from stdin, --json, and bare release reports the version', async t => {
  const dir = await keelLike(t);
  const cli = (args, input) => run(process.execPath, [BIN, ...args], { cwd: dir, env: ENV, input });
  const bare = cli(['release', '--json']);
  assert.equal(bare.status, 0, bare.stderr);
  assert.deepEqual(JSON.parse(bare.stdout), { version: '0.0.0', tag: 'v0.0.0', tagged: false, newest: null });
  const none = cli(['release', '0.1.0', '--json']);
  assert.equal(none.status, 2);
  assert.match(JSON.parse(none.stdout).error, /--notes is required/);
  const r = cli(['release', '0.1.0', '--notes', '-', '--json'], NOTES);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(JSON.parse(r.stdout).tag, 'v0.1.0');
  assert.equal(git(dir, 'tag', '--list'), 'v0.1.0');
});

test('prepend puts a new entry above the newest and keeps the header', () => {
  const one = prepend(null, '0.1.0', 'First.', '2026-10-02');
  assert.equal(one, `${WHATSNEW_HEADER}\n## v0.1.0 — 2026-10-02\n\nFirst.\n`);
  const two = prepend(one, '0.2.0', 'Second.', '2026-10-09');
  assert.deepEqual(entries(two).map(e => [e.version, e.body]), [['0.2.0', 'Second.'], ['0.1.0', 'First.']]);
});
