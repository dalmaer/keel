// keel release: the CLI version is package.json's, tagged v<version>; the
// practice version is practices/VERSION and moves only when practices/ or
// migrations/ changed since the last practice release (phase 22). Each
// release gets a WHATSNEW entry saying which kind it was.
// Run against a synthetic keel-shaped repo ("keel": "self"), never keel's own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { run } from './helpers/run.mjs';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { readFileSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { release, entries, between, prepend, practiceChange, scopeCommits, GATE_CAP, WHATSNEW_HEADER } from '../lib/release.mjs';
import { practiceVersion } from '../lib/practices.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const BASE_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Acme Builder', GIT_AUTHOR_EMAIL: 'builder@acme.test',
  GIT_COMMITTER_NAME: 'Acme Builder', GIT_COMMITTER_EMAIL: 'builder@acme.test',
  GIT_CONFIG_NOSYSTEM: '1',
};

// ---- the stub gh (phase 48's review gate) -------------------------------------------

const H7 = '7777777777777777777777777777777777777777';
const MERGED = '2026-10-08T10:00:00Z';
/** PR #7: merged, written by acme-owner, its head reviewed by another provider's workflow, nothing to answer. */
const REVIEWED = { head: H7, author: 'acme-owner', mergedAt: MERGED, threads: [], reviews: [{ user: 'github-actions[bot]', commit_id: H7 }] };

/**
 * A gh for keel release's review gate. State: pulls { <sha>: [{number, merged_at}] }
 * (the commit's PRs), defaultPull (any other commit's; null: none), prs { <n>:
 * { head, author, mergedAt, threads, reviews } }, down (every call fails).
 * Every call is logged; anything else (a write) exits 1.
 */
async function stubGh(state = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-release-gh-'));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'gh'), statePath = join(dir, 'state.json'), log = join(dir, 'gh.log');
  await writeFile(statePath, JSON.stringify({ pulls: {}, defaultPull: { number: 7, merged_at: MERGED }, prs: { 7: REVIEWED }, ...state }));
  await writeFile(path, `#!${process.execPath}
const fs = require('node:fs');
const argv = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(argv) + '\\n');
const s = JSON.parse(fs.readFileSync(${JSON.stringify(statePath)}, 'utf8'));
if (s.down) { console.error('error connecting to api.github.com'); process.exit(1); }
const field = k => (argv.find(a => a.startsWith(k + '=')) ?? '').slice(k.length + 1);
let m;
if (argv[0] === 'api' && (m = /^repos\\/acme\\/keel\\/commits\\/([0-9a-f]{40})\\/pulls$/.exec(argv[1] ?? ''))) {
  console.log(JSON.stringify(s.pulls[m[1]] ?? (s.defaultPull ? [s.defaultPull] : [])));
} else if (argv[0] === 'api' && argv[1] === 'graphql' && !field('query').startsWith('mutation')) {
  const n = Number(field('number')), p = s.prs[n];
  if (!p) { console.log(JSON.stringify({ data: { repository: { pullRequest: null } } })); process.exit(0); }
  const node = c => ({ databaseId: c.databaseId, author: { login: c.author }, body: c.body, createdAt: '2026-10-08T09:00:00Z', url: 'https://github.com/acme/keel/pull/' + n });
  console.log(JSON.stringify({ data: { repository: { pullRequest: {
    number: n, title: 'Acme practice', url: 'https://github.com/acme/keel/pull/' + n, state: p.mergedAt ? 'MERGED' : 'OPEN', mergedAt: p.mergedAt ?? null, headRefOid: p.head,
    author: { login: p.author },
    reviewThreads: { pageInfo: { hasNextPage: false }, nodes: p.threads.map(t => ({ id: t.id, isResolved: !!t.isResolved, path: 'practices/base/AGENTS.md', line: 1, comments: { pageInfo: { hasNextPage: false }, nodes: t.comments.map(node) } })) },
    comments: { pageInfo: { hasNextPage: false }, nodes: [] },
    reviews: { pageInfo: { hasNextPage: false }, nodes: [] },
  } } } }));
} else if (argv[0] === 'api' && (m = /^repos\\/acme\\/keel\\/pulls\\/(\\d+)\\/reviews/.exec(argv[1] ?? ''))) {
  console.log(JSON.stringify((s.prs[m[1]]?.reviews ?? []).map(r => ({ user: { login: r.user }, state: 'COMMENTED', commit_id: r.commit_id, submitted_at: '2026-10-08T09:30:00Z' }))));
} else { console.error('stub gh: unexpected ' + argv.join(' ')); process.exit(1); }
`);
  await chmod(path, 0o755);
  return {
    path,
    env: { ...BASE_ENV, KEEL_GH: path },
    calls: async () => (await readFile(log, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean).map(l => JSON.parse(l)),
    set: async f => { const st = JSON.parse(await readFile(statePath, 'utf8')); f(st); await writeFile(statePath, JSON.stringify(st)); },
  };
}
/** Every test reads GitHub only through a stub, which by default says each commit came through reviewed PR #7. */
const ENV = (await stubGh()).env;
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const NOTES = 'Acme projects get a conductor that names their gate.\n';

/** A keel-shaped repo on 0.0.0: package.json, practices/VERSION and a template, .keel/keel.json ("keel": "self", its gate `check`), a lock, WHATSNEW.md. */
async function keelLike(t, { self = true, check = 'node -e 0' } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-release-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.keel'));
  await writeFile(join(dir, 'package.json'), '{\n  "name": "keel",\n  "version": "0.0.0",\n  "type": "module"\n}\n');
  await writeFile(join(dir, '.keel/keel.json'), `{\n  "name": "Acme Keel",\n  "repo": "acme/keel",\n  ${self ? '"keel": "self",\n  ' : ''}"check": ${JSON.stringify(check)},\n  "practice": "0.0.0",\n  "practices": ["base", "phases"]\n}\n`);
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

// ---- phase 48: a release is reviewed before the fleet sees it ------------------------

/** Everything a refused release must leave alone: the files it would write, HEAD, the tags, the status. */
const snapshot = async dir => ({
  files: await Promise.all(['package.json', 'practices/VERSION', '.keel/keel.json', '.keel/lock.json', 'WHATSNEW.md'].map(f => readFile(join(dir, f)))),
  head: git(dir, 'rev-parse', 'HEAD'), tags: git(dir, 'tag', '--list'), status: git(dir, 'status', '--porcelain'),
});
const lookups = calls => calls.filter(c => /\/commits\/[0-9a-f]{40}\/pulls$/.test(c[1] ?? ''));

test('the review gate: a practice commit pushed straight to main refuses (exit 1, naming it) and writes nothing', async t => {
  const gh = await stubGh({ defaultPull: null });
  const dir = await keelLike(t);
  await changePractice(dir);
  const sha = git(dir, 'rev-parse', 'HEAD');
  const before = await snapshot(dir);
  let r = await attempt(release({ root: dir, version: '0.1.0', notes: NOTES }, { env: gh.env }));
  assert.equal(r.exitCode, 1, r.text);
  assert.match(r.text, /the review gate refused v0\.1\.0: 1 of 1 practice commit/);
  assert.ok(r.text.includes(`${sha.slice(0, 7)} practice: base — pushed straight to main: no merged pull request brought it`), r.text);
  assert.match(r.text, /--unreviewed "<why>"/);
  assert.deepEqual(await snapshot(dir), before, 'nothing written: no file, commit or tag');
  assert.deepEqual((await gh.calls()).map(c => c[1]), [`repos/acme/keel/commits/${sha}/pulls`], 'one call for the one commit, and no PR read');
  // In a PR that never merged: it still reached main outside one.
  await gh.set(s => { s.pulls[sha] = [{ number: 9, merged_at: null }]; });
  r = await attempt(release({ root: dir, version: '0.1.0', notes: NOTES }, { env: gh.env }));
  assert.equal(r.exitCode, 1, r.text);
  assert.match(r.text, /only in unmerged #9: it reached main outside a PR/);
  assert.deepEqual(await snapshot(dir), before);
});

test('the review gate: a merged PR whose keel review --gate fails refuses, naming the PR and why; answered, it passes', async t => {
  const OLD = '6666666666666666666666666666666666666666';
  const open = { id: 'PRRT_open', comments: [{ databaseId: 1, author: 'github-actions', body: '**P1** The hatch is open.' }] };
  const dir = await keelLike(t);
  await changePractice(dir);
  const short = git(dir, 'rev-parse', '--short=7', 'HEAD');
  const before = await snapshot(dir);
  for (const [pr, why] of [
    [{ ...REVIEWED, threads: [open] }, /#7: 1 review comment unanswered \(PRRT_open\)/],
    [{ ...REVIEWED, reviews: [{ user: 'acme-owner', commit_id: H7 }] }, /#7: nobody but its author \(acme-owner\) reviewed its head 7777777/],
    [{ ...REVIEWED, reviews: [{ user: 'github-actions[bot]', commit_id: OLD }] }, /#7: nobody but its author \(acme-owner\) reviewed its head 7777777/],
    [{ ...REVIEWED, reviews: [] }, /#7: nobody but its author/],
  ]) {
    const gh = await stubGh({ prs: { 7: pr } });
    const r = await attempt(release({ root: dir, version: '0.1.0', notes: NOTES }, { env: gh.env }));
    assert.equal(r.exitCode, 1, r.text);
    assert.ok(r.text.includes(`${short} practice: base — #7`), r.text);
    assert.match(r.text, why);
    assert.deepEqual(await snapshot(dir), before, 'nothing written');
  }
  // The comment answered by the author: the gate passes.
  const answered = { ...open, comments: [...open.comments, { databaseId: 2, author: 'acme-owner', body: 'Fixed in abc1234.' }] };
  const gh = await stubGh({ prs: { 7: { ...REVIEWED, threads: [answered] } } });
  const r = await release({ root: dir, version: '0.1.0', notes: NOTES }, { env: gh.env });
  assert.deepEqual(r.data.review.checked, [{ sha: short, subject: 'practice: base', pr: 7, ok: true, why: '#7, reviewed by github-actions[bot]' }]);
});

test('the review gate passes when each practice commit came through a reviewed PR: one call a commit, each PR read once, only commits since the last tag', async t => {
  const gh = await stubGh();
  const dir = await keelLike(t);
  await changePractice(dir, 'Acme keeps a gate.');
  await changePractice(dir, 'Acme keeps two.');
  await writeFile(join(dir, 'README.md'), '# Acme keel\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'docs: readme');
  let r = await release({ root: dir, version: '0.1.0', notes: NOTES }, { env: gh.env });
  assert.deepEqual(r.data.review.checked.map(c => [c.subject, c.pr, c.ok]), [['practice: base', 7, true], ['practice: base', 7, true]], 'the README commit is not practice scope');
  assert.match(r.text, /Review gate passed: 2 practice commit\(s\), each through a reviewed PR/);
  const calls = await gh.calls();
  assert.equal(lookups(calls).length, 2, 'one lookup a commit');
  assert.equal(calls.length, 4, 'two lookups, then PR #7 read once: its threads and its reviews');
  assert.equal(git(dir, 'log', '-1', '--format=%B').trim(), 'release v0.1.0', 'a reviewed release says nothing more');
  assert.doesNotMatch(await readFile(join(dir, 'WHATSNEW.md'), 'utf8'), /without the review gate/);

  // The next release checks only what came after v0.1.0, through its own PR.
  await changePractice(dir, 'Acme answers its reviews.');
  const sha = git(dir, 'rev-parse', 'HEAD');
  const H8 = '8888888888888888888888888888888888888888';
  await gh.set(s => { s.pulls[sha] = [{ number: 8, merged_at: MERGED }]; s.prs[8] = { ...REVIEWED, head: H8, reviews: [{ user: 'claude[bot]', commit_id: H8 }] }; });
  assert.deepEqual(scopeCommits(dir, null, gh.env).commits.map(c => c.sha), [sha]);
  r = await release({ root: dir, version: '0.2.0', notes: 'Acme answers.' }, { env: gh.env });
  assert.equal(r.data.review.since, 'v0.1.0');
  assert.deepEqual(r.data.review.checked.map(c => [c.pr, c.ok, c.why]), [[8, true, '#8, reviewed by claude[bot]']]);
});

test('--unreviewed "<why>" passes the gate unread and writes the reason into the release commit and WHATSNEW', async t => {
  const gh = await stubGh({ defaultPull: null });
  const dir = await keelLike(t);
  await changePractice(dir);
  const short = git(dir, 'rev-parse', '--short=7', 'HEAD');
  const before = await snapshot(dir);
  let r = await attempt(release({ root: dir, version: '0.1.0', notes: NOTES, unreviewed: 'hotfix' }, { env: gh.env }));
  assert.equal(r.exitCode, 2, 'a reason is words, not one');
  assert.match(r.text, /--unreviewed needs the reason/);
  assert.deepEqual(await snapshot(dir), before);
  const why = 'Acme hotfix: the hatch was open';
  r = await release({ root: dir, version: '0.1.0', notes: NOTES, unreviewed: why }, { env: gh.env, date: '2026-10-09' });
  assert.deepEqual(await gh.calls(), [], 'skipped: GitHub is not read');
  assert.equal(r.data.review.unreviewed, why);
  assert.match(r.text, /Review gate skipped \(--unreviewed\): Acme hotfix/);
  assert.equal(entries(await readFile(join(dir, 'WHATSNEW.md'), 'utf8'))[0].body, `${NOTES.trim()}\n\nReleased without the review gate (1 practice commit unchecked): ${why}`);
  assert.equal(git(dir, 'log', '-1', '--format=%s'), 'release v0.1.0');
  assert.equal(git(dir, 'log', '-1', '--format=%b').trim(), `Unreviewed: ${why}\n\n${short} practice: base`);
  assert.equal(git(dir, 'tag', '--list'), 'v0.1.0');
  // A keel-only release has no review to skip.
  r = await attempt(release({ root: dir, version: '0.1.1', notes: NOTES, unreviewed: why }, { env: gh.env }));
  assert.equal(r.exitCode, 2);
  assert.match(r.text, /no commit under practices\/, migrations\/ or docs\/lessons\.md since v0\.1\.0, so there is no review to skip/);
});

test('--yes does not skip the review gate: the CLI refuses it and writes nothing; only --unreviewed passes', async t => {
  const gh = await stubGh({ defaultPull: null });
  const dir = await keelLike(t);
  await changePractice(dir);
  const short = git(dir, 'rev-parse', '--short=7', 'HEAD');
  const before = await snapshot(dir);
  const cli = args => run(process.execPath, [BIN, 'release', '0.1.0', '--notes', '-', ...args, '--json'], { cwd: dir, env: gh.env, input: NOTES });
  const yes = cli(['--yes']);
  assert.notEqual(yes.status, 0, yes.stdout);
  assert.match(JSON.parse(yes.stdout).error, /takes no --yes[\s\S]*--unreviewed "<why>"/);
  assert.deepEqual(await snapshot(dir), before, '--yes wrote nothing');
  const plain = cli([]);
  assert.equal(plain.status, 1, plain.stdout);
  assert.ok(JSON.parse(plain.stdout).error.includes(`${short} practice: base — pushed straight to main`));
  assert.deepEqual(await snapshot(dir), before);
  const empty = cli(['--unreviewed']);
  assert.equal(empty.status, 2);
  assert.match(JSON.parse(empty.stdout).error, /--unreviewed needs the reason/);
  const owner = cli(['--unreviewed', 'Acme owner releases it unread']);
  assert.equal(owner.status, 0, owner.stdout + owner.stderr);
  assert.equal(JSON.parse(owner.stdout).review.unreviewed, 'Acme owner releases it unread');
});

test('the review gate never passes on an unread review: GitHub down is exit 2, nothing written', async t => {
  const gh = await stubGh({ down: true });
  const dir = await keelLike(t);
  await changePractice(dir);
  const before = await snapshot(dir);
  const r = await attempt(release({ root: dir, version: '0.1.0', notes: NOTES }, { env: gh.env }));
  assert.equal(r.exitCode, 2, r.text);
  assert.match(r.text, /GitHub could not be read[\s\S]*cannot pass on an unread review, and nothing was written/);
  assert.deepEqual(await snapshot(dir), before);
});

test(`the review gate reads at most ${GATE_CAP} commits: past it, a clear refusal before any GitHub call`, async t => {
  const gh = await stubGh();
  const dir = await keelLike(t);
  for (let i = 0; i <= GATE_CAP; i++) await changePractice(dir, `Acme rule ${i}.`);
  const before = await snapshot(dir);
  const r = await attempt(release({ root: dir, version: '0.1.0', notes: NOTES }, { env: gh.env }));
  assert.equal(r.exitCode, 1, r.text);
  assert.match(r.text, new RegExp(`${GATE_CAP + 1} commits under practices/[\\s\\S]*reads at most ${GATE_CAP}[\\s\\S]*Release more often, or pass --unreviewed`));
  assert.deepEqual(await gh.calls(), []);
  assert.deepEqual(await snapshot(dir), before);
});

test('a dry run lists the commits the review gate will check and reads no GitHub', async t => {
  const gh = await stubGh({ defaultPull: null });
  const dir = await keelLike(t);
  await changePractice(dir);
  const short = git(dir, 'rev-parse', '--short=7', 'HEAD');
  const r = await release({ root: dir, version: '0.1.0', notes: NOTES, dryRun: true }, { env: gh.env });
  assert.deepEqual(r.data.review, { since: r.data.practice.since, commits: [{ sha: short, subject: 'practice: base' }], unreviewed: null });
  assert.match(r.text, new RegExp(`check that each of 1 practice commit\\(s\\)[^\\n]*a dry run reads no GitHub\\): ${short}`));
  assert.deepEqual(await gh.calls(), []);
});

// ---- the fleet rehearsal (phase 53) -------------------------------------------------

/** fleet.json at the keel-shaped repo, committed: these repos are managed, and acme/upstream is a source. */
async function withFleet(dir, repos) {
  await writeFile(join(dir, 'fleet.json'), JSON.stringify([...repos.map(repo => ({ repo, kind: 'node', role: 'managed' })), { repo: 'acme/upstream', kind: 'other', role: 'source' }]));
  git(dir, 'add', 'fleet.json');
  git(dir, 'commit', '-qm', 'acme fleet');
}
/** The rows lib/fleet.mjs rehearse returns; the stand-in records what it was asked. */
const ROWS = {
  passed: repo => ({ repo, status: 'passed', check: { command: 'npm run check', ok: true } }),
  fails: repo => ({ repo, status: 'fails', check: { command: 'npm run check', ok: false, exit: 5, tail: 'not ok 3 - acme ledger balances\nacme-tail-line' }, mainCheck: { exit: 0, line: 'main passes', tail: '' } }),
  red: repo => ({ repo, status: 'main-red', check: { command: 'npm run check', ok: false, exit: 4, tail: 'acme-red' }, mainCheck: { exit: 4, line: 'main fails', tail: 'acme-red' } }),
  gone: repo => ({ repo, status: 'error', step: 'clone', error: 'gh repo clone failed: Could not resolve to a Repository' }),
};
function rehearsal(rows) {
  const asked = [];
  const fn = async (opts, deps) => { asked.push({ opts, deps }); return { data: { ok: true, cli: deps.cli, ms: 4321, rows, resting: [], fails: [] }, text: '' }; };
  return Object.assign(fn, { asked });
}

test('the rehearsal refuses a release while a project passes on main and fails with it: exit 1, naming it and its tail, nothing written', async t => {
  const dir = await keelLike(t);
  await withFleet(dir, ['acme/picky', 'acme/red', 'acme/gone']);
  await changePractice(dir);
  const before = await snapshot(dir);
  const rehearse = rehearsal([ROWS.fails('acme/picky'), ROWS.red('acme/red'), ROWS.gone('acme/gone')]);
  const r = await attempt(release({ root: dir, version: '0.1.0', notes: NOTES }, { env: ENV, rehearse }));
  assert.equal(r.exitCode, 1, r.text);
  assert.match(r.text, /^the fleet rehearsal refused v0\.1\.0: acme\/picky passes its check on main and fails it with this release\. Nothing was committed or tagged and every file is as it was\./);
  assert.match(r.text, /acme\/picky: FAILS with the release: `npm run check` exit 5; main passes without it\. Its output ended:\n {6}not ok 3 - acme ledger balances\n {6}acme-tail-line/);
  assert.match(r.text, /acme\/red: main already red/);
  assert.match(r.text, /acme\/gone: not rehearsed: clone failed/);
  assert.match(r.text, /in 4\.3s/, 'the rehearsal\'s time is said');
  assert.match(r.text, /pass --despite <repo> "<why>"/);
  assert.deepEqual(await snapshot(dir), before, 'no file, commit or tag');
  // It rehearsed the candidate: this checkout's practices/ and migrations/, at the practice version the release carries.
  assert.equal(rehearse.asked.length, 1);
  assert.deepEqual([rehearse.asked[0].opts.dir, rehearse.asked[0].deps.cli, rehearse.asked[0].deps.practicesDir, rehearse.asked[0].deps.migrationsDir],
    [dir, '0.1.0', join(dir, 'practices'), join(dir, 'migrations')]);
});

test('the rehearsal passes a release when every project passes, or its main was already red, or it could not be cloned; no fleet skips it and says so', async t => {
  const dir = await keelLike(t);
  await withFleet(dir, ['acme/ok', 'acme/red', 'acme/gone']);
  await changePractice(dir);
  const rehearse = rehearsal([ROWS.passed('acme/ok'), ROWS.red('acme/red'), ROWS.gone('acme/gone')]);
  const r = await release({ root: dir, version: '0.1.0', notes: NOTES }, { env: ENV, rehearse });
  assert.equal(git(dir, 'log', '-1', '--format=%s'), 'release v0.1.0');
  assert.equal(git(dir, 'tag', '--list'), 'v0.1.0');
  assert.deepEqual(r.data.rehearsal.rows.map(x => [x.repo, x.status]), [['acme/ok', 'passed'], ['acme/red', 'main-red'], ['acme/gone', 'error']]);
  assert.deepEqual(r.data.rehearsal.projects, ['acme/ok', 'acme/red', 'acme/gone'], 'managed only, never a source');
  assert.equal(r.data.rehearsal.ms, 4321);
  assert.match(r.text, /Rehearsed practice 0\.1\.0 on 3 fleet projects \(at most 4 at once\) in 4\.3s/);
  assert.match(r.text, /acme\/ok: passed: `npm run check` exit 0 with the release/);

  // No fleet.json: the rehearsal is skipped and said, never run.
  const bare = await keelLike(t);
  await changePractice(bare);
  const never = rehearsal([ROWS.fails('acme/picky')]);
  const s = await release({ root: bare, version: '0.1.0', notes: NOTES }, { env: ENV, rehearse: never });
  assert.equal(never.asked.length, 0);
  assert.equal(s.data.rehearsal.skipped, 'no managed project in fleet.json');
  assert.match(s.text, /Rehearsal skipped: no managed project in fleet\.json\./);
  const dry = await release({ root: bare, version: '0.1.1', notes: NOTES, dryRun: true }, { env: ENV });
  assert.match(dry.text, /skip the fleet rehearsal: no managed project in fleet\.json/);
});

test('--despite <repo> "<why>" releases past a project the rehearsal fails, writing the reason into the commit and WHATSNEW; a repo not in the fleet is refused', async t => {
  const dir = await keelLike(t);
  await withFleet(dir, ['acme/picky', 'acme/ok']);
  await changePractice(dir);
  const before = await snapshot(dir);
  const why = 'Acme picky flakes on a clock test, tracked in acme/picky#3';
  // Not in the fleet (a source is not managed), a reason of one word, or given twice: refused before anything runs.
  for (const [despite, error] of [
    [[{ repo: 'acme/stranger', why }], /--despite acme\/stranger: not a managed project in fleet\.json/],
    [[{ repo: 'acme/upstream', why }], /--despite acme\/upstream: not a managed project in fleet\.json/],
    [[{ repo: 'acme/picky', why: 'flaky' }], /--despite acme\/picky needs the reason, in a few words/],
    [[{ repo: 'acme/picky', why }, { repo: 'acme/picky', why }], /--despite acme\/picky is given twice/],
  ]) {
    const never = rehearsal([]);
    const r = await attempt(release({ root: dir, version: '0.1.0', notes: NOTES, despite }, { env: ENV, rehearse: never }));
    assert.equal(r.exitCode, 2, r.text);
    assert.match(r.text, error);
    assert.equal(never.asked.length, 0);
    assert.deepEqual(await snapshot(dir), before);
  }
  const dry = await release({ root: dir, version: '0.1.0', notes: NOTES, dryRun: true, despite: [{ repo: 'acme/picky', why }] }, { env: ENV });
  assert.match(dry.text, /rehearse the update on the 2 managed fleet project\(s\) \(clone, install, update to practice 0\.1\.0, check; nothing pushed\)[^\n]*, except acme\/picky \(--despite\)/);

  const rehearse = rehearsal([ROWS.fails('acme/picky'), ROWS.passed('acme/ok')]);
  const r = await release({ root: dir, version: '0.1.0', notes: NOTES, despite: [{ repo: 'acme/picky', why }] }, { env: ENV, rehearse, date: '2026-10-09' });
  assert.equal(git(dir, 'tag', '--list'), 'v0.1.0');
  assert.deepEqual(r.data.rehearsal.despite, [{ repo: 'acme/picky', why }]);
  assert.match(r.text, /acme\/picky: FAILS with the release/);
  assert.match(r.text, /Released despite the fleet rehearsal: acme\/picky \(Acme picky flakes/);
  assert.equal(entries(await readFile(join(dir, 'WHATSNEW.md'), 'utf8'))[0].body, `${NOTES.trim()}\n\nReleased despite the fleet rehearsal: acme/picky (${why})`);
  assert.equal(git(dir, 'log', '-1', '--format=%b').trim(), `Despite the fleet rehearsal:\nacme/picky: ${why} (fails with the release: \`npm run check\` exit 5)`);

  // The CLI: --despite needs both values; a repo not in the fleet is exit 2, nothing written.
  const notes = join(dir, '..', `${dir.split('/').pop()}-notes.md`);
  await writeFile(notes, NOTES);
  t.after(() => rm(notes, { force: true }));
  const after = await snapshot(dir);
  let cli = run(process.execPath, [BIN, 'release', '0.2.0', '--notes', notes, '--despite', 'acme/picky'], { cwd: dir, env: ENV });
  assert.equal(cli.status, 2);
  assert.match(cli.stderr, /--despite needs the project and the reason: --despite <owner\/name> "<why>"/);
  cli = run(process.execPath, [BIN, 'release', '0.2.0', '--notes', notes, '--despite', 'acme/stranger', why, '--json'], { cwd: dir, env: ENV });
  assert.equal(cli.status, 2, cli.stdout);
  assert.match(JSON.parse(cli.stdout).error, /--despite acme\/stranger: not a managed project in fleet\.json/);
  assert.deepEqual(await snapshot(dir), after);
});
