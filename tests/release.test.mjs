// keel release: the CLI version is package.json's, tagged v<version>; the
// practice version is practices/VERSION and moves only when practices/ or
// migrations/ changed since the last practice release (phase 22). Each
// release gets a WHATSNEW entry saying which kind it was.
// Run against a synthetic keel-shaped repo ("keel": "self"), never keel's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { run } from './helpers/run.mjs';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { release, entries, between, prepend, practiceChange, WHATSNEW_HEADER } from '../lib/release.mjs';
import { practiceVersion } from '../lib/practices.mjs';

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

/** A keel-shaped repo on 0.0.0: package.json, practices/VERSION and a template, .keel/keel.json ("keel": "self", its gate `check`), a lock, WHATSNEW.md. */
async function keelLike(t, { self = true, check = 'node -e 0' } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-release-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.keel'));
  await writeFile(join(dir, 'package.json'), '{\n  "name": "keel",\n  "version": "0.0.0",\n  "type": "module"\n}\n');
  await writeFile(join(dir, '.keel/keel.json'), `{\n  "name": "Acme Keel",\n  ${self ? '"keel": "self",\n  ' : ''}"check": ${JSON.stringify(check)},\n  "practice": "0.0.0",\n  "practices": ["base", "phases"]\n}\n`);
  await writeFile(join(dir, '.keel/lock.json'), '{\n  "practice": "0.0.0",\n  "files": {}\n}\n');
  await writeFile(join(dir, 'WHATSNEW.md'), WHATSNEW_HEADER);
  await mkdir(join(dir, 'practices', 'base'), { recursive: true });
  await writeFile(join(dir, 'practices', 'VERSION'), '0.0.0\n');
  await writeFile(join(dir, 'practices', 'base', 'AGENTS.md'), '# Acme agents\n');
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'acme keel');
  return dir;
}
const attempt = p => p.then(r => ({ ...r, exitCode: r.exitCode ?? 0 }), error => ({ error, exitCode: error.exitCode ?? 1, text: error.message }));
const files = async dir => Promise.all(['package.json', 'practices/VERSION', '.keel/keel.json', '.keel/lock.json', 'WHATSNEW.md'].map(f => readFile(join(dir, f), 'utf8')));
const versions = async dir => ({
  cli: JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).version,
  practice: (await readFile(join(dir, 'practices/VERSION'), 'utf8')).trim(),
  config: JSON.parse(await readFile(join(dir, '.keel/keel.json'), 'utf8')).practice,
  lock: JSON.parse(await readFile(join(dir, '.keel/lock.json'), 'utf8')).practice,
});
/** Change a practice template and commit it: the next release is a practice release. */
async function changePractice(dir, line = 'Acme keeps a gate.') {
  const path = join(dir, 'practices', 'base', 'AGENTS.md');
  await writeFile(path, `${await readFile(path, 'utf8')}${line}\n`);
  git(dir, 'commit', '-qam', 'practice: base');
}

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
  assert.equal(r.data.entry.heading, '## v0.1.0 — keel only; practice unchanged at 0.0.0 (2026-10-02)');
  assert.deepEqual(r.data.files, ['WHATSNEW.md', 'package.json']);
  assert.match(r.text, /keel only; practice unchanged at 0\.0\.0/);
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

  await changePractice(dir);
  const r = await release({ root: dir, version: '0.1.0', notes: NOTES }, { env: ENV, date: '2026-10-02' });
  assert.match(r.text, /Nothing was pushed/);
  assert.deepEqual(await versions(dir), { cli: '0.1.0', practice: '0.1.0', config: '0.1.0', lock: '0.1.0' }, 'a practice release bumps both');
  assert.equal(r.data.entry.heading, '## v0.1.0 — practice 0.1.0 (2026-10-02)');
  assert.match(await readFile(join(dir, '.keel/keel.json'), 'utf8'), /"practices": \["base", "phases"\]/, 'keel.json keeps its own formatting');
  assert.equal(git(dir, 'log', '-1', '--format=%s'), 'release v0.1.0');
  assert.equal(git(dir, 'rev-parse', 'v0.1.0^{commit}'), git(dir, 'rev-parse', 'HEAD'));
  assert.equal(git(dir, 'status', '--porcelain'), '');
  assert.equal(git(origin, 'tag', '--list'), '', 'nothing reached the remote');

  // A second release goes above the first; update's PR takes the ones between.
  await changePractice(dir, 'Acme gets migrations.');
  await release({ root: dir, version: '0.2.0', notes: 'Acme gets migrations.' }, { env: ENV, date: '2026-10-09' });
  const text = await readFile(join(dir, 'WHATSNEW.md'), 'utf8');
  assert.ok(text.startsWith(WHATSNEW_HEADER));
  assert.deepEqual(entries(text).map(e => e.version), ['0.2.0', '0.1.0']);
  assert.deepEqual(between(text, '0.1.0', '0.2.0').map(e => e.body), ['Acme gets migrations.']);
  assert.deepEqual(between(text, '0.0.0', '0.2.0').map(e => e.version), ['0.2.0', '0.1.0']);
  const again = await attempt(release({ root: dir, version: '0.2.0', notes: NOTES }, { env: ENV }));
  assert.equal(again.exitCode, 2);
});

test('a release with no change under practices/ or migrations/ bumps only the CLI; a practice change bumps both', async t => {
  const dir = await keelLike(t);
  // Keel-side only: the practice and every project's "current" stay where they are.
  let r = await release({ root: dir, version: '0.1.0', notes: 'Acme fleet reads faster.' }, { env: ENV, date: '2026-10-04' });
  assert.deepEqual(await versions(dir), { cli: '0.1.0', practice: '0.0.0', config: '0.0.0', lock: '0.0.0' });
  assert.deepEqual(r.data.practice, { from: '0.0.0', to: '0.0.0', changed: false, since: git(dir, 'rev-list', '--max-parents=0', '--abbrev-commit', 'HEAD'), files: [] });
  assert.equal(r.data.entry.heading, '## v0.1.0 — keel only; practice unchanged at 0.0.0 (2026-10-04)');
  assert.deepEqual(git(dir, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['WHATSNEW.md', 'package.json']);
  assert.equal(git(dir, 'tag', '--list'), 'v0.1.0');
  // --practice has nothing to version when the practice did not change.
  r = await attempt(release({ root: dir, version: '0.2.0', notes: NOTES, practice: '0.2.0' }, { env: ENV }));
  assert.equal(r.exitCode, 2);
  assert.match(r.text, /nothing under practices\/, migrations\/ or docs\/lessons\.md changed since \w+, so the practice stays at 0\.0\.0/);

  // A migration counts as a practice change.
  await mkdir(join(dir, 'migrations'));
  await writeFile(join(dir, 'migrations', '0001-acme.mjs'), "export const id = '0001-acme';\n");
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'migration');
  r = await release({ root: dir, version: '0.2.0', notes: 'Acme renames a file.' }, { env: ENV, date: '2026-10-05' });
  assert.deepEqual(await versions(dir), { cli: '0.2.0', practice: '0.2.0', config: '0.2.0', lock: '0.2.0' });
  assert.deepEqual(r.data.practice.files, ['migrations/0001-acme.mjs']);

  // The next keel-only release compares against the release that last moved practices/VERSION.
  r = await release({ root: dir, version: '0.2.1', notes: 'Acme learn reads more.' }, { env: ENV, date: '2026-10-06' });
  assert.equal(r.data.practice.changed, false);
  assert.equal(r.data.practice.since, git(dir, 'rev-parse', '--short', 'v0.2.0^{commit}'));

  // A template change, with the practice numbered on its own.
  await changePractice(dir);
  r = await attempt(release({ root: dir, version: '0.3.0', notes: NOTES, practice: '0.1.9' }, { env: ENV }));
  assert.equal(r.exitCode, 2);
  assert.match(r.text, /must be newer than the current practice 0\.2\.0/);
  r = await release({ root: dir, version: '0.3.0', notes: 'Acme gets a sharper gate.', practice: '0.2.1' }, { env: ENV, date: '2026-10-07' });
  assert.deepEqual(await versions(dir), { cli: '0.3.0', practice: '0.2.1', config: '0.2.1', lock: '0.2.1' });
  assert.deepEqual(r.data.practice.files, ['practices/base/AGENTS.md']);

  // The lessons catalogue counts: every project's docs/keel-lessons.md is rendered from it (phase 30).
  await mkdir(join(dir, 'docs'), { recursive: true });
  await writeFile(join(dir, 'docs', 'lessons.md'), '# Lessons\n\n| # | The shape of it | What it cost | Guard | Where |\n| --- | --- | --- | --- | --- |\n| 1 | **Acme forgets.** | A day. | A test. | |\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'a lesson');
  r = await release({ root: dir, version: '0.4.0', notes: 'Acme learns a lesson.' }, { env: ENV, date: '2026-10-08' });
  assert.equal(r.data.practice.changed, true, 'a lessons-only release moves the practice');
  assert.deepEqual(r.data.practice.files, ['docs/lessons.md']);

  // update's PR carries practice entries between practice versions, never a keel-only one.
  const text = await readFile(join(dir, 'WHATSNEW.md'), 'utf8');
  assert.deepEqual(entries(text).map(e => [e.version, e.practice, e.keelOnly]),
    [['0.4.0', r.data.practice.to, false], ['0.3.0', '0.2.1', false], ['0.2.1', '0.2.0', true], ['0.2.0', '0.2.0', false], ['0.1.0', '0.0.0', true]]);
  assert.deepEqual(between(text, '0.0.0', '0.2.1').map(e => e.body), ['Acme gets a sharper gate.', 'Acme renames a file.']);
  assert.deepEqual(between(text, '0.2.0', '0.2.0'), [], 'a project on the practice gets nothing');
  // An entry written before the split names no practice: its version is its practice.
  assert.deepEqual(between('## v0.5.2 — 2026-10-03\n\nOld.\n', '0.5.1', '0.5.2').map(e => e.practice), ['0.5.2']);
});

test('a failing gate: every file back byte for byte, exit 1 naming the check, no commit, no tag', async t => {
  // The gate fails only on the bumped tree, so it is the release it judged.
  const gate = 'node -e "process.exit(require(\'./package.json\').version === \'0.0.0\' ? 0 : 7)"';
  const dir = await keelLike(t, { check: gate });
  await changePractice(dir); // a practice release, so the files it restores include practices/VERSION and the lock
  const raw = async () => Promise.all(['package.json', 'practices/VERSION', '.keel/keel.json', '.keel/lock.json', 'WHATSNEW.md'].map(f => readFile(join(dir, f))));
  const before = await raw(), head = git(dir, 'rev-parse', 'HEAD');
  const r = await attempt(release({ root: dir, version: '0.1.0', notes: NOTES }, { env: ENV, date: '2026-10-02' }));
  assert.equal(r.exitCode, 1, r.text);
  assert.ok(r.text.includes(`the gate failed on v0.1.0 (\`${gate}\`, exit 7)`), r.text);
  assert.deepEqual(r.error.check, { command: gate, ok: false, exit: 7 });
  assert.deepEqual(await raw(), before, 'every file it touched is back, byte for byte');
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head, 'no commit');
  assert.equal(git(dir, 'tag', '--list'), '', 'no tag');
  assert.equal(git(dir, 'status', '--porcelain'), '');
  // The CLI says the same and exits 1.
  const cli = run(process.execPath, [BIN, 'release', '0.1.0', '--notes', '-', '--json'], { cwd: dir, env: ENV, input: NOTES });
  assert.equal(cli.status, 1, cli.stderr);
  assert.match(JSON.parse(cli.stdout).error, /the gate failed on v0\.1\.0/);
  assert.equal(git(dir, 'tag', '--list'), '');
  assert.deepEqual(await raw(), before);
});

test('a passing gate runs on the bumped tree, then commits and tags', async t => {
  const gate = 'node -e "process.exit(require(\'./package.json\').version === \'0.1.0\' ? 0 : 7)"';
  const dir = await keelLike(t, { check: gate });
  const r = await release({ root: dir, version: '0.1.0', notes: NOTES }, { env: ENV, date: '2026-10-02' });
  assert.deepEqual(r.data.check, { command: gate, ok: true });
  assert.equal(git(dir, 'log', '-1', '--format=%s'), 'release v0.1.0');
  assert.equal(git(dir, 'tag', '--list'), 'v0.1.0');
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('the CLI: notes from stdin, --json, and bare release reports the version', async t => {
  const dir = await keelLike(t);
  const cli = (args, input) => run(process.execPath, [BIN, ...args], { cwd: dir, env: ENV, input });
  const bare = cli(['release', '--json']);
  assert.equal(bare.status, 0, bare.stderr);
  assert.deepEqual(JSON.parse(bare.stdout), { version: '0.0.0', practice: '0.0.0', tag: 'v0.0.0', tagged: false, newest: null });
  const dry = cli(['release', '0.1.0', '--notes', '-', '--dry-run'], NOTES);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /keel only; practice unchanged at 0\.0\.0/);
  const bad = cli(['release', '0.1.0', '--notes', '-', '--practice', '--json'], NOTES);
  assert.equal(bad.status, 2);
  assert.match(JSON.parse(bad.stdout).error, /--practice needs a version/);
  const none = cli(['release', '0.1.0', '--json']);
  assert.equal(none.status, 2);
  assert.match(JSON.parse(none.stdout).error, /--notes is required/);
  const r = cli(['release', '0.1.0', '--notes', '-', '--json'], NOTES);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.equal(JSON.parse(r.stdout).tag, 'v0.1.0');
  assert.equal(git(dir, 'tag', '--list'), 'v0.1.0');
});

test('keel itself: practices/VERSION is the practice, and a release now would leave it unchanged', () => {
  // Cut after 0.5.2 with only keel-side changes: the practice must not move.
  // The expected numbers are read, never written down (lesson 17).
  const practice = practiceVersion();
  const pkg = JSON.parse(readFileSync(join(KEEL, 'package.json'), 'utf8'));
  const since = practiceChange(KEEL, practice, ENV);
  const next = (([a, b, c]) => `${a}.${b}.${c + 1}`)(pkg.version.split('.').map(Number));
  const r = run(process.execPath, [BIN, 'release', next, '--notes', '-', '--dry-run', '--json'], { cwd: KEEL, env: ENV, input: NOTES });
  assert.equal(r.status, 0, r.stderr);
  const plan = JSON.parse(r.stdout);
  assert.equal(plan.practice.from, practice);
  assert.equal(plan.practice.changed, since.changed);
  if (!since.changed) {
    assert.equal(plan.practice.to, practice);
    assert.match(plan.entry.heading, new RegExp(`keel only; practice unchanged at ${practice.replace(/\./g, '\\.')}`));
  }
});

test('prepend puts a new entry above the newest and keeps the header', () => {
  const one = prepend(null, '0.1.0', 'First.', '2026-10-02');
  assert.equal(one, `${WHATSNEW_HEADER}\n## v0.1.0 — 2026-10-02\n\nFirst.\n`);
  const two = prepend(one, '0.2.0', 'Second.', '2026-10-09');
  assert.deepEqual(entries(two).map(e => [e.version, e.body]), [['0.2.0', 'Second.'], ['0.1.0', 'First.']]);
});
