// keel improve reads the test ledger (phase 33): flaky_tests and slow_tests
// from .keel/test-runs (the night fills it from CI's keel-test-runs
// artifacts, then its own gate run adds one), n/a — never zero — with fewer
// runs than the window; and proofs_hold's ledger half, a cited test that did
// not pass in the last recorded run of its file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, mkdir, realpath, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { measure, MEASURES, proposalText } from '../practices/night/files/scripts/keel/improve.mjs';
import { record, junitRun as readJunit, JUNIT } from '../practices/night/files/scripts/keel/test-ledger.mjs';
import { execFileSync } from 'node:child_process';
import { ENV, byId, project } from './helpers/improve.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHIPPED = join(KEEL, 'practices', 'night', 'files', 'scripts', 'keel');
const LEDGER = ['flaky_tests', 'slow_tests'];
const MACHINE = { os: 'linux', arch: 'x64', cpus: 4 };

async function scratch(t, prefix = 'keel-improve-ledger-') {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** An Acme repo with nothing but a config: the ledger measures read .keel/test-runs alone. */
async function acme(t, tests) {
  const dir = await scratch(t);
  await mkdir(join(dir, '.keel'), { recursive: true });
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme', practices: ['base', 'night'], ...(tests ? { tests } : {}) }));
  return dir;
}

let minute = 0;
/** A run as CI's artifacts hold it: tree, machine, one file's tests. */
async function put(dir, { tree = 'acmetree1', dirty = false, machine = MACHINE, config, workflow, lane, tests }) {
  const date = new Date(Date.UTC(2026, 9, 1) + (minute++) * 60_000).toISOString();
  await record(dir, { commit: `c-${tree}`, tree, dirty, machine, node: 'v24.21.0', ...(config ? { config } : {}), ...(lane ? { dir: lane } : {}), date, ...(workflow ? { workflow } : {}),
    tests: Object.entries(tests).map(([name, [outcome, ms]]) => ({ file: 'tests/anvils.test.mjs', name, outcome, ms })) });
}

const read = async (dir, mod = { measure, MEASURES }, ids = LEDGER) => {
  const config = JSON.parse(await readFile(join(dir, '.keel', 'keel.json'), 'utf8'));
  const results = await mod.measure({ root: dir, config, env: ENV, measures: mod.MEASURES.filter(m => ids.includes(m.id)) });
  return { measures: results };
};

/** The two measures read on fewer runs than the window are n/a, with the count; never a zero. */
async function assertTooFew(dir, mod) {
  const data = await read(dir, mod);
  for (const id of LEDGER) {
    const m = byId(data, id);
    assert.equal(m.state, 'n/a', `${id}: ${m.detail}`);
    assert.equal(m.value, null, id);
    assert.match(m.detail, /recorded runs in \.keel\/test-runs: 2, fewer than the window of 3; n\/a until there are 3 .*never a zero/, id);
  }
}

test('flaky_tests and slow_tests are n/a, never zero, with fewer runs than the window; with enough, they name the test', async t => {
  const dir = await acme(t, { window: 3 });
  // None at all: n/a.
  for (const id of LEDGER) assert.equal(byId(await read(dir), id).state, 'n/a', id);
  await put(dir, { tests: { 'an anvil drops': ['pass', 400], 'the roadrunner is caught': ['pass', 10] } });
  await put(dir, { tests: { 'an anvil drops': ['pass', 410], 'the roadrunner is caught': ['fail', 10] } });
  assert.equal(byId(await read(dir), 'flaky_tests').value, 1, 'a confirmed flake needs no minimum history');
  assert.equal(byId(await read(dir), 'slow_tests').state, 'n/a');
  await put(dir, { tests: { 'an anvil drops': ['pass', 390], 'the roadrunner is caught': ['pass', 10] } });
  let data = await read(dir);
  assert.deepEqual([byId(data, 'flaky_tests').state, byId(data, 'flaky_tests').value], ['outside', 1]);
  assert.deepEqual(byId(data, 'flaky_tests').facts.flaky, [{ file: 'tests/anvils.test.mjs', name: 'the roadrunner is caught', tree: 'acmetree1', passed: 2, failed: 1, dir: '.', config: null, setting: null }]);
  // Three runs, but the newest has only two before it on its machine: not judged yet.
  assert.equal(byId(data, 'slow_tests').state, 'n/a');
  assert.match(byId(data, 'slow_tests').detail, /earlier recorded runs on linux-x64-4cpu under config none: 2, fewer than the window of 3/);
  // Tonight's gate run: the anvil at 2.5x and +600 ms.
  await put(dir, { tree: 'acmetree2', tests: { 'an anvil drops': ['pass', 1000], 'the roadrunner is caught': ['pass', 10] } });
  data = await read(dir);
  const slow = byId(data, 'slow_tests');
  assert.deepEqual([slow.state, slow.value], ['outside', 1], slow.detail);
  assert.match(slow.detail, /^tests\/anvils\.test\.mjs "an anvil drops" 1000 ms against 400 ms/);
  assert.match(proposalText(slow), /^Fix or file the slower test tests\/anvils\.test\.mjs "an anvil drops": 1000 ms against a median of 400 ms over its last 3 passing runs \(linux-x64-4cpu\)\. Run it alone: `node --test --test-name-pattern='\^an anvil drops\$' tests\/anvils\.test\.mjs`/);
  // The flaky pair is still among the newest three runs.
  const flaky = byId(data, 'flaky_tests');
  assert.equal(flaky.value, 1);
  assert.match(proposalText(flaky), /^Fix or file the flaky test tests\/anvils\.test\.mjs "the roadrunner is caught": it passed 1, failed 1 on one clean tree \(acmetre\)\. Run it alone: .*Never rerun until green\./);
  // A run from another machine class does not count toward the anvil's history.
  await put(dir, { machine: { ...MACHINE, cpus: 2 }, tests: { 'an anvil drops': ['pass', 3000] } });
  assert.equal(byId(await read(dir), 'slow_tests').state, 'n/a');
});

/** 25 runs on one machine, 20 under one config and the newest 5 under another: the newest has 4 comparable runs before it. */
async function mixedConfigs(t) {
  const dir = await acme(t, { window: 20 });
  for (let i = 0; i < 20; i++) await put(dir, { config: 'acmeclock0', tests: { 'an anvil drops': ['pass', 400] } });
  for (let i = 0; i < 5; i++) await put(dir, { config: 'acmeclock9', tests: { 'an anvil drops': ['pass', 400] } });
  return dir;
}

async function assertMixedNa(dir, mod) {
  const slow = byId(await read(dir, mod, ['slow_tests']), 'slow_tests');
  assert.equal(slow.state, 'n/a', slow.detail);
  assert.equal(slow.value, null);
  assert.match(slow.detail, /earlier recorded runs on linux-x64-4cpu under config acmeclock9: 4, fewer than the window of 20/);
}

test('slow_tests counts the baseline slower() judges by, the same machine AND config: 25 runs on one machine, only 5 under the newest config, is n/a, never a zero', async t => {
  await assertMixedNa(await mixedConfigs(t));
});

test('mutation: counting same-machine runs alone (any config) reads 0 for the mixed history, and fails the n/a test', async t => {
  const dir = await mixedConfigs(t);
  const copy = await scratch(t, 'keel-improve-mutant-');
  await cp(SHIPPED, copy, { recursive: true });
  const file = join(copy, 'improve.mjs');
  const text = await readFile(file, 'utf8');
  const from = "const same = comparable(runs, newest).filter(r => busyState(r) !== 'busy').length;";
  assert.ok(text.includes(from), 'the mutation\'s target is still in the source');
  await writeFile(file, text.replace(from, 'const same = runs.filter(r => r !== newest && machineClass(r.machine) === machine).length;'));
  const mutant = await import(pathToFileURL(file).href);
  await assert.rejects(assertMixedNa(dir, mutant), assert.AssertionError);
});

test('a history of the nights\' own runs only says so: CI does not upload keel-test-runs; one CI or local run among them, and it does not', async t => {
  const dir = await acme(t, { window: 3 });
  for (let i = 0; i < 3; i++) await put(dir, { workflow: 'keel-night', tests: { 'an anvil drops': ['pass', 400] } });
  let data = await read(dir);
  for (const id of LEDGER) assert.match(byId(data, id).detail, /nightly runs only: CI does not upload keel-test-runs/, id);
  assert.equal(byId(data, 'flaky_tests').state, 'ok', 'a note, never a state');
  await put(dir, { workflow: 'check', tests: { 'an anvil drops': ['pass', 400] } });
  data = await read(dir);
  for (const id of LEDGER) assert.doesNotMatch(byId(data, id).detail, /nightly runs only/, id);
  const local = await acme(t, { window: 3 });
  await put(local, { tests: { 'an anvil drops': ['pass', 400] } });
  assert.doesNotMatch(byId(await read(local), 'flaky_tests').detail, /nightly runs only/, 'a local run (no workflow) is not a night\'s');
});

test('a bad .keel/keel.json "tests" breaks both measures; it is never read as a zero', async t => {
  for (const window of [1, 201]) {
    const dir = await acme(t, { window });
    for (const id of LEDGER) {
      const m = byId(await read(dir), id);
      assert.equal(m.state, 'broken', `${id} window ${window}`);
      assert.match(m.detail, /"tests"\.window must be a whole number of runs, 2 to 200/);
    }
  }
});

/** 20 runs at the root, then one of web/'s own suite under the same config: the web run has no baseline. */
async function rootThenWeb(t) {
  const dir = await acme(t, { window: 20 });
  for (let i = 0; i < 20; i++) await put(dir, { config: 'acmeclock0', tests: { 'an anvil drops': ['pass', 400] } });
  await put(dir, { config: 'acmeclock0', lane: 'web', tests: { 'an anvil drops': ['pass', 4000] } });
  return dir;
}

async function assertWebNa(dir, mod) {
  const slow = byId(await read(dir, mod, ['slow_tests']), 'slow_tests');
  assert.equal(slow.state, 'n/a', slow.detail);
  assert.match(slow.detail, /earlier recorded runs on linux-x64-4cpu under config acmeclock0: 0, fewer than the window of 20/);
}

test('slow_tests compares within a lane: 20 root runs and one web/ run under one config is n/a for the web run, never judged against the root', async t => {
  await assertWebNa(await rootThenWeb(t));
});

test('mutation: comparable runs by config alone (any folder) judges the web run against the root, and fails the lane test', async t => {
  const dir = await rootThenWeb(t);
  const copy = await scratch(t, 'keel-improve-mutant-');
  await cp(SHIPPED, copy, { recursive: true });
  const file = join(copy, 'test-ledger.mjs');
  const text = await readFile(file, 'utf8');
  const from = ' && laneOf(r) === laneOf(current));';
  assert.ok(text.includes(from), 'the mutation\'s target is still in the source');
  await writeFile(file, text.replace(from, ' && configOf(r) === configOf(current));'));
  const mutant = await import(pathToFileURL(join(copy, 'improve.mjs')).href);
  await assert.rejects(assertWebNa(dir, mutant), assert.AssertionError);
});

// ---- bun and vitest (phase 59): the ledger's --junit records, read the same way ----

const JUNIT_FIXTURES = join(KEEL, 'tests', 'fixtures', 'junit');
/** The fixture with every failure taken out: the same tests, all passing (or skipped). */
const passing = xml => xml.replace(/<failure\b[^>]*\/>/g, '').replace(/<failure\b[^>]*>[\s\S]*?<\/failure>/g, '');
/** The fixture with slow-ish taking `ms`. */
const slowIsh = (xml, ms) => xml.replace(/(name="slow-ish"[^>]*?time=")[0-9.]+/, `$1${ms / 1000}`);

/** An Acme git repo on one clean commit, its .keel/keel.json among it: the ledger's own runs need a tree. */
async function acmeRepo(t, tests) {
  const dir = await acme(t, tests);
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'acme');
  return dir;
}

/** One run of `runner`, through the ledger's own --junit reading of a fixture variant. */
async function junitRun(dir, runner, xml) {
  await mkdir(join(dir, '.keel', 'test-runs'), { recursive: true });
  await writeFile(join(dir, JUNIT), xml);
  const r = await readJunit({ runner, cwd: dir, start: null, sample: async () => ({ load: [0, 0, 0], cores: 4 }) });
  assert.ok(!r.lines.some(l => /could not|not JUnit|already recorded/.test(l)), r.lines.join('\n'));
  return r;
}

/** A describe's filter is the start of its tests' names; a test's is its whole name. */
const ALONE = { bun: (file, name, end = '$') => `bun test ${file} -t '^ ?${name}${end}'`, vitest: (file, name, end = '$') => `npx vitest run ${file} -t '^ ?${name}${end}'` };

test('flaky_tests and slow_tests read bun and vitest records as they read node\'s, and say each runner\'s run-alone command', async t => {
  for (const runner of ['bun', 'vitest']) {
    const dir = await acmeRepo(t, { window: 3 });
    const red = await readFile(join(JUNIT_FIXTURES, `${runner}.xml`), 'utf8'), green = passing(red);
    await junitRun(dir, runner, slowIsh(green, 30));
    await junitRun(dir, runner, slowIsh(red, 31));
    await junitRun(dir, runner, slowIsh(green, 32));
    let data = await read(dir);
    const flaky = byId(data, 'flaky_tests');
    assert.deepEqual([flaky.state, flaky.value], ['outside', 2], `${runner}: ${flaky.detail}`);
    assert.deepEqual(flaky.facts.flaky.map(f => [f.file, f.name, f.passed, f.failed, f.runner]), [['a.test.ts', 'Acme widgets', 2, 1, runner], ['a.test.ts', 'fails on purpose', 2, 1, runner]]);
    // The run's own setting goes first (NODE_OPTIONS as it was, `env -u` when unset), as a node finding's does.
    assert.ok(proposalText(flaky).includes(` ${ALONE[runner]('a.test.ts', 'Acme widgets', '( |$)')}\`.`), proposalText(flaky));
    assert.equal(byId(data, 'slow_tests').state, 'n/a', 'two runs before the newest: not judged yet');
    // Tonight's run: slow-ish at 900 ms against a median of 31.
    await junitRun(dir, runner, slowIsh(green, 900));
    data = await read(dir);
    const slow = byId(data, 'slow_tests');
    assert.deepEqual([slow.state, slow.value], ['outside', 1], `${runner}: ${slow.detail}`);
    assert.match(slow.detail, /^sub\/b\.test\.ts "slow-ish" 900 ms against 31 ms/);
    assert.equal(slow.facts.slower[0].runner, runner);
    assert.ok(proposalText(slow).includes(` ${ALONE[runner]('sub/b.test.ts', 'slow-ish')}\`.`), proposalText(slow));
  }
});

/** Three node runs and then a bun run of one test, on one tree under one config hash even: never flaky together, never compared. */
async function runnersApart(t) {
  const dir = await acme(t, { window: 3 });
  for (const outcome of ['pass', 'pass', 'pass']) await put(dir, { config: 'acmeclock0', tests: { 'slow-ish': [outcome, 30] } });
  await record(dir, { commit: 'c-acmetree1', tree: 'acmetree1', dirty: false, machine: MACHINE, node: 'v24.21.0', runner: 'bun', config: 'acmeclock0', date: new Date(Date.UTC(2026, 9, 1) + (minute++) * 60_000).toISOString(),
    tests: [{ file: 'tests/anvils.test.mjs', name: 'slow-ish', outcome: 'fail', ms: 900 }, { file: 'tests/anvils.test.mjs', name: 'an anvil drops', outcome: 'pass', ms: 900 }] });
  await record(dir, { commit: 'c-acmetree1', tree: 'acmetree1', dirty: false, machine: MACHINE, node: 'v24.21.0', runner: 'bun', config: 'acmeclock0', date: new Date(Date.UTC(2026, 9, 1) + (minute++) * 60_000).toISOString(),
    tests: [{ file: 'tests/anvils.test.mjs', name: 'slow-ish', outcome: 'pass', ms: 900 }] });
  return dir;
}

async function assertApart(dir, mod) {
  const data = await read(dir, mod);
  const flaky = byId(data, 'flaky_tests');
  assert.deepEqual(flaky.facts.flaky.map(f => [f.name, f.runner]), [['slow-ish', 'bun']], 'flaky within bun\'s own runs; node\'s passes are not its history');
  const slow = byId(data, 'slow_tests');
  assert.equal(slow.state, 'n/a', `the bun run has one bun run before it, never node's three: ${slow.detail}`);
  assert.match(slow.detail, /earlier recorded runs on linux-x64-4cpu under config acmeclock0: 1, fewer than the window of 3/);
}

test('runs of two runners are never compared: node\'s history is not a bun run\'s baseline, nor half of its flake', async t => {
  await assertApart(await runnersApart(t));
});

test('mutation: a lane without the runner judges the bun run against node\'s, and fails the runners test', async t => {
  const dir = await runnersApart(t);
  const copy = await scratch(t, 'keel-improve-mutant-');
  await cp(SHIPPED, copy, { recursive: true });
  const file = join(copy, 'test-ledger.mjs');
  const text = await readFile(file, 'utf8');
  const from = "${runnerOf(r) === 'node' ? '' : `\\u0000${runnerOf(r)}`}`;";
  assert.ok(text.includes(from), 'the mutation\'s target is still in the source');
  await writeFile(file, text.replace(from, '`;'));
  const mutant = await import(pathToFileURL(join(copy, 'improve.mjs')).href);
  await assert.rejects(assertApart(dir, mutant), assert.AssertionError);
});

test('mutation: a ledger measure that returns 0 instead of n/a with too few runs fails the n/a test', async t => {
  const dir = await acme(t, { window: 3 });
  await put(dir, { tests: { 'an anvil drops': ['pass', 400] } });
  await put(dir, { tests: { 'an anvil drops': ['pass', 400] } });
  await assertTooFew(dir);
  // A copy of the shipped scripts with the n/a guard turned into a zero.
  const copy = await scratch(t, 'keel-improve-mutant-');
  await cp(SHIPPED, copy, { recursive: true });
  const file = join(copy, 'improve.mjs');
  const text = await readFile(file, 'utf8');
  const guard = 'if (runs.length < opts.window) return { na: `${tooFew(runs.length, opts.window)}${nightNote(runs)}${busyNote(runs)}` };';
  assert.equal(text.split(guard).length, 2, 'slow tests still require a full baseline');
  await writeFile(file, text.replaceAll(guard, 'if (runs.length < opts.window) return { value: 0, detail: \'fine\' };'));
  const mutant = await import(pathToFileURL(file).href);
  await assert.rejects(assertTooFew(dir, mutant), assert.AssertionError);
});

test('proofs_hold\'s ledger half: a cited test that did not pass in the newest recorded run of its file is proof lost; one in no recorded run is said, not counted', async t => {
  const dir = await project(t);
  const zero = await readFile(join(dir, 'docs', 'phases', '00-first-thing-that-runs.md'), 'utf8');
  const phase = zero.replace(/^---\n[\s\S]*?\n---\n/, ['---', 'status: built', 'since: 2026-10-01', 'goal: G0', 'depends: [0]', 'note: "Acme orders work."', 'evidence: ["evidence/2026-10-01-acme-orders.md"]', '---', ''].join('\n'))
    .replace(/## Acceptance\n\n[\s\S]*?(?=## )/, '## Acceptance\n\n- [x] An anvil is ordered. tests/acme-orders.test.mjs: "orders"\n- [x] A crate ships. tests/acme-crates.test.mjs: "ships"\n\n');
  await mkdir(join(dir, 'docs', 'evidence'), { recursive: true });
  await writeFile(join(dir, 'docs', 'evidence', '2026-10-01-acme-orders.md'), '# Acme orders\n\nOrdered one; it arrived.\n');
  await writeFile(join(dir, 'tests', 'acme-orders.test.mjs'), "import { test } from 'node:test';\ntest('orders an anvil', () => {});\n");
  await writeFile(join(dir, 'tests', 'acme-crates.test.mjs'), "import { test } from 'node:test';\ntest('ships a crate', () => {});\n");
  await writeFile(join(dir, 'docs', 'phases', '01-acme-orders.md'), phase);
  const proofs = async () => byId(await read(dir, undefined, ['proofs_hold']), 'proofs_hold');

  let m = await proofs();
  assert.equal(m.state, 'ok', m.detail);
  assert.match(m.detail, /the ledger half is n\/a: no recorded test run in \.keel\/test-runs$/);

  const at = (outcome, name = 'orders an anvil') => ({ commit: 'c', tree: 't', dirty: false, machine: MACHINE, node: 'v24.21.0', date: new Date(Date.UTC(2026, 9, 2) + (minute++) * 60_000).toISOString(), tests: [{ file: 'tests/acme-orders.test.mjs', name, outcome, ms: 3 }] });
  await record(dir, at('pass'));
  m = await proofs();
  assert.equal(m.state, 'ok', m.detail);
  assert.match(m.detail, /cited tests read against 1 recorded run; tests\/acme-crates\.test\.mjs: "ships" in no recorded run$/);

  await record(dir, at('fail'));
  m = await proofs();
  assert.deepEqual([m.state, m.value], ['outside', 1], m.detail);
  assert.deepEqual(m.facts.found, [{ id: 1, file: '01-acme-orders.md', missing: [], failing: ['tests/acme-orders.test.mjs: "orders"'] }]);
  assert.match(m.detail, /^proof lost: phase 1 \(tests\/acme-orders\.test\.mjs: "orders" did not pass in the last recorded run\)/);
  assert.match(proposalText(m), /^Phase 1 has lost its proof \(tests\/acme-orders\.test\.mjs: "orders" did not pass\): make the test pass, re-point the reference/);

  // Renamed so the cited name runs nowhere in the file: that is not a pass either.
  await record(dir, at('pass', 'sells a rocket'));
  m = await proofs();
  assert.equal(m.value, 1, m.detail);
  await record(dir, at('pass'));
  assert.equal((await proofs()).value, 0, 'passing again, it holds again');

  // A targeted run of a sibling (node leaves the cited test out; the run is narrowed), or one that skipped it, is not proof lost.
  await record(dir, { ...at('pass', 'cancels an order'), filtered: true });
  assert.equal((await proofs()).value, 0, 'a narrowed run that left the cited test out says nothing about it');
  await record(dir, at('skip'));
  assert.equal((await proofs()).value, 0, 'a skip says nothing about it: the newest pass stands');
});

test('night reports busy omissions as unavailable rather than zero slow or flaky findings', async t => {
  const dir = await acme(t, { window: 2 });
  for (const outcome of ['pass', 'fail']) await record(dir, { tree: 'Acme', dirty: false, machine: MACHINE, date: new Date(Date.UTC(2026, 9, 1) + (minute++) * 60000).toISOString(), busy: { start: { load: [100], cores: 4 }, end: { load: [100], cores: 4 } }, tests: [{ file: 'a.test.mjs', name: 'Acme', outcome, ms: 1000 }] });
  const data = await read(dir);
  for (const id of LEDGER) {
    assert.equal(byId(data, id).state, 'n/a');
    assert.match(byId(data, id).detail, /2 busy runs omitted/);
  }
});

test('flaky_tests preserves confirmed quiet findings when a recent busy run is omitted', async t => {
  for (const confirmed of [true, false]) {
    const dir = await acme(t, { window: 3 });
    for (const [i, outcome] of ['pass', confirmed ? 'fail' : 'pass', 'fail'].entries()) {
      const sample = { load: [i === 2 ? 8 : 0], cores: 4 };
      await record(dir, { tree: 'acme-tree', dirty: false, machine: MACHINE, date: `2026-10-01T00:0${i}:00Z`, busy: { start: sample, end: sample },
        tests: [{ file: 'tests/acme.test.mjs', name: 'Acme', outcome, ms: 1 }] });
    }
    const finding = byId(await read(dir), 'flaky_tests');
    assert.match(finding.detail, /1 busy runs omitted/);
    if (confirmed) {
      assert.equal(finding.state, 'outside');
      assert.equal(finding.value, 1);
      assert.equal(finding.facts.flaky[0].passed, 1);
      assert.equal(finding.facts.flaky[0].failed, 1);
    } else {
      assert.equal(finding.state, 'n/a');
      assert.equal(finding.value, null);
    }
  }
});

test('flaky_tests backfills its eligible window and leaves all-busy history unavailable', async t => {
  for (const mode of ['confirmed', 'quiet', 'busy']) {
    const dir = await acme(t, { window: 3 });
    for (let i = 0; i < 5; i++) {
      const sample = { load: [mode === 'busy' || i >= 3 ? 8 : 0], cores: 4 };
      await record(dir, { tree: 'acme-tree', dirty: false, machine: MACHINE, date: `2026-10-01T00:0${i}:00Z`, busy: { start: sample, end: sample },
        tests: [{ file: 'tests/acme.test.mjs', name: 'Acme', outcome: mode === 'confirmed' && i === 0 ? 'fail' : 'pass', ms: 1 }] });
    }
    const finding = byId(await read(dir), 'flaky_tests');
    assert.match(finding.detail, new RegExp(`${mode === 'busy' ? 5 : 2} busy runs omitted`));
    assert.equal(finding.value, mode === 'busy' ? null : mode === 'confirmed' ? 1 : 0);
    if (mode === 'busy') assert.equal(finding.state, 'n/a');
    if (mode === 'confirmed') assert.equal(finding.facts.flaky[0].failed, 1);
  }
});
