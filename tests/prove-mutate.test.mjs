// keel prove --mutate (phase 84): a fix's test is shown to catch plausible wrong versions of the fix. Five
// mechanical mutators on the fix's changed lines only, each mutant alone in a scratch copy; a passing
// baseline first; caught only when a selected test fails; invalid and inconclusive apart, never caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './helpers/run.mjs';
import { ENV, git, treeState } from './helpers/prove.mjs';
import { mutantsOf, applyMutant, chooseMutants, codeMask, KINDS, MAX_MUTANTS } from '../lib/mutate.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');

const TESTHEAD = ["import { test } from 'node:test';", "import assert from 'node:assert/strict';"];
const FITS_BASE = ['export function fits(n, limit) {', '  return n <= limit;', '}', ''].join('\n');
// Unchanged by the fix, and full of what keel would mutate: none of it may be.
const NEAR = ['export function near(a, b) {', '  if (a > b && b > 0) return a - b < 2;', '  return b - a < 2;', '}', ''].join('\n');
const FITS_FIX = ['export function fits(n, limit) {', '  if (n < 0 || n > limit - 1) return false;', '  return true;', '}', ''].join('\n');
const FITS_TEST = [...TESTHEAD, "import { fits } from '../lib/fits.mjs';",
  "test('strong: the edges', () => { assert.equal(fits(-1, 3), false); assert.equal(fits(0, 3), true); assert.equal(fits(2, 3), true); assert.equal(fits(3, 3), false); });",
  "test('weak: far from the edges', () => { assert.equal(fits(-5, 3), false); assert.equal(fits(1, 3), true); });", ''].join('\n');
// Red with the fix: the baseline fails.
const WRONG_TEST = [...TESTHEAD, "import { fits } from '../lib/fits.mjs';", "test('wrong: zero does not fit', () => { assert.equal(fits(0, 3), false); });", ''].join('\n');

/**
 * dir as an Acme git repo: `base` committed, then `fix` and `tests` written over it, uncommitted. Its own
 * TMPDIR, so the test can see that every scratch copy is removed.
 */
async function fixRepo(t, { base, fix, tests }) {
  const top = await mkdtemp(join(tmpdir(), 'keel-mutate-test-'));
  t.after(() => rm(top, { recursive: true, force: true }));
  const dir = join(top, 'acme'), scratch = join(top, 'tmp');
  await mkdir(scratch);
  const write = async files => { for (const [p, s] of Object.entries(files)) { await mkdir(dirname(join(dir, p)), { recursive: true }); await writeFile(join(dir, p), s); } };
  await write({ 'package.json': `${JSON.stringify({ name: 'acme', type: 'module', scripts: { test: 'node --test tests/*.test.mjs' } }, null, 2)}\n`, ...base });
  git(dir, ['init', '-q', '-b', 'main']);
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'acme: before the fix']);
  await write({ ...fix, ...tests });
  return { dir, scratch };
}

/** keel prove --mutate in the repo, the tree byte-identical after and no scratch copy left: the JSON (and with `withText`, a second run's text). */
async function mutate(repo, args, code, { env = {}, withText = false } = {}) {
  const before = await treeState(repo.dir);
  const r = run(process.execPath, [BIN, 'prove', ...args, '--mutate', '--json'], { cwd: repo.dir, env: { ...ENV, TMPDIR: repo.scratch, ...env } });
  assert.deepEqual(await treeState(repo.dir), before, 'the working tree is byte-identical after keel prove --mutate');
  assert.deepEqual(await readdir(repo.scratch), [], 'every scratch copy is removed');
  assert.equal(r.status, code, r.stdout + r.stderr);
  assert.equal(r.stderr, '');
  const text = withText ? run(process.execPath, [BIN, 'prove', ...args, '--mutate'], { cwd: repo.dir, env: { ...ENV, TMPDIR: repo.scratch, ...env } }).stdout : null;
  return { j: JSON.parse(r.stdout), text };
}

const fits = t => fixRepo(t, { base: { 'lib/fits.mjs': FITS_BASE + NEAR }, fix: { 'lib/fits.mjs': FITS_FIX + NEAR }, tests: { 'tests/fits.test.mjs': FITS_TEST, 'tests/wrong.test.mjs': WRONG_TEST } });
const where = m => `${m.file}:${m.line} ${m.kind} ${m.mutation}`;

// ---- the mutators -----------------------------------------------------------

test('each of the five mutators makes its mutation on the lines asked, one change per mutant', () => {
  const src = ['function f(a, b) {', '  if (a < b && b >= 2) return a === 1;', '  while (a > 0 || b !== 3) a--;', '  return a <= b;', '}', ''].join('\n');
  const ms = mutantsOf(src, [2, 3, 4]);
  assert.deepEqual([...new Set(ms.map(m => m.kind))].sort(), [...KINDS].sort(), 'all five kinds');
  const on2 = ms.filter(m => m.line === 2).map(m => `${m.kind} ${m.from}→${m.to}`);
  assert.deepEqual(on2, ['return →return; ', 'condition a < b && b >= 2→!(a < b && b >= 2)', 'condition a < b && b >= 2→true',
    'comparison <→<=', 'logical &&→||', 'comparison >=→>', 'number 2→3', 'comparison ===→!==', 'number 1→2']);
  assert.ok(ms.some(m => m.line === 3 && m.kind === 'logical' && m.from === '||' && m.to === '&&'));
  assert.ok(ms.some(m => m.line === 3 && m.kind === 'comparison' && m.from === '!==' && m.to === '==='));
  assert.ok(ms.some(m => m.line === 3 && m.kind === 'comparison' && m.from === '>' && m.to === '>='));
  assert.equal(ms.some(m => m.line === 1 || m.line === 5), false, 'only the lines asked');
  // Applied alone: each mutant's source differs from the original on its line only, by its one change.
  const lines = src.split('\n');
  for (const m of ms) {
    const out = applyMutant(src, m).split('\n');
    assert.equal(out.length, lines.length);
    out.forEach((l, k) => { if (k !== m.line - 1) assert.equal(l, lines[k]); });
    const t = lines[m.line - 1];
    assert.equal(out[m.line - 1], t.slice(0, m.column - 1) + m.to + t.slice(m.column - 1 + m.from.length), where(m));
  }
});

test('strings, comments, templates and regular expressions are never mutated; nor arrows, shifts or generics', () => {
  const src = ["function g(x) {", "  const s = 'a < b && 1';", '  const t = `x > ${x || 2}`; // if (x === 1) && 3', '  /* x < 1 */ const r = /a|b{2}/.test(s);',
    '  const h = (y) => y << 2 >> 1;', '  const m = new Map<string, number>();', '}', ''].join('\n');
  const ms = mutantsOf(src, [2, 3, 4, 5, 6]);
  // Line 4 starts in a comment, so no early return there either.
  assert.deepEqual(ms.map(m => `${m.line} ${m.kind} ${m.from}`), ['2 return ', '3 return ', '5 return ', '5 number 2', '5 number 1', '6 return '],
    'only code: the numbers of the shifts, and the early returns');
  const mask = codeMask("a / b; c = /x/g;");
  assert.equal(mask[2], 1, 'a division is code');
  assert.equal(mask[11], 0, 'a regular expression is not');
});

test('a return early is made only where a statement starts inside a block', () => {
  const src = ['export const LIMIT = 3;', 'export function h(a) {', '  const o = {', '    k: 1,', '    j: 2,', '  };', '  return a', '    .map(x => x);', '}', ''].join('\n');
  const returns = mutantsOf(src, [1, 2, 3, 4, 5, 6, 7, 8]).filter(m => m.kind === 'return').map(m => m.line);
  // Line 1 is the module's (depth 0); line 4 follows `{` (an object literal: the mutant will not parse, and is reported invalid);
  // line 5 follows `,`; line 6 is `}`; line 8 continues line 7.
  assert.deepEqual(returns, [3, 4, 7]);
});

test(`at most ${MAX_MUTANTS} mutants, spread evenly over the changed lines`, () => {
  const per = (n, k) => Array.from({ length: n }, (_, l) => Array.from({ length: k }, (_, c) => ({ file: 'lib/a.mjs', line: l + 1, column: c + 1 }))).flat();
  // More lines than the budget: evenly spaced lines, one mutant each.
  const wide = chooseMutants(per(100, 3));
  assert.equal(wide.length, MAX_MUTANTS);
  assert.equal(new Set(wide.map(m => m.line)).size, MAX_MUTANTS, 'one per line');
  assert.ok(wide[0].line <= 3 && wide.at(-1).line >= 97, `from the first lines to the last: ${wide[0].line}..${wide.at(-1).line}`);
  const gaps = wide.slice(1).map((m, i) => m.line - wide[i].line);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, `evenly: gaps ${[...new Set(gaps)]}`);
  // Fewer lines than the budget: every line in turn, so each line gets its share.
  const deep = chooseMutants(per(7, 20));
  assert.equal(deep.length, MAX_MUTANTS);
  const counts = Object.values(Object.groupBy(deep, m => m.line)).map(g => g.length);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `each line ${counts}`);
  assert.equal(chooseMutants(per(2, 3)).length, 6, 'under the budget, every mutant');
});

// ---- the runs ---------------------------------------------------------------

test('a strong test catches every mutant of the fix, each of the five kinds applied alone in a scratch copy; the tree is untouched', async t => {
  const repo = await fits(t);
  const { j, text } = await mutate(repo, ['tests/fits.test.mjs', '--fix', 'lib/fits.mjs'], 0, { withText: true });
  assert.equal(j.verdict, 'VERIFIED', j.reason);
  const m = j.mutate;
  assert.equal(m.status, 'ran', m.reason);
  assert.deepEqual(m.changed, [{ file: 'lib/fits.mjs', lines: [2, 3] }], 'the diff from the base: the two lines the fix wrote');
  assert.deepEqual([...new Set(m.mutants.map(x => x.kind))].sort(), [...KINDS].sort(), 'all five kinds ran');
  assert.equal(m.total, 9);
  assert.equal(m.caught, 9, JSON.stringify(m.mutants.filter(x => x.result !== 'caught'), null, 2));
  assert.deepEqual([m.survivors, m.invalid, m.inconclusive], [[], [], []]);
  assert.ok(m.mutants.every(x => x.result === 'caught' && x.reason), 'each caught by a named failure');
  assert.equal(m.baseline.red, false);
  assert.equal(m.baseline.tests, 2);
  assert.equal(m.line, 'Mutants: 9/9');
  assert.match(text, /^ {2}mutants: 9\/9 caught on 2 changed lines; each run limited to \d+(\.\d+)?s$/m);
});

test('a weak test leaves named survivors: file, line and mutation; --name picks the test', async t => {
  const repo = await fits(t);
  const { j, text } = await mutate(repo, ['tests/fits.test.mjs', '--name', 'weak', '--fix', 'lib/fits.mjs'], 0, { withText: true });
  assert.equal(j.verdict, 'VERIFIED', 'survivors never fail the proof');
  const m = j.mutate;
  assert.equal(m.baseline.tests, 1, '--name ran the one test');
  assert.deepEqual(m.survivors.map(where), ['lib/fits.mjs:2 comparison `<` → `<=`', 'lib/fits.mjs:2 number `0` → `1`',
    'lib/fits.mjs:2 comparison `>` → `>=`', 'lib/fits.mjs:2 number `1` → `2`']);
  assert.equal(m.caught, 5);
  assert.equal(m.total, 9);
  assert.match(text, /^ {2}mutants: 5\/9 caught \(4 survivors\)/m);
  assert.match(text, /^ {4}survivor {5}lib\/fits\.mjs:2 — comparison `<` → `<=`$/m);
  // The strong test, by name, catches them all.
  assert.equal((await mutate(repo, ['tests/fits.test.mjs', '--name', 'strong', '--fix', 'lib/fits.mjs'], 0)).j.mutate.caught, 9);
});

test('a failing baseline stops the run: no mutant is judged against a fix that does not pass', async t => {
  const repo = await fits(t);
  const { j, text } = await mutate(repo, ['tests/wrong.test.mjs', '--fix', 'lib/fits.mjs'], 1, { withText: true });
  assert.equal(j.mutate.status, 'baseline failed');
  assert.match(j.mutate.reason, /^the unmutated fix is red: .*wrong: zero does not fit.*: no mutant is judged against a fix that does not pass$/);
  assert.deepEqual([j.mutate.total, j.mutate.caught, j.mutate.mutants.length, j.mutate.line], [0, 0, 0, null]);
  assert.match(text, /^ {2}mutants: not run — the unmutated fix is red/m);
});

test('a runner read by exit code alone judges no mutant: it cannot tell a caught one from one that never loaded', async t => {
  const repo = await fits(t);
  await mkdir(join(repo.dir, '.keel'));
  await writeFile(join(repo.dir, '.keel', 'keel.json'), `${JSON.stringify({ prove: { command: 'node --test {file}' } })}\n`);
  const { j } = await mutate(repo, ['tests/fits.test.mjs', '--fix', 'lib/fits.mjs'], 1);
  assert.equal(j.mutate.status, 'not run');
  assert.match(j.mutate.reason, /read by exit code alone/);
  assert.deepEqual([j.mutate.total, j.mutate.caught, j.mutate.line], [0, 0, null]);
});

test('a mutant that does not parse or import is invalid, never caught', async t => {
  const base = ['export const DEFAULTS = {', '  limit: 2,', '};', ''].join('\n');
  const fix = ['export const DEFAULTS = {', '  limit: 3,', '};', "if (DEFAULTS.limit < 0) throw new Error('negative limit');", ''].join('\n');
  const tst = [...TESTHEAD, "import { DEFAULTS } from '../lib/limits.mjs';", "test('three', () => { assert.equal(DEFAULTS.limit, 3); });", ''].join('\n');
  const repo = await fixRepo(t, { base: { 'lib/limits.mjs': base }, fix: { 'lib/limits.mjs': fix }, tests: { 'tests/limits.test.mjs': tst } });
  const { j } = await mutate(repo, ['tests/limits.test.mjs', '--fix', 'lib/limits.mjs'], 0);
  const m = j.mutate;
  assert.deepEqual(m.invalid.map(where), ['lib/limits.mjs:2 return return early, before this line',
    'lib/limits.mjs:4 condition negate `DEFAULTS.limit < 0`', 'lib/limits.mjs:4 condition drop `DEFAULTS.limit < 0` (always true)']);
  assert.match(m.invalid[0].reason, /^does not parse or import: SyntaxError/, 'a return inside an object literal does not parse');
  assert.match(m.invalid[1].reason, /^does not parse or import: /, 'a throw at import');
  assert.deepEqual(m.survivors.map(where), ['lib/limits.mjs:4 comparison `<` → `<=`', 'lib/limits.mjs:4 number `0` → `1`']);
  assert.equal(m.caught, 1, 'only the limit the test reads');
  assert.equal(m.total, 6);
  assert.equal(m.line, 'Mutants: 1/6', 'the invalid count against the total, never for it');
});

test('a mutant that does not finish is stopped at the time limit and reported inconclusive', async t => {
  const base = ['export function count(n) {', '  return n - 1;', '}', ''].join('\n');
  const fix = ['export function count(n) {', '  let i = 0;', '  while (i < n) i++;', '  return i;', '}', ''].join('\n');
  const tst = [...TESTHEAD, "import { count } from '../lib/count.mjs';", "test('counts', () => { assert.equal(count(3), 3); assert.equal(count(0), 0); });", ''].join('\n');
  const repo = await fixRepo(t, { base: { 'lib/count.mjs': base }, fix: { 'lib/count.mjs': fix }, tests: { 'tests/count.test.mjs': tst } });
  const started = Date.now();
  const { j } = await mutate(repo, ['tests/count.test.mjs', '--fix', 'lib/count.mjs'], 0, { env: { KEEL_PROVE_MUTANT_MS: '1500' } });
  const m = j.mutate;
  assert.equal(m.limitMs, 1500);
  assert.deepEqual(m.inconclusive.map(x => `${where(x)}: ${x.reason}`), ['lib/count.mjs:3 condition drop `i < n` (always true): timed out after 1.5s']);
  assert.equal(m.caught, 6);
  assert.equal(m.total, 7);
  assert.deepEqual(m.survivors, []);
  assert.ok(Date.now() - started < 60_000, 'the loop was stopped, not waited out');
});

test('only the changed lines of a committed fix are mutated, and --trailer records Mutants: caught/total', async t => {
  const repo = await fits(t);
  git(repo.dir, ['add', '-A']);
  git(repo.dir, ['commit', '-q', '-m', 'fix: fits checks both edges']);
  const { j, text } = await mutate(repo, ['tests/fits.test.mjs', '--name', 'weak', '--fix', 'lib/fits.mjs', '--trailer'], 0, { withText: true });
  assert.ok(j.mutate.mutants.every(x => x.file === 'lib/fits.mjs' && [2, 3].includes(x.line)), 'never the unchanged near()');
  assert.equal(j.trailer, `${j.line}\nMutants: 5/9`);
  assert.match(text, /\n\nProven-by: tests\/fits\.test\.mjs \(weak\) — VERIFIED — ".*"\nMutants: 5\/9\n?$/);
});

test(`a fix of many lines runs at most ${MAX_MUTANTS} mutants, spread over its lines`, async t => {
  const base = ['export function pick(n) {', '  return -1;', '}', ''].join('\n');
  const body = Array.from({ length: 45 }, (_, k) => `  if (n === ${k}) return ${k * 2};`);
  const fix = ['export function pick(n) {', ...body, '  return -1;', '}', ''].join('\n');
  const tst = [...TESTHEAD, "import { pick } from '../lib/pick.mjs';", "test('picks', () => { for (let k = 0; k < 45; k++) assert.equal(pick(k), k * 2); });", ''].join('\n');
  const repo = await fixRepo(t, { base: { 'lib/pick.mjs': base }, fix: { 'lib/pick.mjs': fix }, tests: { 'tests/pick.test.mjs': tst } });
  const { j } = await mutate(repo, ['tests/pick.test.mjs', '--fix', 'lib/pick.mjs'], 0);
  const m = j.mutate;
  assert.equal(m.total, MAX_MUTANTS);
  assert.ok(m.candidates > MAX_MUTANTS, `${m.candidates} candidates`);
  assert.equal(new Set(m.mutants.map(x => x.line)).size, MAX_MUTANTS, 'one per line, over the changed lines');
  assert.ok(m.mutants.every(x => x.line >= 2 && x.line <= 46));
});
