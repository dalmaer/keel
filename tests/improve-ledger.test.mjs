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
import { record } from '../practices/night/files/scripts/keel/test-ledger.mjs';
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
async function put(dir, { tree = 'acmetree1', dirty = false, machine = MACHINE, tests }) {
  const date = new Date(Date.UTC(2026, 9, 1) + (minute++) * 60_000).toISOString();
  await record(dir, { commit: `c-${tree}`, tree, dirty, machine, node: 'v24.21.0', date,
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
  await assertTooFew(dir);
  await put(dir, { tests: { 'an anvil drops': ['pass', 390], 'the roadrunner is caught': ['pass', 10] } });
  let data = await read(dir);
  assert.deepEqual([byId(data, 'flaky_tests').state, byId(data, 'flaky_tests').value], ['outside', 1]);
  assert.deepEqual(byId(data, 'flaky_tests').facts.flaky, [{ file: 'tests/anvils.test.mjs', name: 'the roadrunner is caught', tree: 'acmetree1', passed: 2, failed: 1 }]);
  // Three runs, but the newest has only two before it on its machine: not judged yet.
  assert.equal(byId(data, 'slow_tests').state, 'n/a');
  assert.match(byId(data, 'slow_tests').detail, /earlier recorded runs on linux-x64-4cpu: 2, fewer than the window of 3/);
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

test('a bad .keel/keel.json "tests" breaks both measures; it is never read as a zero', async t => {
  const dir = await acme(t, { window: 1 });
  for (const id of LEDGER) {
    const m = byId(await read(dir), id);
    assert.equal(m.state, 'broken', id);
    assert.match(m.detail, /"tests"\.window must be a whole number of runs, 2 or more/);
  }
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
  const guard = 'if (runs.length < opts.window) return { na: tooFew(runs.length, opts.window) };';
  assert.equal(text.split(guard).length, 3, 'both measures guard on the window');
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
});
