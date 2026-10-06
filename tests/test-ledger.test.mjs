// The test ledger (phase 33): a second node test reporter that remembers
// every run, and says when a test is flaky (both outcomes on one clean tree)
// or slower (above factor × its median AND above a floor). The reporter must
// change nothing about the run it records; each rule is mutation-checked: a
// copy of the module with the rule removed must fail these assertions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { run } from './helpers/run.mjs';
import * as ledger from '../practices/night/files/scripts/keel/test-ledger.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(KEEL, 'practices', 'night', 'files', 'scripts', 'keel', 'test-ledger.mjs');
const { flaky, slower, hygiene, readRuns, record, testsConfigOf, testsConfigProblems, lastOutcome, aloneCommand, preloads, RUNS, DEFAULTS } = ledger;

async function scratch(t, prefix = 'keel-ledger-') {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** The module with one rule edited out, imported fresh: a mutant the assertions must catch. */
async function mutant(t, from, to) {
  const text = await readFile(SOURCE, 'utf8');
  assert.ok(text.includes(from), `the mutation's target is still in the source: ${from}`);
  const dir = await scratch(t, 'keel-ledger-mutant-');
  const file = join(dir, 'test-ledger.mjs');
  await writeFile(file, text.replace(from, to));
  return import(pathToFileURL(file).href);
}

const MACHINE = { os: 'linux', arch: 'x64', cpus: 4 };
let clock = 0;
/** One synthetic run: { tree, dirty, machine, tests: { name: [outcome, ms] } }. */
const runOf = ({ tree = 'acmetree1', dirty = false, machine = MACHINE, tests }) => ({
  commit: `c-${tree}`, tree, dirty, machine, node: 'v24.21.0',
  date: new Date(Date.UTC(2026, 9, 1) + (clock++) * 60_000).toISOString(),
  tests: Object.entries(tests).map(([name, [outcome, ms]]) => ({ file: 'tests/anvils.test.mjs', name, outcome, ms })),
});

// ---- the reporter --------------------------------------------------------------

const ACME_TESTS = `import { test, describe } from 'node:test';
test('an anvil is ordered', () => {});
test('the roadrunner is caught', () => { if (process.env.ACME_FAIL) throw new Error('beep beep'); });
describe('rockets', () => { test('one launches', () => {}); });
test.skip('a skipped crate', () => {});
`;

async function acmeRepo(t) {
  const dir = await scratch(t);
  await mkdir(join(dir, 'tests'), { recursive: true });
  await mkdir(join(dir, 'scripts', 'keel'), { recursive: true });
  await writeFile(join(dir, 'tests', 'acme.test.mjs'), ACME_TESTS);
  await writeFile(join(dir, 'scripts', 'keel', 'test-ledger.mjs'), await readFile(SOURCE, 'utf8'));
  await writeFile(join(dir, '.gitignore'), 'out*.txt\n');
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'acme');
  return { dir, git };
}

const WITH = ['--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=./scripts/keel/test-ledger.mjs', '--test-reporter-destination=stdout'];
const nodeTest = (dir, extra, env = {}) => run(process.execPath, ['--test', ...extra, 'tests/acme.test.mjs'], { cwd: dir, env: { ...process.env, ...env } });
/** Spec output with the timings blanked, so two runs compare. */
const steady = out => out.replace(/\(\d+(\.\d+)?ms\)/g, '(T)').replace(/^ℹ duration_ms .*$/m, 'ℹ duration_ms T');

test('the reporter records every top-level test with outcome and duration, and changes nothing about the run\'s exit code or normal output', async t => {
  const { dir, git } = await acmeRepo(t);
  for (const env of [{}, { ACME_FAIL: '1' }]) {
    const plain = nodeTest(dir, ['--test-reporter=spec'], env);
    const both = nodeTest(dir, WITH, env);
    assert.equal(both.status, plain.status, 'the exit code is the run\'s own');
    const lines = both.stdout.trimEnd().split('\n');
    const at = lines.findIndex(l => l.startsWith('keel test ledger: '));
    assert.ok(at > 0, 'the ledger speaks');
    assert.ok(lines.slice(at + 1).every(l => l.startsWith('  ')), 'once, last: its items are indented under its one line');
    assert.equal(steady(lines.slice(0, at).join('\n')), steady(plain.stdout.trimEnd()), 'spec\'s output is untouched');
    assert.equal(both.stderr, plain.stderr);
  }
  assert.equal(nodeTest(dir, WITH, { ACME_FAIL: '1' }).status, 1, 'a red run stays red');
  assert.equal(nodeTest(dir, WITH).status, 0, 'a green run stays green');

  const { runs } = await readRuns(dir);
  assert.equal(runs.length, 4);
  const head = git('rev-parse', 'HEAD').trim(), tree = git('rev-parse', 'HEAD^{tree}').trim();
  const last = runs.at(-1);
  assert.deepEqual([last.commit, last.tree, last.dirty], [head, tree, false], 'the ledger\'s own directory does not dirty the tree');
  assert.deepEqual(Object.keys(last.machine).sort(), ['arch', 'cpus', 'os']);
  assert.equal(last.node, process.version);
  assert.deepEqual(last.tests.map(x => [x.file, x.name, x.outcome]), [
    ['tests/acme.test.mjs', 'an anvil is ordered', 'pass'],
    ['tests/acme.test.mjs', 'the roadrunner is caught', 'pass'],
    ['tests/acme.test.mjs', 'rockets', 'pass'],
    ['tests/acme.test.mjs', 'a skipped crate', 'skip'],
  ], 'top-level tests only: the describe, not what is inside it');
  assert.ok(last.tests.every(x => Number.isFinite(x.ms) && x.ms >= 0));
  assert.equal(runs.at(-2).tests.find(x => x.name === 'the roadrunner is caught').outcome, 'fail');
  assert.equal(await readFile(join(dir, RUNS, '.gitignore'), 'utf8'), '*\n', 'the directory ignores itself');
  assert.equal(git('status', '--porcelain'), '', 'no project file changes, and the runs are ignored');
  assert.ok((await readdir(join(dir, RUNS))).filter(n => n.endsWith('.json')).every(n => !n.includes(':')), 'no colon in a file name (artifacts refuse one)');
  // Same clean tree, both outcomes: the reporter names it, with the command to run it alone.
  const out = nodeTest(dir, WITH).stdout;
  assert.match(out, /keel test ledger: 1 hygiene item .* fix it or file it; never rerun until green\./);
  assert.match(out, /flaky {3}tests\/acme\.test\.mjs "the roadrunner is caught": passed 3, failed 2 on one clean tree/);
  assert.match(out, /node --test --test-name-pattern='\^the roadrunner is caught\$' tests\/acme\.test\.mjs/);
});

test('a file that cannot load is recorded as the file, failed; a broken ledger directory is one line, never a failed run', async t => {
  const { dir } = await acmeRepo(t);
  await writeFile(join(dir, 'tests', 'acme.test.mjs'), 'this is not javascript (\n');
  assert.equal(nodeTest(dir, WITH).status, 1);
  assert.deepEqual((await readRuns(dir)).runs[0].tests.map(x => [x.file, x.name, x.outcome]), [['tests/acme.test.mjs', 'tests/acme.test.mjs', 'fail']]);
  await writeFile(join(dir, 'tests', 'acme.test.mjs'), ACME_TESTS);
  await rm(join(dir, RUNS), { recursive: true, force: true });
  await writeFile(join(dir, RUNS), 'a file where the directory should be');
  const r = nodeTest(dir, WITH);
  assert.equal(r.status, 0, 'the run is still green');
  assert.match(r.stdout, /keel test ledger: could not record this run \(/);
});

test('a run that executed no test fails, "no tests ran" (an empty file is the file, not a test); allowEmpty lets it pass; a run with one test is untouched', async t => {
  const { dir } = await acmeRepo(t);
  const empty = () => run(process.execPath, ['--test', ...WITH, 'tests/empty.test.mjs'], { cwd: dir, env: { ...process.env } });
  await writeFile(join(dir, 'tests', 'empty.test.mjs'), '// Acme has no tests yet.\n');
  const plain = run(process.execPath, ['--test', '--test-reporter=spec', 'tests/empty.test.mjs'], { cwd: dir, env: { ...process.env } });
  assert.equal(plain.status, 0, 'node alone passes a run of no tests: the shape this gate catches');
  const r = empty();
  assert.equal(r.status, 1, `no tests ran, so the run fails:\n${r.stdout}`);
  assert.ok(r.stdout.trimEnd().endsWith(ledger.NO_TESTS), r.stdout);
  // Only skipped tests: nothing executed either.
  await writeFile(join(dir, 'tests', 'empty.test.mjs'), "import { test } from 'node:test';\ntest.skip('a crate for later', () => {});\n");
  assert.equal(empty().status, 1, 'a run of skipped tests executed none');
  // The project says it has none yet.
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ tests: { allowEmpty: true } }));
  const allowed = empty();
  assert.equal(allowed.status, 0, allowed.stdout);
  assert.doesNotMatch(allowed.stdout, /no tests ran/);
  // A run with tests is untouched.
  await rm(join(dir, '.keel', 'keel.json'));
  const one = nodeTest(dir, WITH);
  assert.equal(one.status, 0);
  assert.doesNotMatch(one.stdout, /no tests ran/);
  assert.equal(ledger.emptyRun(0, { tests: { allowEmpty: 'yes' } }), ledger.NO_TESTS, 'only true allows it');
  assert.ok(testsConfigProblems({ tests: { allowEmpty: 'yes' } }).length);
  assert.deepEqual(testsConfigProblems({ tests: { allowEmpty: true } }), []);

  // Mutation: a reporter that lets a run of nothing pass silently fails this.
  const text = await readFile(SOURCE, 'utf8');
  const target = 'if (empty && !process.exitCode) process.exitCode = 1;';
  assert.ok(text.includes(target));
  await writeFile(join(dir, 'scripts', 'keel', 'test-ledger.mjs'), text.replace(target, ''));
  await writeFile(join(dir, 'tests', 'empty.test.mjs'), '// Acme has no tests yet.\n');
  assert.equal(empty().status, 0, 'the mutant lets a run of nothing pass: the assertion above is what catches it');
});

test('record keeps the newest runs and prunes the rest', async t => {
  const dir = await scratch(t);
  for (let i = 0; i < 5; i++) await record(dir, runOf({ tests: { a: ['pass', 1] } }), { keep: 3 });
  const names = (await readdir(join(dir, RUNS))).filter(n => n.endsWith('.json'));
  assert.equal(names.length, 3);
  const { runs } = await readRuns(dir);
  assert.equal(runs.length, 3);
  assert.ok(runs[0].date < runs[2].date, 'oldest first');
  await writeFile(join(dir, RUNS, 'zz-broken.json'), '{not json');
  assert.equal((await readRuns(dir)).skipped, 1, 'an unreadable record is counted, not believed');
});

// ---- flaky ---------------------------------------------------------------------

const FLAKY_CASES = () => ({
  sameClean: [runOf({ tests: { gate: ['pass', 5] } }), runOf({ tests: { gate: ['fail', 5] } })],
  acrossTrees: [runOf({ tree: 'acmetree1', tests: { gate: ['pass', 5] } }), runOf({ tree: 'acmetree2', tests: { gate: ['fail', 5] } })],
  dirty: [runOf({ dirty: true, tests: { gate: ['pass', 5] } }), runOf({ dirty: true, tests: { gate: ['fail', 5] } })],
  unknown: [runOf({ dirty: null, tree: null, tests: { gate: ['pass', 5] } }), runOf({ dirty: null, tree: null, tests: { gate: ['fail', 5] } })],
});

function assertFlaky(fn) {
  const c = FLAKY_CASES();
  assert.deepEqual(fn(c.sameClean).map(x => [x.name, x.tree, x.passed, x.failed]), [['gate', 'acmetree1', 1, 1]], 'pass and fail on one clean tree is flaky');
  assert.deepEqual(fn(c.acrossTrees), [], 'the same mix across different trees is the code moving, not flaky');
  assert.deepEqual(fn(c.dirty), [], 'on a dirty tree it is not flaky');
  assert.deepEqual(fn(c.unknown), [], 'outside git it is not flaky');
}

test('flaky: one test passing and failing on the same clean tree is named; across trees, or on a dirty tree, it is not', () => {
  assertFlaky(flaky);
});

test('mutations: flaky that ignores the tree, or a dirty tree, fails the flaky test', async t => {
  for (const [from, to] of [
    ['const k = `${r.tree}\\u0000${key(t)}`;', 'const k = key(t);'],
    ["if (r.dirty !== false || !r.tree) continue;", 'if (!r.tree) continue;'],
  ]) {
    const m = await mutant(t, from, to);
    assert.throws(() => assertFlaky(m.flaky), assert.AssertionError, `mutant survived: ${to}`);
  }
});

// ---- slower --------------------------------------------------------------------

/** window passing runs at `base` ms, then one at `now` ms. */
function history(base, now, { window = 3, machine = MACHINE, last = MACHINE } = {}) {
  const runs = [];
  for (let i = 0; i < window; i++) runs.push(runOf({ machine, tests: { drop: ['pass', base] } }));
  runs.push(runOf({ machine: last, tests: { drop: ['pass', now] } }));
  return runs;
}

function assertSlower(fn) {
  const opts = { window: 3, factor: 2, floorMs: 200 };
  const named = fn(history(200, 500, opts), opts); // 2.5x, +300 ms
  assert.deepEqual(named.map(x => [x.name, x.ms, x.median, x.over]), [['drop', 500, 200, 300]], '2.5x its median and +300 ms is slower');
  assert.deepEqual(fn(history(33, 83, opts), opts), [], '2.5x but +50 ms, under the floor, is not news');
  assert.deepEqual(fn(history(400, 700, opts), opts), [], '+300 ms but 1.75x is not slower');
  assert.deepEqual(fn(history(200, 500, { ...opts, last: { ...MACHINE, cpus: 2 } }), opts), [], 'another machine class is not compared');
  assert.deepEqual(fn(history(200, 500, { ...opts, window: 2 }), opts), [], 'fewer passing runs than the window: not judged yet');
}

test('slower: 2.5x its median and +300 ms is named; 2.5x and +50 ms (under the floor) is not; another machine class is not compared', () => {
  assertSlower(slower);
});

test('mutation: dropping the floor fails the slower test', async t => {
  const m = await mutant(t, 't.ms > factor * m && t.ms - m > floorMs', 't.ms > factor * m');
  assert.throws(() => assertSlower(m.slower), assert.AssertionError);
});

// ---- the hygiene block, the config, the cited-test reading ----------------------

test('the hygiene block: one line when clean; each item with its history and the command to run it alone', () => {
  const opts = { window: 3, factor: 2, floorMs: 200 };
  const clean = hygiene(history(200, 210, opts), opts);
  assert.equal(clean.length, 1);
  assert.match(clean[0], /^keel test ledger: no flaky or slower test \(4 runs in \.keel\/test-runs\)\.$/);
  const block = hygiene(history(200, 500, opts), opts, { preload: ['--import', './tests/helpers/hermetic.mjs'] });
  assert.match(block[0], /^keel test ledger: 1 hygiene item \(4 runs/);
  assert.match(block[1], /^ {2}slower {2}tests\/anvils\.test\.mjs "drop": 500 ms against a median of 200 ms over its last 3 passing runs \(linux-x64-4cpu\), \+300 ms$/);
  assert.equal(block[2].trim(), "node --import ./tests/helpers/hermetic.mjs --test --test-name-pattern='^drop$' tests/anvils.test.mjs");
  assert.equal(aloneCommand({ file: 'tests/a.test.mjs', name: "Acme's (x) $1" }), "node --test --test-name-pattern='^Acme'\\''s \\(x\\) \\$1$' tests/a.test.mjs");
  assert.deepEqual(preloads(['--import', './h.mjs', '--test', '--require=./r.cjs', '--test-reporter=spec']), ['--import', './h.mjs', '--require=./r.cjs']);
});

test('.keel/keel.json "tests" overrides window, factor and floorMs, and a bad value is named', () => {
  assert.deepEqual(testsConfigOf({}), DEFAULTS);
  assert.deepEqual(DEFAULTS, { window: 20, factor: 2, floorMs: 200 });
  assert.deepEqual(testsConfigOf({ tests: { window: 5, floorMs: 50 } }), { window: 5, factor: 2, floorMs: 50 });
  for (const tests of [[], 'x', { window: 1 }, { window: 2.5 }, { factor: 1 }, { floorMs: -1 }, { acme: 1 }]) {
    assert.ok(testsConfigProblems({ tests }).length, JSON.stringify(tests));
    assert.throws(() => testsConfigOf({ tests }), /\.keel\/keel\.json: "tests"/);
  }
});

test('lastOutcome: the newest run of a file, and its tests whose name is or contains the cited one', () => {
  const runs = [runOf({ tests: { 'pick a phase': ['pass', 1] } }), runOf({ tests: { 'pick a phase': ['fail', 1] } })];
  runs.push({ ...runOf({ tests: {} }), tests: [{ file: 'tests/other.test.mjs', name: 'x', outcome: 'pass', ms: 1 }] });
  const last = lastOutcome(runs, 'tests/anvils.test.mjs', 'pick');
  assert.deepEqual(last.matched.map(x => x.outcome), ['fail'], 'the newest run that ran the file, not the newest run');
  assert.deepEqual(lastOutcome(runs, 'tests/anvils.test.mjs', 'nothing like it').matched, []);
  assert.equal(lastOutcome(runs, 'tests/never.test.mjs', 'x'), null);
});
