// keel prove (phase 62): a fix is proven by its test failing without it. The
// test runs once in a scratch worktree with the fix's files put back as they
// were at the base, and once in the real tree with the fix. The user's working
// tree is byte-identical before and after, whatever the verdict (lesson 54).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, chmod } from 'node:fs/promises';
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
  const j = (() => { try { return r.json(); } catch { return null; } })();
  assert.equal(r.code, code, j?.verdict ? `the verdict was ${j.verdict}: ${j.reason}` : r.out + r.err);
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
  assert.match(red.reason, /^red with the fix: Expected values to be strictly equal: 3 !== 4 \(four anvils\) \(run in a scratch copy of the tree\)$/);
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

test('a project on another runner names it in .keel/keel.json prove.command; an exit code alone never proves, TAP does', async t => {
  const dir = await repo(t);
  await mkdir(join(dir, '.keel'));
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme', prove: { command: 'node {file}' } }));
  await writeFile(join(dir, 'tests', 'plain.mjs'), "import { add } from '../lib/add.mjs';\nif (add(2, 2) !== 4) { console.error('FAIL: 2 + 2 is', add(2, 2)); process.exit(1); }\n");
  const j = await prove(dir, ['tests/plain.mjs', '--fix', 'lib/add.mjs'], 1);
  assert.equal(j.verdict, 'INCONCLUSIVE', 'red then green, but by exit code alone');
  assert.match(j.reason, /read by exit code alone, which cannot tell a failing test from one that never loaded/);
  assert.equal(j.runner, '.keel/keel.json prove.command');
  assert.equal(j.without.first, 'FAIL: 2 + 2 is 0');
  // Codex on #55: the fix adds a module the test imports; without it the command exits non-zero before any test. Never VERIFIED.
  await writeFile(join(dir, 'lib', 'mul.mjs'), 'export const mul = (a, b) => a * b;\n');
  await writeFile(join(dir, 'tests', 'mul.mjs'), "import { mul } from '../lib/mul.mjs';\nif (mul(2, 3) !== 6) process.exit(1);\n");
  assert.equal((await prove(dir, ['tests/mul.mjs', '--fix', 'lib/mul.mjs'], 1)).verdict, 'INCONCLUSIVE');
  // A command that prints TAP ("tap": true) is read as node --test is: a proof, and a load error is told apart.
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme', prove: { command: 'node --import ./tests/setup.mjs --test --test-reporter=tap {file}', tap: true } }));
  assert.equal((await prove(dir, ['tests/add.test.mjs', '--fix', 'lib/add.mjs'], 0)).verdict, 'VERIFIED');
  await writeFile(join(dir, 'tests', 'mul.test.mjs'), "import { test } from 'node:test';\nimport { mul } from '../lib/mul.mjs';\ntest('two by three', () => { if (mul(2, 3) !== 6) throw new Error('no'); });\n");
  const load = await prove(dir, ['tests/mul.test.mjs', '--fix', 'lib/mul.mjs'], 1);
  assert.equal(load.verdict, 'INCONCLUSIVE');
  assert.match(load.reason, /^the test cannot run without the fix: Error \[ERR_MODULE_NOT_FOUND\]/);
  // --name with a command that has no {name}: the whole file would run, so it is refused (Codex on #55).
  const named = keel(['prove', 'tests/plain.mjs', '--name', 'two and two', '--fix', 'lib/add.mjs', '--json'], dir);
  assert.equal(named.code, 2, named.out);
  assert.match(named.json().error, /--name needs \{name\} in \.keel\/keel\.json "prove"\.command/);
});

// ---- what Codex found on #55 ------------------------------------------------

const commitAll = (dir, subject) => { git(dir, ['add', '-A']); git(dir, ['commit', '-q', '-m', subject]); };

test('an ignored file the test reads is in both scratch trees: the test is judged in the environment it has here', async t => {
  const dir = await repo(t);
  await writeFile(join(dir, '.gitignore'), 'fixture.txt\ngenerated/\n');
  commitAll(dir, 'acme: ignore the fixtures');
  await writeFile(join(dir, 'fixture.txt'), '3\n');
  await mkdir(join(dir, 'generated'));
  await writeFile(join(dir, 'generated', 'sum.txt'), '3\n');
  // Here the fixture exists, so the test takes the right branch and never reaches add(): it is green
  // without the fix. Without the ignored fixture it would reach the buggy add(), and read as a proof (Codex on #55).
  await writeFile(join(dir, 'tests', 'fixture.test.mjs'), [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { existsSync, readFileSync } from 'node:fs';",
    "import { add } from '../lib/add.mjs';",
    "test('three anvils', () => { const sum = existsSync('fixture.txt') ? Number(readFileSync('generated/sum.txt', 'utf8')) : add(1, 2); assert.equal(sum, 3); });", ''].join('\n'));
  const j = await prove(dir, ['tests/fixture.test.mjs', '--fix', 'lib/add.mjs'], 1);
  assert.equal(j.verdict, 'NOT WORKING', `the verdict was ${j.verdict}: ${j.reason}`);
  assert.equal(j.reason, 'green without the fix: the test does not catch the bug');
  // More ignored files than keel copies: the environment is not reproduced, so nothing is judged.
  const r = run(process.execPath, [BIN, 'prove', 'tests/fixture.test.mjs', '--fix', 'lib/add.mjs', '--json'], { cwd: dir, env: { ...ENV, TMPDIR: scratchOf.get(dir), KEEL_PROVE_IGNORED_BYTES: '3' } });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).verdict, 'INCONCLUSIVE');
  assert.match(JSON.parse(r.stdout).reason, /^the ignored files are more than 3 bytes, so keel cannot give the test the environment it has here$/);
});

// ---- Codex's third round on #55 --------------------------------------------

test('a fix part committed and part not needs its base named: HEAD would leave the committed part in', async t => {
  const dir = await repo(t);
  // The committed part: a module the test imports. The dirty part: the fix in add().
  await writeFile(join(dir, 'lib', 'add.mjs'), BUGGY);
  await writeFile(join(dir, 'lib', 'two.mjs'), 'export const two = 2;\n');
  commitAll(dir, 'fix: add two (part one)');
  await writeFile(join(dir, 'lib', 'add.mjs'), 'export const add = (a, b) => a + b;\n');
  await writeFile(join(dir, 'tests', 'two.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { two } from '../lib/two.mjs';\nimport { add } from '../lib/add.mjs';\ntest('one and one', () => { assert.equal(add(1, 1), two); });\n");
  const r = keel(['prove', 'tests/two.test.mjs', '--fix', 'lib/two.mjs', 'lib/add.mjs', '--json'], dir);
  assert.equal(r.code, 2, r.out);
  assert.match(r.json().error, /^some --fix paths are committed \(lib\/two\.mjs\) and some are not \(lib\/add\.mjs\): name the commit before the whole fix with --base <ref>/);
  // Named, the whole fix is reverted: the test does not load without it.
  assert.equal((await prove(dir, ['tests/two.test.mjs', '--fix', 'lib/two.mjs', 'lib/add.mjs', '--base', 'HEAD~1'], 1)).verdict, 'INCONCLUSIVE');
  // One directory holding both parts is judged file by file, not as one dirty argument (Codex on #55).
  const whole = keel(['prove', 'tests/two.test.mjs', '--fix', 'lib', '--json'], dir);
  assert.equal(whole.code, 2, whole.out);
  assert.match(whole.json().error, /^some --fix paths are committed \(lib\/two\.mjs\) and some are not \(lib\/add\.mjs\)/);
  assert.equal((await prove(dir, ['tests/two.test.mjs', '--fix', 'lib', '--base', 'HEAD~1'], 1)).verdict, 'INCONCLUSIVE');
  // Only dirty files under it: HEAD, as before.
  await writeFile(join(dir, 'lib', 'add.mjs'), BUGGY);
  commitAll(dir, 'acme: the bug back');
  await writeFile(join(dir, 'lib', 'add.mjs'), 'export const add = (a, b) => a + b;\n');
  assert.equal((await prove(dir, ['tests/two.test.mjs', '--fix', 'lib/add.mjs'], 0)).verdict, 'VERIFIED');
});

test('tests that share a name are never matched by place: a shift between runs is INCONCLUSIVE', async t => {
  const dir = await repo(t);
  // With the fix the first `works` is no longer registered, so the second shifts into its place.
  await writeFile(join(dir, 'tests', 'shift.test.mjs'), [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { add } from '../lib/add.mjs';",
    "if (add(1, 2) !== 3) test('works', () => { assert.equal(add(1, 2), 3); });",
    "test('works', () => { assert.equal(add(0, 0), 0); });", ''].join('\n'));
  const j = await prove(dir, ['tests/shift.test.mjs', '--fix', 'lib/add.mjs'], 1);
  assert.equal(j.verdict, 'INCONCLUSIVE', `the verdict was ${j.verdict}: ${j.reason}`);
  assert.equal(j.reason, 'more than one test is named works, or the count changed with the fix: keel cannot tell them apart across runs; give each its own name');
});

test('the test runs with PWD set to the scratch tree, and its git commands change only the scratch clone', async t => {
  const dir = await repo(t);
  await writeFile(join(dir, 'tests', 'pwd.test.mjs'), [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { writeFileSync } from 'node:fs';",
    "import { execFileSync } from 'node:child_process';",
    "import { add } from '../lib/add.mjs';",
    "test('writes where it stands', () => {",
    "  writeFileSync(`${process.env.PWD}/pwd.txt`, 'x');",
    "  execFileSync('git', ['config', 'acme.touched', 'yes']);",
    "  execFileSync('git', ['tag', 'acme-touched']);",
    "  assert.equal(add(1, 2), 3);",
    "});", ''].join('\n'));
  // The user's shell says where they stand: PWD is the repo, as it would be.
  const before = await treeState(dir);
  const config = () => run('git', ['config', '--local', '--list'], { cwd: dir, env: ENV }).stdout;
  const tags = () => run('git', ['tag', '--list'], { cwd: dir, env: ENV }).stdout;
  const [c0, t0] = [config(), tags()];
  const r = run(process.execPath, [BIN, 'prove', 'tests/pwd.test.mjs', '--fix', 'lib/add.mjs', '--json'], { cwd: dir, env: { ...ENV, PWD: dir, TMPDIR: scratchOf.get(dir) } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(JSON.parse(r.stdout).verdict, 'VERIFIED');
  assert.deepEqual(await treeState(dir), before, 'no pwd.txt in the user\'s tree');
  assert.equal(config(), c0, 'the repository\'s config is unchanged');
  assert.equal(tags(), t0, 'and its tags');
  assert.deepEqual(await readdir(scratchOf.get(dir)), []);
});

test('a test that writes into its tree writes into the scratch tree, never the user\'s', async t => {
  const dir = await repo(t);
  await writeFile(join(dir, 'tests', 'snap.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { writeFileSync } from 'node:fs';\nimport { add } from '../lib/add.mjs';\ntest('snapshots the sum', () => { writeFileSync('tests/sum.snap', String(add(1, 2))); assert.equal(add(1, 2), 3); });\n");
  // prove() asserts the tree is byte-identical: no tests/sum.snap left behind.
  const j = await prove(dir, ['tests/snap.test.mjs', '--fix', 'lib/add.mjs'], 0);
  assert.equal(j.verdict, 'VERIFIED');
});

test('a skipped or todo test did not run: never VERIFIED on a skip', async t => {
  const dir = await repo(t);
  // Skipped once fixed: red without the fix, then skipped (exit 0) with it.
  await writeFile(join(dir, 'tests', 'skip.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../lib/add.mjs';\ntest('three anvils', { skip: add(1, 2) === 3 }, () => { assert.equal(add(1, 2), 3); });\n");
  const only = await prove(dir, ['tests/skip.test.mjs', '--fix', 'lib/add.mjs'], 1);
  assert.equal(only.verdict, 'INCONCLUSIVE', JSON.stringify(only, null, 2));
  assert.equal(only.reason, 'no test ran with the fix: 1 skipped or todo');
  // Beside a test that passes either way: what failed without the fix must pass with it.
  await writeFile(join(dir, 'tests', 'skip.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { add } from '../lib/add.mjs';\ntest('three anvils', { todo: add(1, 2) === 3 }, () => { assert.equal(add(1, 2), 3); });\ntest('zero anvils', () => { assert.equal(add(0, 0), 0); });\n");
  const beside = await prove(dir, ['tests/skip.test.mjs', '--fix', 'lib/add.mjs'], 1);
  assert.equal(beside.verdict, 'INCONCLUSIVE', JSON.stringify(beside, null, 2));
  assert.equal(beside.reason, 'what failed without the fix did not pass with it (skipped, todo or not run): three anvils');
  const entries = tapEntries('ok 1 - a # SKIP\nnot ok 2 - b # TODO\nok 3 - c\n');
  assert.deepEqual(entries.map(e => [e.name, e.directive]), [['a', 'SKIP'], ['b', 'TODO'], ['c', null]]);
});

test('a fix that changes only a file\'s executable bit is reverted and judged', async t => {
  const dir = await repo(t);
  await writeFile(join(dir, 'lib', 'run.sh'), '#!/bin/sh\necho anvil\n', { mode: 0o644 });
  commitAll(dir, 'acme: the run script');
  await chmod(join(dir, 'lib', 'run.sh'), 0o755);
  await writeFile(join(dir, 'tests', 'mode.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { statSync } from 'node:fs';\ntest('the run script is executable', () => { assert.equal(statSync('lib/run.sh').mode & 0o100, 0o100); });\n");
  const j = await prove(dir, ['tests/mode.test.mjs', '--fix', 'lib/run.sh'], 0);
  assert.equal(j.verdict, 'VERIFIED', JSON.stringify(j, null, 2));
});

test('a test file changed by the fix is not run in its old form: INCONCLUSIVE, and why', async t => {
  const dir = await repo(t);
  commitAll(dir, 'fix: add adds');
  // The next fix changes the code and adds an assertion to the existing test.
  await writeFile(join(dir, 'lib', 'add.mjs'), 'export const add = (a, b) => Math.round(a + b);\n');
  await writeFile(join(dir, 'tests', 'add.test.mjs'), `${await readFile(join(dir, 'tests', 'add.test.mjs'), 'utf8')}test('rounds', () => { assert.equal(add(0.4, 0.4), 1); });\n`);
  const j = await prove(dir, ['tests/add.test.mjs', '--fix', 'lib/add.mjs', 'tests/add.test.mjs'], 1);
  assert.equal(j.verdict, 'INCONCLUSIVE');
  assert.equal(j.reason, 'tests/add.test.mjs is part of the fix: without it the old test would run; name only the fixed code in --fix');
  // Naming only the code proves it.
  assert.equal((await prove(dir, ['tests/add.test.mjs', '--fix', 'lib/add.mjs'], 0)).verdict, 'VERIFIED');
});

// ---- Codex's second round on #55 -------------------------------------------

test('tests are matched by their whole identity: a failing test skipped with the fix is not saved by a namesake', async t => {
  const dir = await repo(t);
  await writeFile(join(dir, 'tests', 'twins.test.mjs'), [
    "import { describe, test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { add } from '../lib/add.mjs';",
    "describe('anvils', () => { test('works', { skip: add(1, 2) === 3 }, () => { assert.equal(add(1, 2), 3); }); });",
    "describe('hammers', () => { test('works', () => { assert.equal(add(0, 0), 0); }); });", ''].join('\n'));
  const j = await prove(dir, ['tests/twins.test.mjs', '--fix', 'lib/add.mjs'], 1);
  assert.equal(j.verdict, 'INCONCLUSIVE', `the verdict was ${j.verdict}: ${j.reason}`);
  assert.equal(j.reason, 'what failed without the fix did not pass with it (skipped, todo or not run): anvils > works');
  // Same path twice: told apart by place.
  assert.deepEqual(tapEntries('# Subtest: s\n    # Subtest: w\n    ok 1 - w\n    # Subtest: w\n    not ok 2 - w\nnot ok 1 - s\n').map(e => e.id), ['s > w', 's > w #2', 's']);
});

test('the runner is read from each side\'s tree: a fix to the test script is reverted with the rest', async t => {
  const dir = await repo(t);
  // HEAD: the code is right, but the test script lacks the preload the test needs, so the test is red.
  const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'));
  await writeFile(join(dir, 'package.json'), `${JSON.stringify({ ...pkg, scripts: { test: 'node --test tests/*.test.mjs' } }, null, 2)}\n`);
  commitAll(dir, 'acme: the test, without its preload');
  // The fix is the preload.
  await writeFile(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
  const j = await prove(dir, ['tests/add.test.mjs', '--name', 'adds two anvils', '--fix', 'package.json'], 0);
  assert.equal(j.verdict, 'VERIFIED', `the verdict was ${j.verdict}: ${j.reason}`);
  assert.match(j.without.first, /the preload ran/);
});

test('what a test writes under node_modules stays in the scratch tree; the installed packages still load', async t => {
  const dir = await repo(t);
  await writeFile(join(dir, '.gitignore'), 'node_modules/\n');
  commitAll(dir, 'acme: ignore node_modules');
  await mkdir(join(dir, 'node_modules', 'acme-anvil'), { recursive: true });
  await writeFile(join(dir, 'node_modules', 'acme-anvil', 'package.json'), JSON.stringify({ name: 'acme-anvil', type: 'module', exports: './index.js' }));
  await writeFile(join(dir, 'node_modules', 'acme-anvil', 'index.js'), 'export const weight = 3;\n');
  await writeFile(join(dir, 'tests', 'cache.test.mjs'), [
    "import { test } from 'node:test';",
    "import assert from 'node:assert/strict';",
    "import { mkdirSync, writeFileSync } from 'node:fs';",
    "import { weight } from 'acme-anvil';",
    "import { add } from '../lib/add.mjs';",
    "test('weighs', () => { mkdirSync('node_modules/.cache', { recursive: true }); writeFileSync('node_modules/.cache/acme.txt', 'x'); assert.equal(add(1, 2), weight); });", ''].join('\n'));
  // prove() asserts the tree, node_modules included, is byte-identical after.
  assert.equal((await prove(dir, ['tests/cache.test.mjs', '--fix', 'lib/add.mjs'], 0)).verdict, 'VERIFIED');
});

test('a submodule, clean or dirty, is laid over the scratch tree (its files, not its .git)', async t => {
  const dir = await repo(t);
  const sub = join(dirname(dir), 'sub');
  await mkdir(sub);
  await writeFile(join(sub, 'two.mjs'), 'export const two = 2;\n');
  git(sub, ['init', '-q', '-b', 'main']);
  commitAll(sub, 'sub: two');
  git(dir, ['-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', sub, 'vendor/sub']);
  commitAll(dir, 'acme: vendor the sub');
  await writeFile(join(dir, 'tests', 'sub.test.mjs'), "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { two } from '../vendor/sub/two.mjs';\nimport { add } from '../lib/add.mjs';\ntest('one and one is two', () => { assert.equal(add(1, 1), two); });\n");
  assert.equal((await prove(dir, ['tests/sub.test.mjs', '--fix', 'lib/add.mjs'], 0)).verdict, 'VERIFIED');
  // Dirty: a changed file inside the submodule is listed by git diff as the submodule's path, a directory.
  await writeFile(join(dir, 'vendor', 'sub', 'note.txt'), 'acme\n');
  await writeFile(join(dir, 'vendor', 'sub', 'two.mjs'), 'export const two = 2; // still two\n');
  const j = await prove(dir, ['tests/sub.test.mjs', '--fix', 'lib/add.mjs'], 0);
  assert.equal(j.verdict, 'VERIFIED', JSON.stringify(j, null, 2));
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
