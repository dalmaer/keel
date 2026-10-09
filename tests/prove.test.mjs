// keel prove (phase 62): a fix is proven by its test failing without it. The
// test runs once in a scratch worktree with the fix's files put back as they
// were at the base, and once in the real tree with the fix. The user's working
// tree is byte-identical before and after, whatever the verdict (lesson 54).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './helpers/run.mjs';
import { ENV, git, acmeRepo, treeState, BUGGY } from './helpers/prove.mjs';
import { tapEntries, readNodeRun, nodePreloads } from '../lib/prove.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
// Each repo's keel prove gets its own TMPDIR, so "no scratch tree is left" reads only its own.
const scratchOf = new Map();
const keel = (args, cwd) => {
  const r = run(process.execPath, [BIN, ...args], { cwd, env: { ...ENV, ...(scratchOf.has(cwd) ? { TMPDIR: scratchOf.get(cwd) } : {}) } });
  return { code: r.status, out: r.stdout, err: r.stderr, json: () => JSON.parse(r.stdout) };
};

async function repo(t) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-prove-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'tmp'));
  const acme = await acmeRepo(join(dir, 'acme'));
  scratchOf.set(acme, join(dir, 'tmp'));
  return acme;
}

/** keel prove in dir, asserting the working tree (and git's view of it) is the same after; the JSON. */
async function prove(dir, args, code) {
  const before = await treeState(dir);
  const r = keel(['prove', ...args, '--json'], dir);
  assert.deepEqual(await treeState(dir), before, 'the working tree is byte-identical after keel prove');
  assert.deepEqual(await readdir(scratchOf.get(dir)), [], 'the scratch worktree is removed');
  assert.equal(r.code, code, r.out + r.err);
  assert.equal(r.err, '');
  return r.json();
}

test('VERIFIED: the test fails without the fix (the failure recorded) and passes with it; the tree is untouched', async t => {
  const dir = await repo(t);
  const j = await prove(dir, ['tests/add.test.mjs', '--fix', 'lib/add.mjs'], 0);
  assert.equal(j.verdict, 'VERIFIED', JSON.stringify(j, null, 2));
  assert.equal(j.base, git(dir, ['rev-parse', '--short=7', 'HEAD']), 'an uncommitted fix is reverted to HEAD');
  assert.equal(j.runner, 'package.json test script');
  assert.equal(j.without.red, true);
  assert.equal(j.without.loadError, false);
  assert.match(j.without.first, /^Expected values to be strictly equal: -1 !== 3 \(adds two anvils\)$/);
  assert.equal(j.without.failure[0], 'not ok - adds two anvils');
  assert.equal(j.with.red, false);
  assert.equal(j.with.tests, 2, 'both tests ran with the fix, the preload with them');
  assert.equal(await readFile(join(dir, 'lib', 'add.mjs'), 'utf8') !== BUGGY, true);
});

test('VERIFIED for a committed fix: the base defaults to HEAD\'s parent; --base names another', async t => {
  const dir = await repo(t);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'fix: add adds']);
  const j = await prove(dir, ['tests/add.test.mjs', '--fix', 'lib/add.mjs'], 0);
  assert.equal(j.verdict, 'VERIFIED');
  assert.equal(j.base, git(dir, ['rev-parse', '--short=7', 'HEAD~1']));
  // --base HEAD: the fix is the same there as in the tree, so nothing is reverted.
  const same = await prove(dir, ['tests/add.test.mjs', '--fix', 'lib/add.mjs', '--base', 'HEAD'], 1);
  assert.equal(same.verdict, 'INCONCLUSIVE');
  assert.match(same.reason, /the fix's files are the same at [0-9a-f]{7} as in the tree: nothing to revert/);
});

test('NOT WORKING: green without the fix (the test does not catch the bug), or red with it', async t => {
  const dir = await repo(t);
  // add(0, 0) is 0 with the bug too.
  const green = await prove(dir, ['tests/add.test.mjs', '--name', 'zero anvils', '--fix', 'lib/add.mjs'], 1);
  assert.equal(green.verdict, 'NOT WORKING');
  assert.match(green.reason, /^green without the fix: the test does not catch the bug$/);
  assert.equal(green.without.red, false);
  assert.equal(green.with.tests, 1, '--name ran the one test');
  await writeFile(join(dir, 'tests', 'wrong.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../lib/add.mjs';\ntest('four anvils', () => { assert.equal(add(1, 2), 4); });\n");
  const red = await prove(dir, ['tests/wrong.test.mjs', '--fix', 'lib/add.mjs'], 1);
  assert.equal(red.verdict, 'NOT WORKING');
  assert.match(red.reason, /^red with the fix: Expected values to be strictly equal: 3 !== 4 \(four anvils\)$/);
});

test('INCONCLUSIVE: the test cannot load without the fix, its file is the fix, or no test matched --name', async t => {
  const dir = await repo(t);
  // The fix adds a module the test imports: without it, the test file does not load.
  await mkdir(join(dir, 'lib'), { recursive: true });
  await writeFile(join(dir, 'lib', 'mul.mjs'), 'export const mul = (a, b) => a * b;\n');
  await writeFile(join(dir, 'tests', 'mul.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { mul } from '../lib/mul.mjs';\ntest('two by three', () => { assert.equal(mul(2, 3), 6); });\n");
  const load = await prove(dir, ['tests/mul.test.mjs', '--fix', 'lib/mul.mjs'], 1);
  assert.equal(load.verdict, 'INCONCLUSIVE', JSON.stringify(load, null, 2));
  assert.equal(load.without.loadError, true);
  assert.match(load.reason, /^the test cannot run without the fix: Error \[ERR_MODULE_NOT_FOUND\]: Cannot find module/);
  assert.doesNotMatch(load.reason, /keel-prove-/, 'the scratch path is not in the reason');
  // The test file is itself part of the fix, and did not exist at the base.
  const own = await prove(dir, ['tests/add.test.mjs', '--fix', 'lib/add.mjs', 'tests/add.test.mjs'], 1);
  assert.equal(own.verdict, 'INCONCLUSIVE');
  assert.match(own.reason, /^tests\/add\.test\.mjs does not exist without the fix/);
  const none = await prove(dir, ['tests/add.test.mjs', '--name', 'no such anvil', '--fix', 'lib/add.mjs'], 1);
  assert.equal(none.verdict, 'INCONCLUSIVE');
  assert.equal(none.reason, 'no test matched --name no such anvil');
});

test('--trailer prints the Proven-by: line; --evidence appends it, dated, to the phase\'s evidence file', async t => {
  const dir = await repo(t);
  const r = keel(['prove', 'tests/add.test.mjs', '--fix', 'lib/add.mjs', '--trailer'], dir);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^VERIFIED: tests\/add\.test\.mjs — red without the fix, green with it$/m);
  const trailer = 'Proven-by: tests/add.test.mjs — VERIFIED — "Expected values to be strictly equal: -1 !== 3 (adds two anvils)"';
  assert.ok(r.out.trimEnd().split('\n').includes(trailer), r.out);
  // A trailer git reads as one.
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'fix: add adds', '-m', trailer]);
  assert.equal(git(dir, ['log', '-1', '--format=%(trailers:key=Proven-by,valueonly)']), trailer.slice('Proven-by: '.length));
  // A NOT WORKING verdict carries its reason in the trailer, not a failure it never saw.
  const nw = keel(['prove', 'tests/add.test.mjs', '--name', 'zero anvils', '--fix', 'lib/add.mjs', '--trailer', '--json'], dir).json();
  assert.equal(nw.trailer, 'Proven-by: tests/add.test.mjs (zero anvils) — NOT WORKING — "green without the fix: the test does not catch the bug"');
  // --evidence: the phase's evidence file, from its front matter.
  await mkdir(join(dir, '.keel'));
  await mkdir(join(dir, 'docs', 'phases'), { recursive: true });
  await mkdir(join(dir, 'docs', 'evidence'), { recursive: true });
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme', practices: ['phases', 'evidence'] }));
  await writeFile(join(dir, 'docs', 'goals.json'), JSON.stringify([{ id: 'G0', title: 'Anvils', outcome: 'Anvils add up.' }]));
  await writeFile(join(dir, 'docs', 'phases', '07-anvils.md'), '---\nstatus: partial\nsince: 2026-01-05\ngoal: G0\ndepends: []\nnote: "Acme anvils."\nevidence: ["evidence/2026-01-05-anvils.md"]\n---\n\n# Anvils add up\n');
  await writeFile(join(dir, 'docs', 'phases', '08-bare.md'), '---\nstatus: planned\nsince: 2026-01-05\ngoal: G0\ndepends: []\nnote: "Acme."\nevidence: []\n---\n\n# Bare\n');
  await writeFile(join(dir, 'docs', 'evidence', '2026-01-05-anvils.md'), '# Evidence: 7 — anvils add up\n');
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'acme: the record']);
  const ev = keel(['prove', 'tests/add.test.mjs', '--fix', 'lib/add.mjs', '--base', 'HEAD~2', '--evidence', '7', '--json'], dir);
  assert.equal(ev.code, 0, ev.out + ev.err);
  assert.equal(ev.json().evidence, 'docs/evidence/2026-01-05-anvils.md');
  const text = await readFile(join(dir, 'docs', 'evidence', '2026-01-05-anvils.md'), 'utf8');
  assert.match(text, /^# Evidence: 7 — anvils add up\n- \*\*\d{4}-\d{2}-\d{2}\*\* — Proven-by: tests\/add\.test\.mjs — VERIFIED — "Expected values to be strictly equal: -1 !== 3 \(adds two anvils\)" \(fix: lib\/add\.mjs; base [0-9a-f]{7}\)\n$/);
  // A phase with no evidence file is told how to make one; nothing is written.
  const bare = keel(['prove', 'tests/add.test.mjs', '--fix', 'lib/add.mjs', '--base', 'HEAD~2', '--evidence', '8', '--json'], dir);
  assert.equal(bare.code, 2);
  assert.match(bare.json().error, /phase 8 names no evidence file: create one from docs\/templates\/evidence\.md/);
});

test('a project on another runner names it in .keel/keel.json prove.command; keel reads its exit code', async t => {
  const dir = await repo(t);
  await mkdir(join(dir, '.keel'));
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme', prove: { command: 'node {file}' } }));
  await writeFile(join(dir, 'tests', 'plain.mjs'), "import { add } from '../lib/add.mjs';\nif (add(2, 2) !== 4) { console.error('FAIL: 2 + 2 is', add(2, 2)); process.exit(1); }\n");
  const j = await prove(dir, ['tests/plain.mjs', '--fix', 'lib/add.mjs'], 0);
  assert.equal(j.verdict, 'VERIFIED');
  assert.equal(j.runner, '.keel/keel.json prove.command');
  assert.equal(j.without.first, 'FAIL: 2 + 2 is 0');
});

test('usage: the test and --fix are required, and keel prove runs in a git repository', async t => {
  const dir = await repo(t);
  for (const [args, want] of [[['tests/add.test.mjs'], /--fix names the fix's files/], [['--fix', 'lib/add.mjs'], /keel prove <test file>/],
    [['tests/none.test.mjs', '--fix', 'lib/add.mjs'], /no test file tests\/none\.test\.mjs/], [['tests/add.test.mjs', '--fix'], /--fix needs the paths/],
    [['tests/add.test.mjs', '--fix', '../elsewhere.mjs'], /outside the repository/]]) {
    const r = keel(['prove', ...args, '--json'], dir);
    assert.equal(r.code, 2, `${args.join(' ')}: ${r.out}`);
    assert.match(r.json().error, want);
  }
  const outside = await mkdtemp(join(tmpdir(), 'keel-prove-test-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'a.test.mjs'), '');
  const r = keel(['prove', 'a.test.mjs', '--fix', 'a.mjs', '--json'], outside);
  assert.equal(r.code, 2);
  assert.match(r.json().error, /runs in a git repository/);
});

test('the runner and the TAP reader: preloads from the test script, a load error, a nested failure', () => {
  assert.deepEqual(nodePreloads('node --import ./tests/helpers/hermetic.mjs --test --test-reporter=spec tests/*.test.mjs'), ['--import', './tests/helpers/hermetic.mjs']);
  assert.deepEqual(nodePreloads('npm run build && node --require=./a.cjs -r ./b.cjs --test'), ['--require=./a.cjs', '-r', './b.cjs']);
  assert.equal(nodePreloads('vitest run'), null);
  const nested = ['TAP version 13', '# Subtest: anvils', '    # Subtest: drops', '    not ok 1 - drops', '      ---', "      failureType: 'testCodeFailure'", '      error: |-', '        Expected values to be strictly equal:', '        ', '        1 !== 2', '        ', "      code: 'ERR_ASSERTION'", '      ...', '    1..1', 'not ok 1 - anvils', '  ---', "  failureType: 'subtestsFailed'", "  error: '1 subtest failed'", '  ...', '1..1'].join('\n');
  assert.deepEqual(tapEntries(nested).map(e => [e.name, e.ok, e.depth, e.failureType]), [['drops', false, 1, 'testCodeFailure'], ['anvils', false, 0, 'subtestsFailed']]);
  const seen = readNodeRun({ exit: 1, output: nested }, 'tests/a.test.mjs');
  assert.deepEqual(seen.failures.map(f => [f.name, f.error]), [['drops', ['Expected values to be strictly equal:', '1 !== 2']]]);
  assert.equal(seen.loadError, false);
  const load = ['# SyntaxError: The requested module \'./add.mjs\' does not provide an export named \'add\'', '# Subtest: tests/a.test.mjs', 'not ok 1 - tests/a.test.mjs', '  ---', "  failureType: 'testCodeFailure'", '  exitCode: 1', "  error: 'test failed'", '  ...'].join('\n');
  const l = readNodeRun({ exit: 1, output: load }, 'tests/a.test.mjs');
  assert.equal(l.loadError, true);
  assert.equal(l.reason, "SyntaxError: The requested module './add.mjs' does not provide an export named 'add'");
  assert.equal(l.ran, 0);
});
