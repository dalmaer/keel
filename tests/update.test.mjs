// keel update: a project on an older practice reaches this one as one
// reviewed change — CLI first, then migrations, re-render, check, branch/PR.
// Fixtures are synthetic: a project made by keel init and set back to 0.0.0,
// and acme-groove (milestones, a check:all gate) for migration 0001.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { run as runCmd, testsRan, cleanEnv } from './helpers/run.mjs';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, lstat, readlink, rm, writeFile, realpath, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { updatePlan } from '../lib/fleet.mjs';
import { load, fill, practiceVersion } from '../lib/practices.mjs';
import { sha256, readLock, formatLock } from '../lib/lock.mjs';
import { init } from '../lib/init.mjs';
import { adopt, survey } from '../lib/adopt.mjs';
import { update, selfUpdate, BRANCH } from '../lib/update.mjs';
import { load as loadMigrations, collect, compareVersions, view } from '../lib/migrations.mjs';
import * as m0001 from '../migrations/0001-milestone-to-goal.mjs';
import * as m0002 from '../migrations/0002-projects-run-on-their-own.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const GROOVE = join(KEEL, 'tests', 'fixtures', 'adopt', 'acme-groove');
// The version this keel brings a project to: its own, and at least the release
// its newest migration is for (0002, 0.3.0), as 0001 was for 0.1.0 before it.
const TARGET = compareVersions(practiceVersion(), '0.3.0') > 0 ? practiceVersion() : '0.3.0';
const OLD = { cli: '0.0.0', commit: null, practice: '0.0.0' };
// update() runs the project's check in-process: give it the runner's env without NODE_TEST_*.
const ENV = {
  ...cleanEnv(),
  GIT_AUTHOR_NAME: 'Acme Builder', GIT_AUTHOR_EMAIL: 'builder@acme.test',
  GIT_COMMITTER_NAME: 'Acme Builder', GIT_COMMITTER_EMAIL: 'builder@acme.test',
  GIT_CONFIG_NOSYSTEM: '1', KEEL_SELF_UPDATED: '',
};
const OLD_SKILL = `---
name: conduct
description: Walk the phases. (An older conductor, before keel carried isocan 7227f325.)
---

# Conduct

Read the roadmap, brief a builder, commit.
`;

const keel = (args, cwd, env = ENV) => {
  const r = runCmd(process.execPath, [BIN, ...args], { cwd, env });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: ENV, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const deps = (extra = {}) => ({ version: TARGET, cliRoot: KEEL, env: ENV, ...extra });
const run = (opts, d = deps()) => update({ selfUpdate: false, ...opts }, d)
  .catch(error => ({ error, exitCode: error.exitCode ?? 1, text: error.message }));

async function scratch(t, prefix = 'keel-update-') {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** One hash of every file, link and mode under dir, .git aside. */
async function treeHash(dir) {
  const h = createHash('sha256');
  const walk = async d => {
    for (const e of (await readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name), rel = relative(dir, p);
      // The test ledger's runs: ignored by their own .gitignore, left by every gate run (phase 33).
      if (e.name === '.git' || rel === join('.keel', 'test-runs')) continue;
      const i = await lstat(p);
      if (i.isSymbolicLink()) h.update(`L ${rel} ${await readlink(p)}\n`);
      else if (i.isDirectory()) { h.update(`D ${rel}\n`); await walk(p); }
      else h.update(`F ${rel} ${i.mode & 0o111} ${sha256(await readFile(p))}\n`);
    }
  };
  await walk(dir);
  return h.digest('hex');
}

/** A project made by keel init, set back to practice 0.0.0 with an older conductor keel wrote. */
async function oldProject(t) {
  const dir = join(await scratch(t), 'acme-notes');
  await init({ dir, name: 'Acme Notes', description: 'Acme Notes keeps meeting notes as plain files.', kind: 'node' }, { version: OLD, env: ENV });
  const skill = '.agents/skills/conduct/SKILL.md';
  await writeFile(join(dir, skill), OLD_SKILL);
  const lock = await readLock(dir);
  lock.practice = '0.0.0';
  lock.files[skill].sha256 = sha256(OLD_SKILL);
  await writeFile(join(dir, '.keel/lock.json'), formatLock(lock));
  git(dir, 'commit', '-qam', 'acme on practice 0.0.0 with an older conductor');
  return dir;
}

/** acme-groove, adopted on practice 0.0.0 and committed: phases local, milestones in place. */
async function groove(t, edit, version = OLD) {
  const dir = join(await scratch(t), 'acme-groove');
  await cp(GROOVE, dir, { recursive: true });
  await adopt({ dir }, { version });
  if (edit) await edit(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'acme-groove under keel');
  return dir;
}

const json = path => readFile(path, 'utf8').then(JSON.parse);
/** keel's template for a file, filled for the project at dir. */
const template = async (dir, practice, from) => fill(await readFile(join(KEEL, 'practices', practice, 'files', from), 'utf8'), await json(join(dir, '.keel/keel.json')), from);
/** Equal text, without dumping both into the failure. */
const same = (a, b, what) => assert.ok(a === b, `${what} differs from keel's template`);

test('an old CLI refuses a project on a newer practice, and says how to update', async t => {
  const dir = await oldProject(t);
  const cfg = await json(join(dir, '.keel/keel.json'));
  await writeFile(join(dir, '.keel/keel.json'), `${JSON.stringify({ ...cfg, practice: '99.0.0' }, null, 2)}\n`);
  git(dir, 'commit', '-qam', 'from the future');
  const before = await treeHash(dir);
  const r = keel(['update', '--no-self-update', '--json'], dir);
  assert.equal(r.code, 2, r.err + r.out);
  assert.match(JSON.parse(r.out).error, /^update keel first: .* practice 99\.0\.0, and this keel carries/);
  const text = keel(['update', '--no-self-update'], dir);
  assert.equal(text.code, 2);
  assert.match(text.err, /pull --ff-only/);
  assert.equal(await treeHash(dir), before);
});

test('a 0.0.0 project with an older conductor comes out current; the check passes; a second run changes nothing', async t => {
  const dir = await oldProject(t);
  const r = await run({ dir, local: true });
  assert.equal(r.exitCode ?? 0, 0, r.text);
  assert.equal(r.data.from, '0.0.0');
  assert.equal(r.data.to, TARGET);
  assert.deepEqual(r.data.migrations, [], 'a managed re-render, no migration needed');
  assert.ok(r.data.rendered.includes('.agents/skills/conduct/SKILL.md'));
  assert.equal(r.data.check.ok, true);
  same(await readFile(join(dir, '.agents/skills/conduct/SKILL.md'), 'utf8'), await template(dir, 'conduct', '.agents/skills/conduct/SKILL.md'), 'SKILL.md');
  assert.equal((await json(join(dir, '.keel/keel.json'))).practice, TARGET);
  assert.equal((await readLock(dir)).practice, TARGET);
  assert.match(git(dir, 'status', '--short'), /SKILL\.md/, '--local leaves a working-tree diff');
  // The check still passes on its own.
  const gate0 = runCmd('npm', ['run', 'check'], { cwd: dir, env: ENV });
  assert.equal(gate0.status, 0, gate0.stdout + gate0.stderr);
  assert.ok(testsRan(gate0.stdout + gate0.stderr) > 0, gate0.stdout + gate0.stderr);
  assert.match(gate0.stdout + gate0.stderr, /a well-formed phase parses/);

  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'keel update');
  const before = await treeHash(dir);
  const again = await run({ dir, local: true });
  assert.equal(again.exitCode ?? 0, 0, again.text);
  assert.equal(again.data.changed, false);
  assert.match(again.text, new RegExp(`^Already on practice ${TARGET.replaceAll('.', '\\.')}`, 'm'));
  assert.equal(await treeHash(dir), before);
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('update refuses a dirty tree, and a keel file the project changed', async t => {
  const dir = await oldProject(t);
  await writeFile(join(dir, 'notes.txt'), 'scratch\n');
  let r = await run({ dir, local: true });
  assert.equal(r.exitCode, 2);
  assert.match(r.text, /working tree is not clean/);
  await rm(join(dir, 'notes.txt'));

  await writeFile(join(dir, 'CLAUDE.md'), 'Read AGENTS.md. Also: Acme prefers tabs.\n');
  git(dir, 'commit', '-qam', 'our own CLAUDE.md');
  const before = await treeHash(dir);
  r = await run({ dir, local: true });
  assert.equal(r.exitCode, 1);
  assert.match(r.text, /CLAUDE\.md \(edited\).*keel doctor --fix <path> restore\|eject/);
  assert.equal(await treeHash(dir), before);
});

test('a migration whose up() throws leaves the project as it was, and is named', async t => {
  const dir = await oldProject(t);
  const migrations = await scratch(t, 'keel-migrations-');
  await writeFile(join(migrations, '0001-acme-first.mjs'), `
export const id = '0001-acme-first', to = '0.1.0', summary = 'writes a file';
export const applies = async p => !(await p.exists('acme.txt'));
export const up = async () => [{ path: 'acme.txt', content: 'one\\n' }, { path: 'AGENTS.md', content: null }];
`);
  await writeFile(join(migrations, '0002-acme-broken.mjs'), `
export const id = '0002-acme-broken', to = '0.1.0', summary = 'fails';
export const applies = async p => p.exists('acme.txt'); // sees 0001's edit in memory
export const up = async () => { throw new Error('Acme cannot be converted'); };
`);
  const before = await treeHash(dir);
  const r = await run({ dir, local: true }, deps({ version: '0.1.0', migrationsDir: migrations }));
  assert.equal(r.exitCode, 1);
  assert.match(r.text, /^migration 0002-acme-broken failed: Acme cannot be converted/);
  assert.equal(await treeHash(dir), before);
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('a failing check after a migration restores every byte, and names the check', async t => {
  const dir = await groove(t, async d => {
    const cfg = await json(join(d, '.keel/keel.json'));
    await writeFile(join(d, '.keel/keel.json'), `${JSON.stringify({ ...cfg, check: 'node -e "process.exit(7)"' }, null, 2)}\n`);
  });
  await chmod(join(dir, 'scripts/roadmap.mjs'), 0o755); // a mode to put back, on a file 0001 deletes
  git(dir, 'commit', '-qam', 'executable roadmap');
  const before = await treeHash(dir);
  const r = await run({ dir, local: true });
  assert.equal(r.exitCode, 1, r.text);
  assert.match(r.text, /the project's check failed after the update \(`node -e "process.exit\(7\)"`, exit 7\); the project is as it was/);
  assert.equal(await treeHash(dir), before);
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('0001 converts acme-groove: milestones become goals, keel\'s roadmap replaces its own, phases is on, the gate passes', async t => {
  const dir = await groove(t);
  const evidence = await readFile(join(dir, 'docs/evidence/2026-01-05-baseline.md'));
  const r = await run({ dir, local: true });
  assert.equal(r.exitCode ?? 0, 0, r.text);
  // 0004 too: acme-groove runs node's test runner, so it gains the test ledger.
  assert.deepEqual(r.data.migrations.map(m => m.id), ['0001-milestone-to-goal', '0004-test-ledger']);
  assert.deepEqual(r.data.migrations[0].edits.sort((a, b) => a.path.localeCompare(b.path)), [
    { path: '.keel/keel.json', action: 'write' },
    { path: 'AGENTS.md', action: 'write' },
    { path: 'docs/goals.json', action: 'write' },
    { path: 'docs/milestones.json', action: 'delete' },
    { path: 'docs/phases/00-practice-room.md', action: 'write' },
    { path: 'docs/phases/01-fair-feedback.md', action: 'write' },
    { path: 'docs/phases/README.md', action: 'delete' },
    { path: 'package.json', action: 'write' },
    { path: 'scripts/roadmap.mjs', action: 'delete' },
    { path: 'tests/roadmap.test.js', action: 'delete' },
  ]);

  // The diff, as a reviewer sees it.
  const status = git(dir, 'status', '--porcelain').split('\n').map(l => l.trim()).sort();
  assert.deepEqual(status, [
    'D docs/milestones.json', 'D tests/roadmap.test.js',
    'M .keel/keel.json', 'M .keel/lock.json', 'M AGENTS.md', 'M package.json',
    'M docs/phases/00-practice-room.md', 'M docs/phases/01-fair-feedback.md', 'M docs/phases/README.md', 'M scripts/roadmap.mjs',
    '?? docs/ROADMAP.md', '?? docs/goals.json', '?? docs/templates/phase.md', '?? tests/roadmap.test.mjs',
  ].sort());
  assert.deepEqual(await json(join(dir, 'docs/goals.json')), [
    { id: 'G0', title: 'The practice room', outcome: 'A player opens the room and plays one groove.' },
    { id: 'G1', title: 'Fair feedback', outcome: 'A player hears which notes were early or late.' },
  ]);
  const p0 = await readFile(join(dir, 'docs/phases/00-practice-room.md'), 'utf8');
  assert.match(p0, /^goal: G0$/m);
  assert.doesNotMatch(p0, /milestone/);
  assert.match(p0, /^- \[x\] .*Added by keel migration 0001/m, 'a built phase with evidence keeps its claim, marked');
  assert.match(await readFile(join(dir, 'docs/phases/01-fair-feedback.md'), 'utf8'), /^- \[ \] /m, 'a planned phase gets an open box');
  same(await readFile(join(dir, 'scripts/roadmap.mjs'), 'utf8'), await template(dir, 'phases', 'scripts/roadmap.mjs'), 'scripts/roadmap.mjs');
  same(await readFile(join(dir, 'docs/phases/README.md'), 'utf8'), await template(dir, 'phases', 'docs/phases/README.md'), 'docs/phases/README.md');
  assert.deepEqual(await readFile(join(dir, 'docs/evidence/2026-01-05-baseline.md')), evidence, 'evidence is never touched');
  const cfg = await json(join(dir, '.keel/keel.json'));
  assert.ok(cfg.practices.includes('phases'));
  assert.equal(cfg.local.phases, undefined);
  assert.ok(cfg.local.ci, 'ci stays the project\'s own');
  assert.equal(cfg.practice, TARGET);
  assert.deepEqual(cfg.migrations, ['0001-milestone-to-goal', '0004-test-ledger'], 'the migrations are recorded as taken');
  assert.equal(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).scripts.roadmap, 'node scripts/roadmap.mjs', 'the roadmap scripts still run, now keel\'s');

  // After it, adopt's survey finds phases on, and the project's own gate passes.
  const s = await survey(dir, { version: { practice: TARGET }, practices: await load() });
  assert.equal(s.practices.find(p => p.name === 'phases').state, 'on');
  const gate = runCmd('npm', ['run', 'check:all'], { cwd: dir, env: ENV });
  assert.equal(gate.status, 0, gate.stdout + gate.stderr);
  assert.ok(testsRan(gate.stdout + gate.stderr) > 0, gate.stdout + gate.stderr);
  // …and it measures something: npm test runs keel's roadmap tests, not zero tests.
  assert.equal(JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')).scripts.test, 'node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=./scripts/keel/test-ledger.mjs --test-reporter-destination=stdout tests/*.test.js tests/roadmap.test.mjs', '0001 adds keel\'s roadmap test, then 0004 the test ledger');
  const tests = runCmd('npm', ['test'], { cwd: dir, env: ENV });
  assert.equal(tests.status, 0, tests.stdout + tests.stderr);
  const said = tests.stdout + tests.stderr;
  assert.ok(testsRan(said) > 0, said);
  assert.match(said, /a well-formed phase parses/);
  assert.equal(keel(['doctor', '--json'], dir).code, 0);

  // Idempotent: 0001 no longer applies, and a second update changes nothing.
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'keel update');
  assert.equal(await m0001.applies(await view(dir)), false);
  const before = await treeHash(dir);
  const again = await run({ dir, local: true });
  assert.equal(again.data.changed, false, again.text);
  assert.equal(await treeHash(dir), before);
});

test('0001 keeps phases local rather than leave a test script that cannot run keel\'s roadmap test', async t => {
  assert.deepEqual(m0001.testScript('node --test tests/*.test.mjs'), { script: 'node --test tests/*.test.mjs' });
  assert.deepEqual(m0001.testScript('node --test'), { script: 'node --test' });
  assert.deepEqual(m0001.testScript('node --test tests/*.test.js'), { script: 'node --test tests/*.test.js tests/roadmap.test.mjs' });
  for (const odd of [undefined, 'vitest run', 'node --test tests/*.js && echo ok', 'node --test --test-name-pattern x tests/*.js']) {
    assert.ok(m0001.testScript(odd).why, String(odd));
  }
  const dir = await groove(t, async d => {
    const pkg = JSON.parse(await readFile(join(d, 'package.json'), 'utf8'));
    pkg.scripts.test = 'vitest run';
    await writeFile(join(d, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  });
  const { edits } = await collect(dir, await loadMigrations(), { done: [] });
  assert.equal(edits.has('tests/roadmap.test.js'), false, 'the project\'s roadmap test stays');
  assert.equal(edits.has('scripts/roadmap.mjs'), false);
  const cfg = JSON.parse(edits.get('.keel/keel.json'));
  assert.ok(!cfg.practices.includes('phases'));
  assert.match(cfg.local.phases, /vitest run.*no roadmap test/);
  assert.ok(edits.has('docs/goals.json'), 'milestones still become goals');
});

test('0001 run directly: applies() is idempotent, up() writes nothing', async t => {
  const dir = await groove(t);
  const before = await treeHash(dir);
  const { applied, edits } = await collect(dir, await loadMigrations(), { done: [] });
  assert.deepEqual(applied.map(m => m.id), ['0001-milestone-to-goal', '0004-test-ledger']);
  assert.equal(edits.get('docs/milestones.json'), null);
  assert.equal(await treeHash(dir), before, 'collecting edits performs none');
  // Over its own edits, it no longer applies.
  const again = await collect(dir, [{ ...m0001, to: '0.1.0' }, { id: '0002-again', to: '0.1.0', summary: 'x', applies: m0001.applies, up: m0001.up }], { done: [] });
  assert.deepEqual(again.skipped, ['0002-again']);
});

test('the default path commits on a branch, exits 3 with the plan, and --yes pushes and calls gh pr create', async t => {
  const dir = await oldProject(t);
  const tmp = await scratch(t, 'keel-gh-');
  const origin = join(tmp, 'origin.git');
  git(tmp, 'init', '-q', '--bare', origin);
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-q', 'origin', 'main');
  const log = join(tmp, 'gh.log'), gh = join(tmp, 'gh');
  await writeFile(gh, `#!${process.execPath}
require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2)) + '\\n');
const a = process.argv.slice(2);
require('node:fs').writeFileSync(${JSON.stringify(log + '.body')}, require('node:fs').readFileSync(a[a.indexOf('--body-file') + 1]));
console.log('https://github.test/acme/notes/pull/1');
`);
  await chmod(gh, 0o755);
  const whatsnew = join(tmp, 'WHATSNEW.md');
  await writeFile(whatsnew, `# What's new in keel\n\n## v${TARGET} — 2026-10-02\n\nAcme gets the current conductor.\n\n## v0.0.0 — 2026-01-01\n\nNot for this project.\n`);
  const env = { ...ENV, KEEL_GH: gh };
  const d = deps({ env, whatsnew });

  const before = await treeHash(dir);
  const planned = await run({ dir }, d);
  assert.equal(planned.exitCode, 3, planned.text);
  assert.equal(planned.data.needs, 'yes');
  assert.match(planned.text, new RegExp(`git push -u origin ${BRANCH(TARGET).replaceAll('.', '\\.')}`));
  assert.equal(git(dir, 'rev-parse', '--abbrev-ref', 'HEAD'), 'main');
  assert.equal(await treeHash(dir), before, 'main is as it was');
  assert.match(git(dir, 'log', '-1', '--format=%B', BRANCH(TARGET)), new RegExp(`^keel update: practice 0\\.0\\.0 → ${TARGET.replaceAll('.', '\\.')}`));
  assert.match(git(dir, 'show', '--stat', '--format=', BRANCH(TARGET)), /SKILL\.md/);
  await assert.rejects(readFile(log), 'gh is not called without --yes');

  const done = await run({ dir, yes: true }, d);
  assert.equal(done.exitCode ?? 0, 0, done.text);
  assert.equal(done.data.pr, 'https://github.test/acme/notes/pull/1');
  assert.equal(git(origin, 'rev-parse', BRANCH(TARGET)), git(dir, 'rev-parse', BRANCH(TARGET)), 'the branch is pushed');
  const calls = (await readFile(log, 'utf8')).trim().split('\n').map(l => JSON.parse(l));
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 6), ['pr', 'create', '--head', BRANCH(TARGET), '--base', 'main']);
  assert.ok(calls[0].includes('--body-file'));
  const body = await readFile(log + '.body', 'utf8');
  const { checkImpact } = await import('../practices/reconciliation/files/scripts/keel/reconcile.mjs');
  assert.deepEqual((await checkImpact({ root: dir, body, changedFiles: ['scripts/roadmap.mjs', '.keel/keel.json'] })).findings, []);
  assert.ok((await checkImpact({ root: dir, body, changedFiles: ['docs/phases/01-acme.md'] })).findings.length);
  assert.match(body, /If a migration changes actual phase or decision records/);
  assert.match(body, /Acme gets the current conductor\./);
  assert.doesNotMatch(body, /Not for this project/);
});

/**
 * Open the update PR for the project at dir with a stub gh, through `mod`'s
 * update (the real module, or a mutant). Returns the body gh was handed.
 */
async function prOf(t, dir, extra = {}, mod = { update }) {
  const tmp = await scratch(t, 'keel-gh-');
  const origin = join(tmp, 'origin.git');
  git(tmp, 'init', '-q', '--bare', origin);
  git(dir, 'remote', 'add', 'origin', origin);
  git(dir, 'push', '-q', 'origin', 'main');
  const gh = join(tmp, 'gh'), body = join(tmp, 'body.md');
  await writeFile(gh, `#!${process.execPath}
const a = process.argv.slice(2);
require('node:fs').writeFileSync(${JSON.stringify(body)}, require('node:fs').readFileSync(a[a.indexOf('--body-file') + 1]));
console.log('https://github.test/acme/notes/pull/2');
`);
  await chmod(gh, 0o755);
  const r = await mod.update({ dir, yes: true, selfUpdate: false }, deps({ env: { ...ENV, KEEL_GH: gh }, ...extra }));
  assert.equal(r.exitCode ?? 0, 0, r.text);
  return readFile(body, 'utf8');
}

/** lib/update.mjs with one rule edited out, its imports pointed back at keel: a mutant the assertions must catch. */
async function mutantUpdate(t, from, to) {
  const text = await readFile(join(KEEL, 'lib', 'update.mjs'), 'utf8');
  assert.ok(text.includes(from), `the mutation's target is still in the source: ${from}`);
  const dir = await scratch(t, 'keel-update-mutant-');
  const lib = pathToFileURL(join(KEEL, 'lib')).href;
  await writeFile(join(dir, 'update.mjs'), text.replace(from, to).replaceAll("from './", `from '${lib}/`).replaceAll("from '../", `from '${pathToFileURL(KEEL).href}/`));
  return import(pathToFileURL(join(dir, 'update.mjs')).href);
}

/** A synthetic migration that rewrites one of the project's own files. */
const REWRITES = { id: '0099-acme-notes-index', to: TARGET, summary: 'Acme notes gain an index', applies: async () => true, up: async () => [{ path: 'docs/notes-index.md', content: '# Acme notes\n' }] };

test('the update PR reads in a minute: Summary as a tree, Evidence, Merge danger; one-way when a migration rewrote project files, two-way for a re-render', async t => {
  const sections = body => ['## Summary', '## Evidence', '## Merge danger'].map(h => body.indexOf(`${h}\n`));
  // A re-render only: two-way.
  const plain = await prOf(t, await oldProject(t), { migrations: [] });
  const at = sections(plain);
  assert.ok(at[0] >= 0 && at[0] < at[1] && at[1] < at[2], plain);
  assert.match(plain, /```text\n[\s\S]*\.agents\/skills\/conduct\/\n[\s\S]*SKILL\.md[\s\S]*```/, 'the changed files, as a tree');
  assert.match(plain, /^Gate: `npm run check` exit 0 on this change/m);
  assert.match(plain, new RegExp(`^\\| keel practice \\(\\.keel/keel\\.json\\) \\| 0\\.0\\.0 \\| ${TARGET.replaceAll('.', '\\.')} \\|$`, 'm'));
  assert.match(plain, /^Two-way door: re-renders keel's own files; reverting the merge restores them\.$/m);
  assert.match(plain, /^Blast radius: adopted project\.$/m);
  assert.ok(plain.indexOf('```keel-impact') > at[2], 'the keel-impact block comes after the three sections');

  // A migration that rewrote the project's own file: one-way, the file named, and marked in the tree.
  const dir = await oldProject(t);
  const rewrote = await prOf(t, dir, { migrations: [REWRITES] });
  assert.match(rewrote, /^One-way door: migration 0099-acme-notes-index rewrote docs\/notes-index\.md\./m);
  assert.match(rewrote, /notes-index\.md {2}\(migration 0099-acme-notes-index\)/);
  assert.match(git(dir, 'log', '-1', '--format=%B', BRANCH(TARGET)), /^0099-acme-notes-index: Acme notes gain an index\n {2}rewrites: docs\/notes-index\.md$/m);

  // Mutation: the door no longer reads the migrations; a rewriting update says two-way, and is caught.
  const blind = await mutantUpdate(t, 'danger: rewrites.length', 'danger: false');
  const wrong = await prOf(t, await oldProject(t), { migrations: [REWRITES] }, blind);
  assert.doesNotMatch(wrong, /^One-way door:/m, 'the mutant marks a migration-rewriting update two-way');
  // Mutation: the commit stops naming a migration's edits; the resumed PR could not tell.
  const silent = await mutantUpdate(t, "...(m.edits.length ? [`  rewrites: ${m.edits.map(e => e.path).join(', ')}`] : [])", '');
  assert.doesNotMatch(await prOf(t, await oldProject(t), { migrations: [REWRITES] }, silent), /^One-way door:/m);
});

test('self-update: a behind checkout is pulled and re-run once; KEEL_SELF_UPDATED stops a second time', async t => {
  const tmp = await scratch(t, 'keel-self-');
  const origin = join(tmp, 'origin.git'), work = join(tmp, 'work'), cli = join(tmp, 'cli');
  git(tmp, 'init', '-q', '--bare', '-b', 'main', origin);
  git(tmp, 'clone', '-q', origin, work);
  await mkdir(join(work, 'bin'));
  // A stand-in CLI that reports how it was run.
  await writeFile(join(work, 'bin', 'keel.mjs'), `console.log(JSON.stringify({ again: process.env.KEEL_SELF_UPDATED, argv: process.argv.slice(2) }));\n`);
  git(work, 'add', '-A'); git(work, 'commit', '-qm', 'one'); git(work, 'push', '-q', 'origin', 'HEAD:main');
  git(tmp, 'clone', '-q', origin, cli);
  await writeFile(join(work, 'NEW'), 'two\n');
  git(work, 'add', '-A'); git(work, 'commit', '-qm', 'two'); git(work, 'push', '-q', 'origin', 'HEAD:main');

  // Already re-run once: no fetch, no pull, even though it is behind.
  assert.equal(selfUpdate({ cliRoot: cli, env: { ...ENV, KEEL_SELF_UPDATED: '1' } }).state, 'skipped');
  assert.equal(git(cli, 'rev-list', '--count', 'HEAD..origin/main'), '0', 'nothing fetched');

  // A dirty checkout is said and left alone.
  await writeFile(join(cli, 'bin', 'keel.mjs'), '// a local hack\n');
  assert.equal(selfUpdate({ cliRoot: cli, env: ENV }).state, 'dirty');
  git(cli, 'checkout', '-q', '--', 'bin/keel.mjs');

  // update re-execs the pulled CLI with the same arguments and KEEL_SELF_UPDATED=1.
  const project = await oldProject(t);
  const r = await update({ dir: project, argv: ['update', '--json'] }, { version: TARGET, cliRoot: cli, env: ENV });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(JSON.parse(r.passthrough.stdout), { again: '1', argv: ['update', '--json'] });
  assert.equal(git(cli, 'rev-parse', 'HEAD'), git(work, 'rev-parse', 'HEAD'), 'pulled');
  assert.equal(selfUpdate({ cliRoot: cli, env: ENV }).state, 'current');

  // Not a checkout: said, and the update goes on with keel as it is.
  assert.equal(selfUpdate({ cliRoot: tmp, env: ENV }).state, 'not-git');
});

test('the CLI: update on keel itself is a no-op; --local and --yes do not mix', async t => {
  const self = keel(['update', '--no-self-update', '--json'], KEEL);
  assert.equal(self.code, 0, self.err);
  assert.equal(JSON.parse(self.out).self, true);
  const dir = await oldProject(t);
  const both = keel(['update', '--local', '--yes', '--json'], dir);
  assert.equal(both.code, 2);
  assert.match(JSON.parse(both.out).error, /--local makes neither/);
});

test('after a keel-only release, a project on the practice is current: update changes nothing and opens nothing, and fleet plans nothing', async t => {
  // A keel-shaped CLI: a copy of this checkout in its own repo, its gate trivial.
  const root = await scratch(t);
  const cliRoot = join(root, 'keel');
  for (const p of ['bin', 'lib', 'practices', 'migrations', 'scripts', '.keel', 'package.json', 'WHATSNEW.md']) {
    await cp(join(KEEL, p), join(cliRoot, p), { recursive: true, verbatimSymlinks: true });
  }
  const cfgPath = join(cliRoot, '.keel', 'keel.json');
  await writeFile(cfgPath, (await readFile(cfgPath, 'utf8')).replace(/("practices"\s*:)/, '"check": "node -e 0",\n  $1'));
  git(root, 'init', '-q', '-b', 'main', cliRoot);
  git(cliRoot, 'add', '-A');
  git(cliRoot, 'commit', '-qm', 'acme keel');
  const bin = join(cliRoot, 'bin', 'keel.mjs');
  const P = (await readFile(join(cliRoot, 'practices', 'VERSION'), 'utf8')).trim();
  const before = JSON.parse(await readFile(join(cliRoot, 'package.json'), 'utf8')).version;
  const next = (([a, b, c]) => `${a}.${b}.${c + 1}`)(before.split('.').map(Number));
  const rel = runCmd(process.execPath, [bin, 'release', next, '--notes', '-', '--json'], { cwd: cliRoot, env: ENV, input: 'Acme fleet reads faster.\n' });
  assert.equal(rel.status, 0, rel.stderr + rel.stdout);
  assert.equal(JSON.parse(rel.stdout).practice.changed, false);
  assert.equal(JSON.parse(await readFile(join(cliRoot, 'package.json'), 'utf8')).version, next, 'the CLI moved');
  assert.equal((await readFile(join(cliRoot, 'practices', 'VERSION'), 'utf8')).trim(), P, 'the practice did not');
  const version = JSON.parse(runCmd(process.execPath, [bin, '--version', '--json'], { cwd: root, env: ENV }).stdout);
  assert.deepEqual([version.cli, version.practice], [next, P]);

  // A project on practice P, updated by that CLI: no change, no branch, exit 0.
  const dir = join(root, 'acme');
  await init({ dir, name: 'Acme Notes', description: 'Acme keeps its notes as plain files.', kind: 'node' }, { version: { cli: P, commit: null, practice: P }, env: ENV });
  const hash = await treeHash(dir), branches = git(dir, 'branch', '--list'), head = git(dir, 'rev-parse', 'HEAD');
  const up = runCmd(process.execPath, [bin, 'update', '--no-self-update'], { cwd: dir, env: ENV });
  assert.equal(up.status, 0, up.stderr + up.stdout);
  assert.match(up.stdout, new RegExp(`Already on practice ${P.replace(/\./g, '\\.')}; nothing to change`));
  assert.equal(await treeHash(dir), hash, 'no file changed');
  assert.equal(git(dir, 'branch', '--list'), branches, 'no branch created');
  assert.equal(git(dir, 'rev-parse', 'HEAD'), head);

  // Fleet, with that CLI's practice: the project gets no plan.
  const { versionInfo } = await import(pathToFileURL(join(cliRoot, 'lib', 'cli.mjs')).href);
  const row = { repo: 'acme/notes', role: 'managed', adopted: true, practice: { version: JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8')).practice, pending: [], possiblyPending: [] } };
  assert.equal(updatePlan(row, versionInfo().practice), null);
});

test('the migrations keel ships load, each with an id, a version, applies and up', async () => {
  const all = await loadMigrations();
  assert.ok(all.length >= 1);
  assert.deepEqual(all.map(m => m.id), [...all.map(m => m.id)].sort());
  for (const m of all) {
    assert.match(m.id, /^\d{4}-[a-z0-9-]+$/);
    assert.ok(compareVersions(m.to, '0.0.0') > 0);
    assert.ok(compareVersions(m.to, TARGET) <= 0, `${m.id} is for a version keel has not reached`);
  }
});

test('a project adopted on the current practice still gets 0001, and keel next says plainly that its phases are local until then', async t => {
  const current = practiceVersion(); // the CLI's own, which keel update (the CLI) brings it to
  const dir = await groove(t, null, { cli: current, commit: null, practice: current });
  assert.equal((await json(join(dir, '.keel/keel.json'))).practice, current, 'adopt stamps the current practice');

  for (const verb of [['next'], ['status'], ['goal', 'list']]) {
    const r = keel([...verb, '--json'], dir);
    assert.equal(r.code, 2, verb.join(' '));
    assert.match(JSON.parse(r.out).error, /^phases is a local variant here: phase files name a milestone.*; use the project's own roadmap \(npm run roadmap\)$/);
  }
  assert.doesNotMatch(keel(['next'], dir).err, /invalid metadata line/);

  const r = keel(['update', '--local', '--no-self-update', '--json'], dir);
  assert.equal(r.code, 0, r.err + r.out);
  const out = JSON.parse(r.out);
  assert.equal(out.changed, true);
  assert.deepEqual(out.migrations.map(m => m.id), ['0001-milestone-to-goal', '0004-test-ledger']);
  const cfg = await json(join(dir, '.keel/keel.json'));
  assert.ok(cfg.practices.includes('phases'));
  assert.deepEqual(cfg.migrations, ['0001-milestone-to-goal', '0004-test-ledger']);
  const next = keel(['next'], dir);
  assert.equal(next.code, 0, next.err);
  assert.match(next.out, /^1\. Fair feedback \[planned\]/);

  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'keel update');
  const before = await treeHash(dir);
  const again = keel(['update', '--local', '--no-self-update', '--json'], dir);
  assert.equal(again.code, 0, again.err);
  assert.equal(JSON.parse(again.out).changed, false);
  assert.equal(await treeHash(dir), before);
});

test('a recorded migration is not pending again, even if applies() would say yes', async t => {
  const dir = await groove(t);
  const all = await loadMigrations();
  const { applied } = await collect(dir, all, { done: ['0001-milestone-to-goal', '0004-test-ledger'] });
  assert.deepEqual(applied, []);
});

test('0001 replaces a milestone-shaped phase template, and leaves the project\'s own evidence template and evidence local', async t => {
  const dir = join(await scratch(t), 'acme-groove');
  await cp(GROOVE, dir, { recursive: true });
  await mkdir(join(dir, 'docs/templates'), { recursive: true });
  await writeFile(join(dir, 'docs/templates/phase.md'), '---\nstatus: planned\nmilestone: M1\n---\n\n# Acme outcome\n');
  await writeFile(join(dir, 'docs/templates/evidence.md'), '# Acme evidence\n\n- Date:\n');
  await adopt({ dir }, { version: { cli: TARGET, commit: null, practice: TARGET } });
  git(dir, 'init', '-q', '-b', 'main'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'adopted');
  assert.ok((await json(join(dir, '.keel/keel.json'))).local.evidence, 'evidence is local: its template is the project\'s');
  const r = await run({ dir, local: true });
  assert.equal(r.exitCode ?? 0, 0, r.text);
  same(await readFile(join(dir, 'docs/templates/phase.md'), 'utf8'), await template(dir, 'phases', 'docs/templates/phase.md'), 'docs/templates/phase.md');
  assert.equal(await readFile(join(dir, 'docs/templates/evidence.md'), 'utf8'), '# Acme evidence\n\n- Date:\n');
  const cfg = await json(join(dir, '.keel/keel.json'));
  assert.ok(cfg.practices.includes('phases') && !cfg.practices.includes('evidence'));
  assert.ok(cfg.local.evidence);
});

/** A project on practice 0.2.0 with the weekly keel-update.yml keel wrote then (synthetic bytes). */
async function withUpdateWorkflow(t, { edited = false } = {}) {
  const dir = join(await scratch(t), 'acme-notes');
  await init({ dir, name: 'Acme Notes', description: 'Acme Notes keeps meeting notes as plain files.', kind: 'node' }, { version: { cli: '0.2.0', commit: null, practice: '0.2.0' }, env: ENV });
  const written = '# keel-update (Acme fixture): cloned keel with a token, weekly.\nname: keel-update\n';
  await writeFile(join(dir, m0002.WORKFLOW), edited ? `${written}# Acme added a step of its own.\n` : written);
  const lock = await readLock(dir);
  lock.files[m0002.WORKFLOW] = { practice: 'night', sha256: sha256(written) };
  await writeFile(join(dir, '.keel/lock.json'), formatLock(lock));
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'acme on practice 0.2.0 with keel-update.yml');
  return dir;
}

test('0002 retires keel-update.yml where keel\'s bytes stand, and the rest of the night practice is rendered', async t => {
  const dir = await withUpdateWorkflow(t);
  assert.equal(await m0002.applies(await view(dir)), true);
  const r = await run({ dir, local: true });
  assert.equal(r.exitCode ?? 0, 0, r.text);
  assert.deepEqual(r.data.migrations.map(m => m.id), ['0002-projects-run-on-their-own']);
  assert.deepEqual(r.data.migrations[0].edits, [{ path: m0002.WORKFLOW, action: 'delete' }, { path: '.keel/lock.json', action: 'write' }]);
  assert.match(r.text, /KEEL_TOKEN secret is no longer used/, 'the owner is told the secret can go');
  await assert.rejects(lstat(join(dir, m0002.WORKFLOW)), 'deleted');
  const lock = await readLock(dir);
  assert.ok(!lock.files[m0002.WORKFLOW], 'and gone from the lock');
  for (const f of ['.github/workflows/keel-night.yml', 'scripts/keel/improve.mjs', 'scripts/keel/drain.mjs', 'scripts/keel/lib.mjs']) {
    same(await readFile(join(dir, f), 'utf8'), await template(dir, 'night', f), f);
    assert.ok(lock.files[f], `${f} is locked`);
  }
  assert.deepEqual((await json(join(dir, '.keel/keel.json'))).migrations, ['0002-projects-run-on-their-own']);
  assert.equal(await m0002.applies(await view(dir)), false, 'idempotent: nothing left to retire');
});

test('0002 leaves a keel-update.yml the project edited, as its own, and forgets it in the lock', async t => {
  const dir = await withUpdateWorkflow(t, { edited: true });
  assert.equal(await m0002.decision(await view(dir)), 'keep');
  const r = await run({ dir, local: true });
  assert.equal(r.exitCode ?? 0, 0, r.text);
  assert.deepEqual(r.data.migrations[0].edits, [{ path: '.keel/lock.json', action: 'write' }]);
  assert.match(r.text, /left as the project's own where it was edited/);
  assert.match(await readFile(join(dir, m0002.WORKFLOW), 'utf8'), /Acme added a step of its own/);
  assert.ok(!(await readLock(dir)).files[m0002.WORKFLOW], 'keel no longer manages it');
  assert.equal(await m0002.applies(await view(dir)), false);
});

test('the check runs with .keel/keel.json `env`: it fails without ACME_FLAG and passes with it', async t => {
  const check = 'node -e "process.exit(process.env.ACME_FLAG === \'1\' ? 0 : 6)"';
  const withCheck = env => async d => {
    const cfg = await json(join(d, '.keel/keel.json'));
    await writeFile(join(d, '.keel/keel.json'), `${JSON.stringify({ ...cfg, check, ...(env ? { env } : {}) }, null, 2)}\n`);
  };
  const bare = await groove(t, withCheck());
  const r = await run({ dir: bare, local: true });
  assert.equal(r.exitCode, 1, r.text);
  assert.match(r.text, /exit 6\); the project is as it was/);
  const flagged = await groove(t, withCheck({ ACME_FLAG: '1' }));
  const ok = await run({ dir: flagged, local: true });
  assert.equal(ok.exitCode ?? 0, 0, ok.text);
  assert.equal(ok.data.check.ok, true);
});
