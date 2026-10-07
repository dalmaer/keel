// Migration 0004 (phase 33): a node test script gains the test ledger's two
// reporter pairs, in the update PR; any other test script is never touched;
// AGENTS.md gains the night block's markers. Idempotent.
// Migration 0005: the same for a workspace's or app folder's own node test
// script (its runs land in the root's ledger); a node test script that misses
// a test keel ships gains its path; with ci off, the step to keep CI's runs
// is a note in the update. Idempotent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, mkdir, realpath, cp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { run } from './helpers/run.mjs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { view, collect } from '../lib/migrations.mjs';
import * as m0004 from '../migrations/0004-test-ledger.mjs';
import * as m0005 from '../migrations/0005-test-ledger-reach.mjs';
import { notesOf, noteLines, updateBody } from '../lib/update.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORTERS = '--test-reporter=spec --test-reporter-destination=stdout --test-reporter=./scripts/keel/test-ledger.mjs --test-reporter-destination=stdout';

async function acme(t, { script = 'node --test tests/*.test.mjs', practices = ['base', 'agents-md', 'night'], agents = '# Working on Acme\n\nAcme\'s own rules.\n', extra = {}, pkg } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-0004-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.keel'), { recursive: true });
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme', practices, ...extra }, null, 2));
  if (pkg !== null) await writeFile(join(dir, 'package.json'), pkg ?? `{\n  "name": "acme",\n  "scripts": {\n    "check": "npm test",\n    "test": ${JSON.stringify(script)}\n  }\n}\n`);
  if (agents !== null) await writeFile(join(dir, 'AGENTS.md'), agents);
  return dir;
}

/** What the migration does: its edits as { path: content }, or null when it does not apply. */
async function edits(dir, m = m0004) {
  const project = await view(dir);
  if (!(await m.applies(project))) return null;
  return Object.fromEntries((await m.up(project)).map(e => [e.path, e.content]));
}

/** The rule: node's runner gains the reporters after --test; nothing else is touched. */
async function assertOnlyNode(t, m = m0004) {
  for (const [script, want] of [
    ['node --test tests/*.test.mjs', `node --test ${REPORTERS} tests/*.test.mjs`],
    ['node --test', `node --test ${REPORTERS}`],
    ['node --import ./tests/helpers/acme.mjs --test --test-concurrency=4 tests/*.test.mjs', `node --import ./tests/helpers/acme.mjs --test ${REPORTERS} --test-concurrency=4 tests/*.test.mjs`],
  ]) {
    const dir = await acme(t, { script, agents: null });
    const e = await edits(dir, m);
    assert.ok(e, script);
    assert.deepEqual(Object.keys(e), ['package.json'], script);
    assert.equal(JSON.parse(e['package.json']).scripts.test, want, script);
    assert.equal(e['package.json'], (await readFile(join(dir, 'package.json'), 'utf8')).replace(JSON.stringify(script), JSON.stringify(want)), 'only the script\'s own string changes');
  }
  for (const script of ['vitest run', 'jest', 'npm run unit', 'node scripts/test.mjs --test', 'tsx --test tests/a.ts', 'node --test-only tests/a.mjs', 'node --test --test-reporter=dot tests/*.mjs', `node --test ${REPORTERS} tests/*.test.mjs`]) {
    assert.equal(await edits(await acme(t, { script, agents: null }), m), null, `never touched: ${script}`);
  }
}

test('0004: a node --test script gains the two reporter pairs, after --test; any other test script is never touched', async t => {
  await assertOnlyNode(t);
});

test('mutation: a 0004 that touches a script that is not node\'s runner fails the test above', async t => {
  const text = await readFile(join(KEEL, 'migrations', '0004-test-ledger.mjs'), 'utf8');
  const rule = 'const NODE_TEST = /^node(?:\\s+--(?:import|require)(?:=|\\s+)\\S+)*\\s+--test(?=\\s|$)/;';
  assert.ok(text.includes(rule));
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-0004-mutant-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'm.mjs'), text.replace(rule, 'const NODE_TEST = /^\\S+(?:\\s+--test)?/;'));
  const mutant = await import(pathToFileURL(join(dir, 'm.mjs')).href);
  await assert.rejects(assertOnlyNode(t, mutant), assert.AssertionError);
});

test('0004: AGENTS.md gains the night block\'s empty markers, every byte kept; not when skipped or ejected', async t => {
  const agents = '# Working on Acme\n\nAcme\'s own rules.';
  const dir = await acme(t, { agents, script: 'vitest run' });
  const e = await edits(dir);
  assert.deepEqual(Object.keys(e), ['AGENTS.md'], 'a vitest project gets the markers, and its script stays');
  assert.ok(e['AGENTS.md'].startsWith(agents));
  assert.match(e['AGENTS.md'], /\n<!-- keel:begin night -->\n<!-- keel:end night -->\n$/);
  assert.equal(await edits(await acme(t, { agents, script: 'vitest run', extra: { blocksSkipped: ['night'] } })), null);
  assert.equal(await edits(await acme(t, { agents, script: 'vitest run', extra: { ejected: ['AGENTS.md#night'] } })), null);
});

test('0004 applies only with the night practice on, is idempotent over its own edits, and leaves no package.json alone', async t => {
  assert.equal(await edits(await acme(t, { practices: ['base', 'agents-md'] })), null, 'no night: no reporter file to point at');
  assert.equal(await edits(await acme(t, { pkg: null, agents: '<!-- keel:begin night -->\n<!-- keel:end night -->\n' })), null, 'no package.json');
  assert.equal(await edits(await acme(t, { pkg: '{ not json', agents: '<!-- keel:begin night -->\n<!-- keel:end night -->\n' })), null, 'a package.json that does not parse is not ours to repair');
  const dir = await acme(t);
  const { applied, edits: overlay } = await collect(dir, [m0004]);
  assert.deepEqual(applied.map(m => m.id), ['0004-test-ledger']);
  assert.deepEqual([...overlay.keys()].sort(), ['AGENTS.md', 'package.json']);
  // Over its own edits it no longer applies.
  for (const [path, content] of overlay) await writeFile(join(dir, path), content);
  assert.equal(await m0004.applies(await view(dir)), false);
});

// ---- 0005 -----------------------------------------------------------------------

/** An Acme repo for 0005: { path: content } over a config. */
async function reach(t, files, { practices = ['base', 'agents-md', 'night', 'ci'], extra = {} } = {}) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'keel-0005-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, '.keel'), { recursive: true });
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme', practices, ...extra }, null, 2));
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  }
  return dir;
}
const pkgOf = (test, more = {}) => ({ name: 'acme', scripts: { test }, ...more });
const ROOT_DONE = `node --test ${REPORTERS} tests/*.test.mjs`;

test('0005: a workspace\'s or app folder\'s node test script gains the reporters, pointing back at the root\'s ledger; another runner is untouched', async t => {
  const dir = await reach(t, {
    'package.json': pkgOf(ROOT_DONE, { workspaces: ['packages/*'] }),
    'web/package.json': pkgOf('node --test tests/*.test.mjs'),
    'packages/shop/package.json': pkgOf('node --import ./setup.mjs --test'),
    'client/package.json': pkgOf('vitest run'),
  });
  const e = await edits(dir, m0005);
  assert.deepEqual(Object.keys(e).sort(), ['packages/shop/package.json', 'web/package.json']);
  assert.equal(JSON.parse(e['web/package.json']).scripts.test, `node --test ${m0004.reportersFor('../scripts/keel/test-ledger.mjs')} tests/*.test.mjs`);
  assert.equal(JSON.parse(e['packages/shop/package.json']).scripts.test, `node --import ./setup.mjs --test ${m0004.reportersFor('../../scripts/keel/test-ledger.mjs')}`);
  // Idempotent: over its own edits it no longer applies.
  for (const [path, content] of Object.entries(e)) await writeFile(join(dir, path), content);
  assert.equal(await m0005.applies(await view(dir)), false);
  // Night off: no reporter to point at.
  assert.equal(await edits(await reach(t, { 'package.json': pkgOf('node --test'), 'web/package.json': pkgOf('node --test') }, { practices: ['base', 'ci'] }), m0005), null);
});

test('0005, run for real: npm test in web/ records in the root\'s .keel/test-runs, with root-relative files', async t => {
  const dir = await reach(t, {
    'package.json': pkgOf(ROOT_DONE),
    'web/package.json': pkgOf('node --test tests/*.test.mjs'),
    'web/tests/shop.test.mjs': "import { test } from 'node:test';\ntest('the Acme shop opens', () => {});\n",
  });
  await mkdir(join(dir, 'scripts', 'keel'), { recursive: true });
  await cp(join(KEEL, 'practices', 'night', 'files', 'scripts', 'keel', 'test-ledger.mjs'), join(dir, 'scripts', 'keel', 'test-ledger.mjs'));
  for (const [path, content] of Object.entries(await edits(dir, m0005))) await writeFile(join(dir, path), content);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main'); git('add', '-A'); git('commit', '-qm', 'acme');
  const r = run('npm', ['test'], { cwd: join(dir, 'web'), env: { ...process.env } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /keel test ledger: /);
  const { readRuns } = await import('../practices/night/files/scripts/keel/test-ledger.mjs');
  const { runs } = await readRuns(dir);
  assert.deepEqual(runs.map(x => x.tests.map(y => [y.file, y.name])), [[['web/tests/shop.test.mjs', 'the Acme shop opens']]]);
  assert.equal(runs[0].dirty, false);
});

test('0005: a node test script that misses a test keel ships gains its path; one that runs it (no path, a glob, the gate) is untouched', async t => {
  const missing = `node --test ${REPORTERS} tests/*.test.js tests/roadmap.test.mjs`;
  const dir = await reach(t, { 'package.json': pkgOf(missing, { scripts: { test: missing, check: 'npm test' } }) }, { practices: ['base', 'agents-md', 'night', 'ci', 'phases'] });
  const e = await edits(dir, m0005);
  assert.deepEqual(Object.keys(e), ['package.json']);
  assert.equal(JSON.parse(e['package.json']).scripts.test, `${missing} tests/keel-generated.test.mjs tests/keel-workflows.test.mjs`);
  for (const [path, content] of Object.entries(e)) await writeFile(join(dir, path), content);
  assert.equal(await m0005.applies(await view(dir)), false, 'idempotent');
  for (const script of ['node --test', 'node --test tests/*.test.mjs', 'node --test tests/', 'vitest run', 'node --test tests/*.js && echo done']) {
    assert.equal(await edits(await reach(t, { 'package.json': pkgOf(script) }, { practices: ['base', 'night', 'ci', 'phases'] }), m0005), null, script);
  }
  // The gate runs it another way: not owed.
  const viaGate = await reach(t, { 'package.json': { name: 'acme', scripts: { test: 'node --test tests/*.test.js', check: 'npm test && node --test tests/keel-*.test.mjs tests/roadmap.test.mjs' } } }, { practices: ['base', 'night', 'ci', 'phases'] });
  assert.equal(await edits(viaGate, m0005), null);
  // Ejected: the project's, not keel's to run.
  const ejected = await reach(t, { 'package.json': pkgOf('node --test tests/*.test.js tests/roadmap.test.mjs') }, { practices: ['base', 'phases'], extra: { ejected: ['tests/keel-generated.test.mjs'] } });
  assert.equal(await edits(ejected, m0005), null);
});

test('0005: with the night on and ci off, the update says how to keep CI\'s test runs; once a workflow of the project\'s keeps them, it is not owed', async t => {
  const local = { practices: ['base', 'night'] };
  const dir = await reach(t, { 'package.json': pkgOf('node --test') }, local);
  const project = await view(dir);
  assert.equal(await m0005.applies(project), true);
  assert.deepEqual(await m0005.up(project), [], 'keel never edits the project\'s own workflows');
  const [note] = await m0005.notes(project);
  for (const said of ['actions/upload-artifact@v7', 'name: keel-test-runs', 'path: .keel/test-runs/', 'include-hidden-files: true', 'if: always()', 'nightly runs only']) assert.ok(note.includes(said), said);
  assert.doesNotMatch(note, /\n\s*\n/, 'no blank line: a commit message would end the note there');
  // In the update: the commit carries it under the migration, and the PR shows it first among the notes.
  const { applied } = await collect(dir, [m0005]);
  assert.deepEqual(applied.map(m => [m.id, m.notes.length]), [['0005-test-ledger-reach', 1]]);
  const message = ['keel update: practice 0.7.0 → 0.8.0', '', `${applied[0].id}: ${applied[0].summary}`, ...noteLines(applied[0].notes)].join('\n');
  assert.deepEqual(notesOf(message), [{ id: '0005-test-ledger-reach', text: note }]);
  const body = updateBody({ from: '0.7.0', to: '0.8.0', message, whatsnew: null, check: 'npm run check', files: [] });
  assert.ok(body.includes(`**To do by hand (migration 0005-test-ledger-reach):** ${note}`), body);
  // The project adds the step: nothing owed.
  await mkdir(join(dir, '.github', 'workflows'), { recursive: true });
  await writeFile(join(dir, '.github', 'workflows', 'test.yml'), `name: test\njobs:\n  test:\n    steps:\n      - run: npm test\n${m0005.UPLOAD_STEP.split('\n').map(l => `      ${l}`).join('\n')}\n`);
  assert.equal(await m0005.applies(await view(dir)), false);
  assert.deepEqual(await m0005.notes(await view(dir)), []);
  // keel's own night workflow keeping them is not the project's CI.
  const nightOnly = await reach(t, { 'package.json': pkgOf('node --test'), '.github/workflows/keel-night.yml': 'name: keel-night # keel-test-runs\n' }, local);
  assert.equal(await m0005.applies(await view(nightOnly)), true);
  // ci on: check.yml keeps them; nothing to say.
  assert.equal(await m0005.applies(await view(await reach(t, { 'package.json': pkgOf('node --test') }))), false, 'nothing owed: applies() is false');
});
