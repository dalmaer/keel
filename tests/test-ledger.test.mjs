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
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
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
const runOf = ({ tree = 'acmetree1', dirty = false, machine = MACHINE, config = 'acmeconfig01', filtered, tests }) => ({
  commit: `c-${tree}`, tree, dirty, machine, node: 'v24.21.0', config, ...(filtered ? { filtered } : {}),
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

async function acmeRepo(t, source = null) {
  const dir = await scratch(t);
  await mkdir(join(dir, 'tests'), { recursive: true });
  await mkdir(join(dir, 'scripts', 'keel'), { recursive: true });
  await writeFile(join(dir, 'tests', 'acme.test.mjs'), ACME_TESTS);
  await writeFile(join(dir, 'scripts', 'keel', 'test-ledger.mjs'), source ?? await readFile(SOURCE, 'utf8'));
  await writeFile(join(dir, '.gitignore'), 'out*.txt\n');
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'acme');
  return { dir, git };
}

const WITH = ['--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=./scripts/keel/test-ledger.mjs', '--test-reporter-destination=stdout'];
const nodeTest = (dir, extra, env = {}) => run(process.execPath, ['--test', ...extra, 'tests/acme.test.mjs'], { cwd: dir, env: { ...process.env, ...env } });
/** The ledger's source with one edit: a mutant a reporter scenario must catch. */
async function mutated(from, to) {
  const text = await readFile(SOURCE, 'utf8');
  assert.ok(text.includes(from), `the mutation's target is still in the source: ${from}`);
  return text.replace(from, to);
}
/** The environment a printed command is run in: none of the scenario's own settings. */
const bare = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !['NODE_OPTIONS', 'ACME_MODE', 'ACME_FAIL'].includes(k)));
/** The run-alone command printed under a hygiene item whose line matches `item`. */
function printed(out, item) {
  const lines = out.split('\n');
  const at = lines.findIndex(l => item.test(l));
  assert.ok(at >= 0, `the item is printed:\n${out}`);
  return lines[at + 1].trim();
}
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

test('an empty describe() is a suite, not a test: a file of only that ran nothing (mutation: counting suites lets it pass)', async t => {
  const { dir } = await acmeRepo(t);
  await writeFile(join(dir, 'tests', 'empty.test.mjs'), "import { describe } from 'node:test';\ndescribe('anvils, someday', () => {});\n");
  const empty = () => run(process.execPath, ['--test', ...WITH, 'tests/empty.test.mjs'], { cwd: dir, env: { ...process.env } });
  const r = empty();
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /no tests ran/);
  // A test inside a describe is a test: the run passes.
  await writeFile(join(dir, 'tests', 'empty.test.mjs'), "import { describe, test } from 'node:test';\ndescribe('anvils', () => { describe('heavy', () => { test('drops', () => {}); }); });\n");
  const nested = empty();
  assert.equal(nested.status, 0, nested.stdout);
  assert.doesNotMatch(nested.stdout, /no tests ran/);
  const text = await readFile(SOURCE, 'utf8');
  const target = " && e.data?.details?.type === 'test'";
  assert.ok(text.includes(target));
  await writeFile(join(dir, 'scripts', 'keel', 'test-ledger.mjs'), text.replace(target, ''));
  await writeFile(join(dir, 'tests', 'empty.test.mjs'), "import { describe } from 'node:test';\ndescribe('anvils, someday', () => {});\n");
  assert.equal(empty().status, 0, 'the mutant counts the suite: the assertion above is what catches it');
});

test('dirty: an untracked file in keel\'s machine directories, or an ignored one, leaves the tree clean; one in src/ dirties it (mutation: excluding only test-runs)', async t => {
  const { dir } = await acmeRepo(t);
  const lastDirty = async () => { nodeTest(dir, WITH); return (await readRuns(dir)).runs.at(-1).dirty; };
  for (const d of ['.keel/tend', '.keel/climb']) {
    await mkdir(join(dir, d), { recursive: true });
    await writeFile(join(dir, d, 'pass.json'), '{}\n');
  }
  await writeFile(join(dir, 'out-acme.txt'), 'ignored\n');
  assert.equal(await lastDirty(), false, 'the night\'s own gathered files are not the code moving');
  const text = await readFile(SOURCE, 'utf8');
  const target = "export const MACHINE_DIRS = Object.freeze([RUNS, '.keel/climb', '.keel/tend']);";
  assert.ok(text.includes(target));
  // The mutant lives outside the repo, so it does not dirty the tree itself.
  const outside = join(await scratch(t, 'keel-ledger-mutant-'), 'test-ledger.mjs');
  await writeFile(outside, text.replace(target, 'export const MACHINE_DIRS = Object.freeze([RUNS]);'));
  nodeTest(dir, ['--test-reporter=spec', '--test-reporter-destination=stdout', `--test-reporter=${outside}`, '--test-reporter-destination=stdout']);
  assert.equal((await readRuns(dir)).runs.at(-1).dirty, true, 'the mutant calls .keel/tend dirty: the assertion above catches it');
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src', 'anvil.mjs'), 'export {};\n');
  assert.equal(await lastDirty(), true, 'an untracked source file is a dirty tree');
});

test('the run\'s config is recorded: one test passing under one configEnv value and failing under another on one clean tree is not flaky; twice under one is', async t => {
  const { dir, git } = await acmeRepo(t);
  await mkdir(join(dir, '.keel'), { recursive: true });
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ tests: { configEnv: ['ACME_FAIL'] } }));
  git('add', '-A'); git('commit', '-qm', 'config');
  nodeTest(dir, WITH);
  const other = nodeTest(dir, WITH, { ACME_FAIL: '1' });
  assert.equal(other.status, 1);
  assert.match(other.stdout, /keel test ledger: no flaky or slower test/, 'a fail under another config is not a flake');
  const { runs } = await readRuns(dir);
  assert.notEqual(runs[0].config, runs[1].config);
  assert.match(runs[0].config, /^[0-9a-f]{12}$/);
  // The same config twice, both outcomes: flaky. Here the toggle is not named, so both runs share one config.
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ tests: {} }));
  git('add', '-A'); git('commit', '-qm', 'unnamed');
  nodeTest(dir, WITH);
  const flakyRun = nodeTest(dir, WITH, { ACME_FAIL: '1' });
  assert.match(flakyRun.stdout, /flaky {3}tests\/acme\.test\.mjs "the roadrunner is caught": passed 1, failed 1/);
});

test('a narrowed run is recorded as filtered, so a test it left out is not taken for renamed; a run in Actions records its workflow', async t => {
  const { dir } = await acmeRepo(t);
  const outsideActions = { GITHUB_ACTIONS: '' };
  nodeTest(dir, [...WITH, '--test-name-pattern=^an anvil is ordered$'], outsideActions);
  nodeTest(dir, WITH, outsideActions);
  const { runs } = await readRuns(dir);
  assert.equal(runs[0].filtered, true);
  assert.deepEqual(runs[0].tests.map(x => x.name), ['an anvil is ordered']);
  assert.equal(runs[1].filtered, undefined);
  // In Actions, the workflow that ran it, so the night can tell its own runs from CI's.
  nodeTest(dir, WITH, { GITHUB_ACTIONS: 'true', GITHUB_WORKFLOW: 'check' });
  assert.equal((await readRuns(dir)).runs.at(-1).workflow, 'check');
  assert.equal(runs[1].workflow, undefined, 'outside Actions, none');
});

test('a workspace\'s own node --test, run from its folder, records in the repo root\'s ledger with root-relative files', async t => {
  const { dir } = await acmeRepo(t);
  await mkdir(join(dir, 'web', 'tests'), { recursive: true });
  await writeFile(join(dir, 'web', 'tests', 'shop.test.mjs'), "import { test } from 'node:test';\ntest('the shop opens', () => {});\n");
  const r = run(process.execPath, ['--test', '--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=../scripts/keel/test-ledger.mjs', '--test-reporter-destination=stdout', 'tests/shop.test.mjs'], { cwd: join(dir, 'web'), env: { ...process.env } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /keel test ledger: /);
  const { runs } = await readRuns(dir);
  assert.deepEqual(runs.at(-1).tests.map(x => [x.file, x.name, x.outcome]), [['web/tests/shop.test.mjs', 'the shop opens', 'pass']]);
  assert.deepEqual((await readRuns(join(dir, 'web'))).runs, [], 'nothing under the workspace\'s own folder');
});

/**
 * Two configs: the flaky test is seen under one (ACME_MODE=b, --import
 * ./pre.mjs); the run that prints it is under the other (ACME_MODE=a, no
 * preload). The printed command must be the first's, and running it from a
 * bare shell must reproduce it.
 */
async function reproduces(t, source) {
  const { dir, git } = await acmeRepo(t, source);
  await mkdir(join(dir, '.keel'), { recursive: true });
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ tests: { configEnv: ['ACME_MODE'] } }));
  await writeFile(join(dir, 'pre.mjs'), 'globalThis.acmePreloaded = true;\n');
  await writeFile(join(dir, 'tests', 'mode.test.mjs'), "import { test } from 'node:test';\nimport { writeFileSync } from 'node:fs';\n"
    + "test('the mode holds', () => { writeFileSync('out-seen.txt', JSON.stringify({ mode: process.env.ACME_MODE ?? null, preloaded: globalThis.acmePreloaded === true, nodeOptions: process.env.NODE_OPTIONS ?? null })); if (process.env.ACME_FAIL) throw new Error('flake'); });\n");
  git('add', '-A'); git('commit', '-qm', 'modes');
  const mode = (env, pre = []) => run(process.execPath, [...pre, '--test', ...WITH, 'tests/mode.test.mjs'], { cwd: dir, env: { ...bare(), ...env } });
  mode({ ACME_MODE: 'b' }, ['--import', './pre.mjs']);
  mode({ ACME_MODE: 'b', ACME_FAIL: '1' }, ['--import', './pre.mjs']);
  const out = mode({ ACME_MODE: 'a' }).stdout;
  const { runs } = await readRuns(dir);
  const hidden = v => ({ name: 'ACME_MODE', set: true, hash: createHash('sha256').update(v).digest('hex').slice(0, 12) });
  assert.deepEqual(runs.map(r => r.setting), [
    { env: { ACME_MODE: hidden('b'), NODE_OPTIONS: null }, preload: ['--import', './pre.mjs'] },
    { env: { ACME_MODE: hidden('b'), NODE_OPTIONS: null }, preload: ['--import', './pre.mjs'] },
    { env: { ACME_MODE: hidden('a'), NODE_OPTIONS: null }, preload: [] },
  ], 'each run records what its config hashes: a configEnv variable as a hash, never its value');
  assert.deepEqual(runs.map(r => r.dir), ['.', '.', '.']);
  const [found] = flaky(runs);
  assert.deepEqual([found.config, found.setting], [runs[0].config, runs[0].setting], 'the finding carries the config it was seen under');
  const cmd = printed(out, /flaky {3}tests\/mode\.test\.mjs "the mode holds": passed 1, failed 1/);
  assert.equal(cmd, `ACME_MODE="\${ACME_MODE?set ACME_MODE as it was in the run}" env -u NODE_OPTIONS node --import ./pre.mjs --test --test-name-pattern='^the mode holds$' tests/mode.test.mjs`);
  // Run as printed, with the person's ACME_MODE set as it was in the run; NODE_OPTIONS in their shell is unset, as it was then.
  const r = run('sh', ['-c', cmd], { cwd: dir, env: { ...bare(), ACME_MODE: 'b', NODE_OPTIONS: '--stack-size=900' } });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(JSON.parse(await readFile(join(dir, 'out-seen.txt'), 'utf8')), { mode: 'b', preloaded: true, nodeOptions: null }, 'run alone, it ran as it did when seen');
}

test('a flaky finding carries the config it was seen under; its run-alone command sets that config\'s variables and preloads, not the printing run\'s', async t => {
  await reproduces(t);
  // A slower one too: the newest run's own setting.
  const opts = { window: 3, factor: 2, floorMs: 200 };
  const runs = history(200, 500, opts).map(r => ({ ...r, setting: { env: { NODE_OPTIONS: '--max-old-space-size=64' }, preload: ['--require', './r.cjs'] } }));
  const [slow] = slower(runs, opts);
  assert.equal(aloneCommand(slow, ['--import', './elsewhere.mjs']), "NODE_OPTIONS='--max-old-space-size=64' node --require ./r.cjs --test --test-name-pattern='^drop$' tests/anvils.test.mjs");
});

test('mutations: a run-alone command with the printing run\'s preloads, or without the variables, fails the two-config test', async t => {
  for (const [from, to] of [
    ["...(test.setting?.preload ?? preload)", '...preload'],
    ['const vars = Object.entries(test.setting?.env ?? {});', 'const vars = [];'],
    ["const unset = vars.filter(([, v]) => !isSet(v)).map(([k]) => `-u ${k}`);", 'const unset = [];'],
  ]) await assert.rejects(reproduces(t, await mutated(from, to)), assert.AssertionError, `mutant survived: ${to}`);
});

/** A hidden variable's run-alone command is a command: it parses, carries no value, runs with the variable set and stops, saying so, without it. */
function assertRunnable(mod) {
  const setting = { env: { ACME_TOKEN: { name: 'ACME_TOKEN', set: true, hash: 'acmehash0001' }, NODE_OPTIONS: null }, preload: [] };
  const cmd = mod.aloneCommand({ file: 'tests/a.test.mjs', name: 'x', setting });
  assert.ok(!cmd.includes('acmehash0001'), 'no value, not even its hash');
  const parse = run('bash', ['-n', '-c', cmd], { env: bare() });
  assert.equal(parse.status, 0, `bash -n: ${parse.stderr}`);
  // `node` here is a stub that prints what it saw; the command runs as printed.
  const stub = mkdtempSync(join(tmpdir(), 'keel-ledger-node-'));
  writeFileSync(join(stub, 'node'), '#!/bin/sh\necho "token=$ACME_TOKEN"\n', { mode: 0o755 });
  const env = { ...bare(), PATH: `${stub}:${process.env.PATH}` };
  const set = run('bash', ['-c', cmd], { env: { ...env, ACME_TOKEN: 'acme-secret-123' } });
  assert.equal(set.status, 0, set.stderr);
  assert.equal(set.stdout.trim(), 'token=acme-secret-123', 'it runs with the person\'s own value');
  const unset = run('bash', ['-c', cmd], { env });
  assert.notEqual(unset.status, 0);
  assert.match(unset.stderr, /ACME_TOKEN: set ACME_TOKEN as it was in the run/);
  assert.doesNotMatch(unset.stdout, /token=/, 'without it, node never runs');
  rmSync(stub, { recursive: true, force: true });
}

test('a hidden variable\'s run-alone command parses in bash -n, carries no value, and runs as printed (or stops saying to set it)', () => {
  assertRunnable(ledger);
});

test('mutation: the old <as in the run> placeholder fails the runnable-command test', async t => {
  const m = await mutant(t, '`${k}="\\${${k}?set ${k} as it was in the run}"`', '`${k}=<as in the run>`');
  assert.throws(() => assertRunnable(m), assert.AssertionError);
});

/** A configEnv secret: its value is never in a run file or a printed command; two values are still two configs. */
async function keepsSecret(t, source) {
  const { dir, git } = await acmeRepo(t, source);
  await mkdir(join(dir, '.keel'), { recursive: true });
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ tests: { configEnv: ['ACME_TOKEN'] } }));
  git('add', '-A'); git('commit', '-qm', 'token');
  const outs = [nodeTest(dir, WITH, { ACME_TOKEN: 'acme-secret-123' }), nodeTest(dir, WITH, { ACME_TOKEN: 'acme-secret-123', ACME_FAIL: '1' }), nodeTest(dir, WITH, { ACME_TOKEN: 'acme-secret-456' })];
  const cmd = printed(outs[1].stdout, /flaky {3}tests\/acme\.test\.mjs "the roadrunner is caught"/);
  assert.match(cmd, /^ACME_TOKEN="\$\{ACME_TOKEN\?set ACME_TOKEN as it was in the run\}" /, 'the variable is named, its value is not');
  for (const o of outs) assert.ok(!(o.stdout + o.stderr).includes('acme-secret'), 'no value in what a run prints');
  for (const n of await readdir(join(dir, RUNS))) assert.ok(!(await readFile(join(dir, RUNS, n), 'utf8')).includes('acme-secret'), `no value in ${n}`);
  const { runs } = await readRuns(dir);
  assert.equal(runs[0].config, runs[1].config);
  assert.notEqual(runs[1].config, runs[2].config, 'two values are two configs');
  assert.notEqual(runs[1].setting.env.ACME_TOKEN.hash, runs[2].setting.env.ACME_TOKEN.hash);
}

test('a configEnv value is never recorded or printed: a name, whether it was set, and a short hash; two values are still two configs', async t => {
  await keepsSecret(t);
});

test('mutation: recording a configEnv variable\'s value fails the secret test', async t => {
  await assert.rejects(keepsSecret(t, await mutated('return [n, hidden(n, v)];', 'return [n, v ?? null];')), assert.AssertionError);
});

/** NODE_OPTIONS is kept as written unless it looks secret; then it is hashed, and its command is a placeholder. */
function assertNodeOptions(mod) {
  const plain = mod.settingOf({ env: { NODE_OPTIONS: '--require ./r.cjs --max-old-space-size=64' }, preload: [] });
  assert.equal(plain.env.NODE_OPTIONS, '--require ./r.cjs --max-old-space-size=64', 'preload paths and flags are not secrets');
  const secret = mod.settingOf({ env: { NODE_OPTIONS: '--require ./r.cjs --acme-api-key=acme-secret-123' }, preload: [] });
  assert.ok(!JSON.stringify(secret).includes('acme-secret'), 'a secret-looking NODE_OPTIONS is not kept');
  assert.deepEqual([secret.env.NODE_OPTIONS.name, secret.env.NODE_OPTIONS.set], ['NODE_OPTIONS', true]);
  assert.match(secret.env.NODE_OPTIONS.hash, /^[0-9a-f]{12}$/);
  assert.equal(mod.aloneCommand({ file: 'tests/a.test.mjs', name: 'x', setting: secret }), `NODE_OPTIONS="\${NODE_OPTIONS?set NODE_OPTIONS as it was in the run}" node --test --test-name-pattern='^x$' tests/a.test.mjs`);
  assert.equal(mod.aloneCommand({ file: 'tests/a.test.mjs', name: 'x', setting: { env: { ACME_MODE: { name: 'ACME_MODE', set: false, hash: null }, NODE_OPTIONS: null }, preload: [] } }),
    "env -u ACME_MODE -u NODE_OPTIONS node --test --test-name-pattern='^x$' tests/a.test.mjs", 'each unset variable is unset before node');
  // Codex on 0.8.4: a value set to "" in the run reproduces from a shell where it is "", and only an unset one stops the command.
  const empty = mod.aloneCommand({ file: 'tests/a.test.mjs', name: 'x', setting: { env: { ACME_MODE: { name: 'ACME_MODE', set: true, hash: 'e3b0c44298fc' } }, preload: [] } });
  const prefix = empty.slice(0, empty.indexOf(' node '));
  assert.equal(execFileSync('sh', ['-c', `ACME_MODE=''; export ACME_MODE; ${prefix} true && echo ran`], { encoding: 'utf8' }).trim(), 'ran', 'an empty value is a value');
  assert.throws(() => execFileSync('sh', ['-c', `unset ACME_MODE; ${prefix} true`], { stdio: 'pipe' }), 'an unset one stops the command');
}

test('NODE_OPTIONS is recorded as written unless it carries a token, secret, key or password; unset variables are unset in the command', () => {
  assertNodeOptions(ledger);
});

test('mutation: keeping a secret-looking NODE_OPTIONS fails the NODE_OPTIONS test', async t => {
  const m = await mutant(t, 'SECRETISH.test(v) ? hidden(n, v) : v', 'v');
  assert.throws(() => assertNodeOptions(m), assert.AssertionError);
});

/**
 * A workspace's flaky test, recorded root-relative (web/tests/shop.test.mjs):
 * the command printed in web/ runs there; the one a root run prints runs from
 * any folder (src/ here).
 */
async function fromWorkspace(t, source) {
  const { dir, git } = await acmeRepo(t, source);
  await mkdir(join(dir, 'web', 'tests'), { recursive: true });
  await mkdir(join(dir, 'src'), { recursive: true });
  await writeFile(join(dir, 'src', 'anvil.mjs'), 'export {};\n');
  await writeFile(join(dir, 'web', 'tests', 'shop.test.mjs'), "import { test } from 'node:test';\ntest('the shop opens', () => { if (process.env.ACME_FAIL) throw new Error('closed'); });\n");
  git('add', '-A'); git('commit', '-qm', 'web');
  const shop = env => run(process.execPath, ['--test', '--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=../scripts/keel/test-ledger.mjs', '--test-reporter-destination=stdout', 'tests/shop.test.mjs'], { cwd: join(dir, 'web'), env: { ...bare(), ...env } });
  shop({});
  const item = /flaky {3}web\/tests\/shop\.test\.mjs "the shop opens": passed 1, failed 1/;
  const inWeb = printed(shop({ ACME_FAIL: '1' }).stdout, item);
  assert.equal(inWeb, "env -u NODE_OPTIONS node --test --test-name-pattern='^the shop opens$' tests/shop.test.mjs", 'printed in web/, said from web/');
  let r = run('sh', ['-c', inWeb], { cwd: join(dir, 'web'), env: bare() });
  assert.equal(r.status, 0, `run in web/, where it was printed: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /pass 1\b/);
  const atRoot = printed(nodeTest(dir, WITH, bare()).stdout, item);
  assert.equal(atRoot, `cd "$(git rev-parse --show-toplevel)"/'web' && ${inWeb}`, 'printed at the root, it goes to the suite\'s folder first');
  r = run('sh', ['-c', atRoot], { cwd: join(dir, 'src'), env: bare() });
  assert.equal(r.status, 0, `run from src/: ${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /pass 1\b/);
}

test('a workspace\'s flaky test, recorded root-relative, prints a run-alone command that works where it is printed, and from any folder', async t => {
  await fromWorkspace(t);
});

test('mutations: the root-relative file as recorded, or no change of folder, fails the workspace command test', async t => {
  for (const [from, to] of [
    ["const rel = test.file ? posix.relative(dir === '.' ? '' : dir, test.file) || test.file : '';", "const rel = test.file ?? '';"],
    ['return dir === here ? command :', 'return true ? command :'],
  ]) await assert.rejects(fromWorkspace(t, await mutated(from, to)), assert.AssertionError, `mutant survived: ${to}`);
});

const LANES = [['.', 'acmeconfig01'], ['.', 'acmeconfig02'], ['web', 'acmeconfig01'], ['web', 'acmeconfig02']];
async function assertLanes(t, mod) {
  const dir = await scratch(t);
  for (let i = 0; i < 30; i++) for (const [d, config] of LANES) await mod.record(dir, { ...runOf({ config, tests: { a: ['pass', 1] } }), dir: d }, { window: 20 });
  const { runs } = await mod.readRuns(dir);
  for (const [d, config] of LANES) {
    const n = runs.filter(r => r.dir === d && r.config === config).length;
    assert.ok(n >= 21, `lane ${d} ${config} keeps ${n}, fewer than the window and one`);
  }
  // The total prunes what no lane reserves: here, unreadable records; never a lane's own runs.
  for (let i = 0; i < 5; i++) await writeFile(join(dir, RUNS, `0000-broken-${i}.json`), '{not json');
  for (let i = 0; i < 3; i++) await mod.record(dir, { ...runOf({ config: 'acmeconfig03', tests: { a: ['pass', 1] } }), dir: '.' }, { window: 20, total: 100 });
  const after = await mod.readRuns(dir);
  assert.deepEqual([after.runs.length, after.skipped], [123, 0]);
}

test('record keeps each lane (a suite\'s folder × its config) its own history: four lanes interleaved, 30 runs each, keep the window and one or more each; a total caps them all', async t => {
  await assertLanes(t, ledger);
});

test('mutation: one lane for every run (keep 50 in all) fails the lanes test', async t => {
  const m = await mutant(t, 'export const laneOf = r => `${dirOf(r)}\\u0000${configOf(r)}${', "export const laneOf = () => 'all'; const unused = r => `${");
  await assert.rejects(assertLanes(t, m), assert.AssertionError);
});

/** Four lanes with a window of 100, 105 runs each (420 in all, above TOTAL): the total grows so each keeps 101 or more. */
async function assertWideLanes(t, mod) {
  const dir = await scratch(t);
  for (let i = 0; i < 105; i++) for (const [d, config] of LANES) await mod.record(dir, { ...runOf({ config, tests: { a: ['pass', 1] } }), dir: d }, { window: 100 });
  const { runs } = await mod.readRuns(dir);
  for (const [d, config] of LANES) {
    const n = runs.filter(r => r.dir === d && r.config === config).length;
    assert.ok(n >= 101, `lane ${d} ${config} keeps ${n}, fewer than the window and one`);
  }
}

test('the total never undercuts a lane: four lanes with a window of 100 keep 101 or more runs each', async t => {
  await assertWideLanes(t, ledger);
});

/** One lane's baseline (30 runs), then 60 runs of another under a total of 60: the busy lane never evicts the quiet one's. */
async function assertReserved(t, mod) {
  const dir = await scratch(t);
  for (let i = 0; i < 30; i++) await mod.record(dir, { ...runOf({ config: 'acmeconfig01', tests: { a: ['pass', 1] } }), dir: '.' }, { window: 20, total: 60 });
  for (let i = 0; i < 60; i++) await mod.record(dir, { ...runOf({ config: 'acmeconfig02', tests: { a: ['pass', 1] } }), dir: '.' }, { window: 20, total: 60 });
  const { runs } = await mod.readRuns(dir);
  assert.equal(runs.filter(r => r.config === 'acmeconfig01').length, 30, 'the quiet lane keeps its whole baseline');
  assert.equal(runs.filter(r => r.config === 'acmeconfig02').length, 50, 'the busy lane keeps its own reserve');
}

test('each lane\'s newest max(50, window + 10) are reserved: many runs of one lane never evict another lane\'s baseline', async t => {
  await assertReserved(t, ledger);
});

test('mutation: a total that prunes reserved runs fails the reserve test', async t => {
  await assert.rejects(assertReserved(t, await mutant(t, 'const spare = kept.filter(n => !reserved.has(n));', 'const spare = kept;')), assert.AssertionError);
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
  acrossConfigs: [runOf({ config: 'acmeclock0', tests: { gate: ['pass', 5] } }), runOf({ config: 'acmeclock9', tests: { gate: ['fail', 5] } })],
  acrossLanes: [{ ...runOf({ tests: { gate: ['pass', 5] } }), dir: '.' }, { ...runOf({ tests: { gate: ['fail', 5] } }), dir: 'web' }],
});

function assertFlaky(fn) {
  const c = FLAKY_CASES();
  assert.deepEqual(fn(c.sameClean).map(x => [x.name, x.tree, x.passed, x.failed]), [['gate', 'acmetree1', 1, 1]], 'pass and fail on one clean tree is flaky');
  assert.deepEqual(fn(c.acrossTrees), [], 'the same mix across different trees is the code moving, not flaky');
  assert.deepEqual(fn(c.dirty), [], 'on a dirty tree it is not flaky');
  assert.deepEqual(fn(c.unknown), [], 'outside git it is not flaky');
  assert.deepEqual(fn(c.acrossConfigs), [], 'a pass under one config and a fail under another, on one clean tree, is the setting moving, not flaky');
  assert.deepEqual(fn(c.acrossLanes), [], 'a pass at the root and a fail in web/, one tree and config, are two lanes, not flaky');
}

test('flaky: one test passing and failing on the same clean tree is named; across trees, or on a dirty tree, it is not', () => {
  assertFlaky(flaky);
});

test('mutations: flaky that ignores the tree, or a dirty tree, fails the flaky test', async t => {
  for (const [from, to] of [
    ['const k = `${r.tree}\\u0000${laneOf(r)}\\u0000${key(t)}`;', 'const k = `${laneOf(r)}\\u0000${key(t)}`;'],
    ['const k = `${r.tree}\\u0000${laneOf(r)}\\u0000${key(t)}`;', 'const k = `${r.tree}\\u0000${key(t)}`;'],
    ['const k = `${r.tree}\\u0000${laneOf(r)}\\u0000${key(t)}`;', 'const k = `${r.tree}\\u0000${configOf(r)}\\u0000${key(t)}`;'],
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
  const other = history(200, 500, opts);
  other.at(-1).config = 'acmeclock9';
  assert.deepEqual(fn(other, opts), [], 'another config is not compared');
  const web = history(200, 500, opts);
  web.at(-1).dir = 'web';
  assert.deepEqual(fn(web, opts), [], 'another suite folder (lane) is not compared');
}

test('slower: 2.5x its median and +300 ms is named; 2.5x and +50 ms (under the floor) is not; another machine class is not compared', () => {
  assertSlower(slower);
});

test('mutation: dropping the floor, the lane, or the lane\'s folder fails the slower test', async t => {
  for (const [from, to] of [
    ['t.ms > factor * m && t.ms - m > floorMs', 't.ms > factor * m'],
    [' && laneOf(r) === laneOf(current));', ');'],
    [' && laneOf(r) === laneOf(current));', ' && configOf(r) === configOf(current));'],
  ]) {
    const m = await mutant(t, from, to);
    assert.throws(() => assertSlower(m.slower), assert.AssertionError, `mutant survived: ${to}`);
  }
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
  for (const tests of [[], 'x', { window: 1 }, { window: 2.5 }, { window: 201 }, { factor: 1 }, { floorMs: -1 }, { acme: 1 }]) {
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

/** lastOutcome's skip/todo and narrowed-run rules, against `fn`. */
function assertCited(fn) {
  const full = runOf({ tests: { 'an anvil drops': ['pass', 1], 'the crate opens': ['pass', 1] } });
  // A targeted run of the sibling: node leaves the cited test out entirely, and records the run as narrowed.
  const targeted = runOf({ filtered: true, tests: { 'the crate opens': ['pass', 1] } });
  const skipped = runOf({ tests: { 'an anvil drops': ['skip', 0], 'the crate opens': ['pass', 1] } });
  for (const [why, runs] of [['a narrowed run without it', [full, targeted]], ['a run that skipped it', [full, skipped]], ['both', [full, skipped, targeted]]]) {
    const last = fn(runs, 'tests/anvils.test.mjs', 'an anvil drops');
    assert.deepEqual(last.matched.map(x => x.outcome), ['pass'], `${why} says nothing about it: the newest pass or fail stands`);
  }
  const failedThenSkipped = [runOf({ tests: { 'an anvil drops': ['fail', 1] } }), skipped];
  assert.deepEqual(fn(failedThenSkipped, 'tests/anvils.test.mjs', 'an anvil drops').matched.map(x => x.outcome), ['fail'], 'a fail is not hidden by a later skip');
  const renamed = runOf({ tests: { 'the crate opens': ['pass', 1] } });
  assert.deepEqual(fn([full, renamed], 'tests/anvils.test.mjs', 'an anvil drops').matched, [], 'absent from a full run of the file: renamed or gone');
  assert.deepEqual(fn([skipped], 'tests/anvils.test.mjs', 'an anvil drops').matched.map(x => x.outcome), ['skip'], 'only ever skipped: not a pass');
  assert.equal(fn([targeted], 'tests/anvils.test.mjs', 'an anvil drops'), null, 'only ever left out of narrowed runs: never run');
}

test('lastOutcome: the newest pass or fail of the cited test; a skip, a todo, or a narrowed run that left it out is passed over', () => {
  assertCited(lastOutcome);
});

test('mutation: lastOutcome that takes the newest run of the file, skips and all, fails the cited-test rules', async t => {
  const m = await mutant(t, '    if (decided.length) return { ...at, matched: decided };\n', '    return { ...at, matched };\n');
  assert.throws(() => assertCited(m.lastOutcome), assert.AssertionError);
  const n = await mutant(t, 'if (!matched.length && !runs[i].filtered) return', 'if (!matched.length) return');
  assert.throws(() => assertCited(n.lastOutcome), assert.AssertionError);
});

test('configHash: stable for one setting; NODE_OPTIONS, a preload, or a configEnv variable changes it', () => {
  const { configHash, narrowed } = ledger;
  const base = configHash({ env: {}, preload: [] });
  assert.match(base, /^[0-9a-f]{12}$/);
  assert.equal(configHash({ env: { ACME_UNRELATED: '1' }, preload: [] }), base, 'an unnamed variable is not the config');
  assert.notEqual(configHash({ env: { NODE_OPTIONS: '--max-old-space-size=64' }, preload: [] }), base);
  assert.notEqual(configHash({ env: {}, preload: ['--import', './h.mjs'] }), base);
  assert.equal(configHash({ env: { ACME_CLOCK_SHIFT_DAYS: '3' }, preload: [] }), base, 'not named: not the config');
  assert.notEqual(configHash({ env: { ACME_CLOCK_SHIFT_DAYS: '3' }, preload: [], configEnv: ['ACME_CLOCK_SHIFT_DAYS'] }), configHash({ env: {}, preload: [], configEnv: ['ACME_CLOCK_SHIFT_DAYS'] }));
  assert.deepEqual(testsConfigProblems({ tests: { configEnv: ['ACME_CLOCK_SHIFT_DAYS'] } }), []);
  assert.ok(testsConfigProblems({ tests: { configEnv: 'ACME' } }).length);
  assert.ok(testsConfigProblems({ tests: { configEnv: ['not a name'] } }).length);
  assert.equal(narrowed(['--test', '--test-name-pattern=^x$']), true);
  assert.equal(narrowed(['--test', '--test-skip-pattern', 'x']), true);
  assert.equal(narrowed(['--test', '--test-reporter=spec']), false);
});

// ---- JUnit: bun test and vitest (phase 59) --------------------------------------
// The fixtures are real output (tests/fixtures/junit/*.xml, each says how it was
// made): bun 1.2.13 and vitest 5.0.3 run on one synthetic Acme folder.

const JUNIT_FIXTURES = join(KEEL, 'tests', 'fixtures', 'junit');
const fixture = name => readFile(join(JUNIT_FIXTURES, name), 'utf8');
/** The same file with every failure taken out: the tests all pass (or skip). */
const passing = xml => xml.replace(/<failure\b[^>]*\/>/g, '').replace(/<failure\b[^>]*>[\s\S]*?<\/failure>/g, '');
/** The same file, different bytes: a new run of the same tests (an XML comment at its end). */
const again = (xml, n) => `${xml}<!-- run ${n} -->\n`;

/** Each fixture's top-level tests: [file, name, outcome]; a describe() is one, failed when a test in it failed. */
const TOP = {
  bun: [
    ['a.test.ts', 'Acme widgets', 'fail'],
    ['a.test.ts', 'adds <one> & "two"', 'pass'],
    ['a.test.ts', 'fails on purpose', 'fail'],
    ['a.test.ts', 'skipped one', 'skip'],
    ['a.test.ts', 'todo one', 'todo'],
    ['sub/b.test.ts', 'slow-ish', 'pass'],
    ['sub/c.test.ts', 'rockets & <crates>', 'pass'],
  ],
  vitest: [
    ['a.test.ts', 'adds <one> & "two"', 'pass'],
    ['a.test.ts', 'fails on purpose', 'fail'],
    ['a.test.ts', 'skipped one', 'skip'],
    ['a.test.ts', 'todo one', 'skip'],
    ['a.test.ts', 'Acme widgets', 'fail'],
    ['sub/b.test.ts', 'slow-ish', 'pass'],
    ['sub/c.test.ts', 'rockets & <crates>', 'pass'],
  ],
};

/** The fixtures as `mod` reads them: every top-level test's outcome and time, what ran, what failed. */
async function assertFixtures(mod) {
  for (const runner of ['bun', 'vitest']) {
    const xml = await fixture(`${runner}.xml`);
    const doc = mod.readXml(xml);
    assert.equal(mod.junitRunner(doc), runner, 'each runner names its own <testsuites>');
    const red = mod.junitTests(doc, runner);
    assert.deepEqual(red.tests.map(x => [x.file, x.name, x.outcome]), TOP[runner], runner);
    assert.deepEqual([red.ran, red.failed], [7, 2], `${runner}: nine testcases, seven passed or failed, two failed`);
    const slow = red.tests.find(x => x.name === 'slow-ish');
    assert.ok(slow.ms > 30 && slow.ms < 34, `${runner}: seconds become ms: ${slow.ms}`);
    assert.ok(red.tests.every(x => Number.isFinite(x.ms) && x.ms >= 0));
    const green = mod.junitTests(mod.readXml(passing(xml)), runner);
    assert.deepEqual(green.tests.filter(x => x.outcome === 'fail'), [], runner);
    assert.deepEqual([green.ran, green.failed], [7, 0], runner);
  }
  // A file that would not load: vitest's testcase for it is the file's own, recorded as the file, and not a test.
  const lost = mod.junitTests(mod.readXml(await fixture('vitest-load-failure.xml')), 'vitest');
  assert.deepEqual(lost.tests.map(x => [x.file, x.name, x.outcome]), [['empty/broken.test.ts', 'empty/broken.test.ts', 'fail']]);
  assert.deepEqual([lost.ran, lost.failed], [0, 1]);
  assert.deepEqual(mod.junitTests(mod.readXml(await fixture('vitest-empty.xml')), 'vitest'), { tests: [], ran: 0, failed: 0 });
  // A nested <testsuite> is a describe: one top-level test, of every testcase inside it.
  const nested = mod.junitTests(mod.readXml('<testsuites><testsuite name="t.test.ts"><testsuite name="Acme crates" time="0.5"><testcase name="opens" time="0.1"/><testsuite name="deep"><testcase name="shuts" time="0.2"><error/></testcase></testsuite></testsuite></testsuite></testsuites>'), 'bun');
  assert.deepEqual(nested, { tests: [{ file: 't.test.ts', name: 'Acme crates', describe: true, outcome: 'fail', ms: 500 }], ran: 2, failed: 1 });
}

test('a JUnit file from bun test or vitest reads as each top-level test, its outcome and time (a describe is one, failed if a test in it failed)', async () => {
  await assertFixtures(ledger);
});

test('mutations: a failed testcase read as a pass, bun\'s describes read outermost-last, bun\'s names escaped once, entities not read, or a file\'s own entry counted, fails the fixture test', async t => {
  for (const [from, to] of [
    ["if (c.children.some(x => x.name === 'failure' || x.name === 'error')) return 'fail';", ''],
    ['return { name: xmlText(parts.at(-1)), describe: true };', 'return { name: xmlText(parts[0]), describe: true };'],
    ['return { name: xmlText(parts.at(-1)), describe: true };', 'return { name: parts.at(-1), describe: true };'],
    ['if (e[0] !== \'#\') return Object.hasOwn(ENTITIES, e) ? ENTITIES[e] : m;', "if (e[0] !== '#') return m;"],
    ["if (!own && (o === 'pass' || o === 'fail')) ran++;", "if (o === 'pass' || o === 'fail') ran++;"],
  ]) {
    const m = await mutant(t, from, to);
    await assert.rejects(assertFixtures(m), assert.AssertionError, `mutant survived: ${to}`);
  }
});

test('readXml reads the JUnit subset, entities and all, and refuses what is not well formed', () => {
  const { readXml, xmlText } = ledger;
  const doc = readXml('<?xml version="1.0"?>\n<!DOCTYPE testsuites [ <!ENTITY x "y"> ]>\n<!-- Acme -->\n<testsuites name=\'a &amp; b\' n="&#60;&#x3E;&apos;&quot;"><testsuite><![CDATA[ <testcase name="not one"/> ]]><testcase name="t &gt; u"><failure message="no">AssertionError: 1 &lt; 2</failure></testcase></testsuite><!-- </testsuites> --></testsuites>\n');
  assert.equal(doc.name, 'testsuites');
  assert.deepEqual({ ...doc.attrs }, { name: 'a & b', n: '<>\'"' });
  assert.deepEqual(doc.children[0].children.map(c => [c.name, c.attrs.name, c.children.map(x => x.name)]), [['testcase', 't > u', ['failure']]], 'CDATA and comments are not elements');
  assert.equal(xmlText('&unknown; &#xZZ; &amp;lt;'), '&unknown; &#xZZ; &lt;', 'one read: an unknown entity stays as written');
  for (const bad of ['', 'Acme', '<testsuites>', '<a></b>', '</a>', '<a x=1/>', '<a x="1" x="2"/>', '<a/><b/>', '<a><!-- </a>', '<a x="<"/>', '< a/>']) {
    assert.throws(() => readXml(bad), Error, JSON.stringify(bad));
  }
});

const ledgerCli = (dir, args, env = {}) => run(process.execPath, ['scripts/keel/test-ledger.mjs', ...args], { cwd: dir, env: { ...process.env, ...env } });
/** Write `xml` at `path` in `dir` (its folders made). */
async function junitAt(dir, path, xml) {
  await mkdir(dirname(join(dir, path)), { recursive: true });
  await writeFile(join(dir, path), xml);
}

test('--junit: a bun and a vitest file become ledger records with the run\'s commit, tree and config; the exit code is the runner\'s, and a failed testcase fails it', async t => {
  const { dir, git } = await acmeRepo(t);
  const head = git('rev-parse', 'HEAD').trim(), tree = git('rev-parse', 'HEAD^{tree}').trim();
  // bun at keel's default place; vitest at a project's own (untracked) path, which must not dirty the tree.
  await junitAt(dir, ledger.JUNIT, await fixture('bun.xml'));
  const bun = ledgerCli(dir, ['--junit', ledger.JUNIT, '--runner', 'bun', '--status', '1']);
  assert.equal(bun.status, 1, `the runner's own exit code:\n${bun.stdout}${bun.stderr}`);
  assert.equal(bun.stdout, 'keel test ledger: no flaky or slower test (1 run in .keel/test-runs).\n', 'the hygiene block, as a node run ends with');
  await junitAt(dir, 'reports/vitest.xml', await fixture('vitest.xml'));
  const vitest = ledgerCli(dir, ['--junit=reports/vitest.xml']); // the runner is read from the file
  assert.equal(vitest.status, 1, 'no --status: a failed testcase fails the run');
  const { runs } = await readRuns(dir);
  assert.deepEqual(runs.map(r => r.runner), ['bun', 'vitest']);
  for (const r of runs) {
    assert.deepEqual([r.commit, r.tree, r.dirty, r.dir], [head, tree, false, '.'], `${r.runner}: the JUnit file and the ledger's directory leave the tree clean`);
    assert.equal(r.node, process.version);
    assert.deepEqual(Object.keys(r.machine).sort(), ['arch', 'cpus', 'os']);
    assert.equal(r.config, ledger.configHash({ preload: [], runner: r.runner }), `${r.runner}: the config hash, with the runner in it`);
    assert.deepEqual(r.setting.preload, []);
    assert.match(r.junit, /^[0-9a-f]{12}$/);
    assert.deepEqual(r.tests.map(x => [x.file, x.name, x.outcome]), TOP[r.runner]);
  }
  assert.notEqual(runs[0].config, runs[1].config, 'two runners, two configs');
  assert.notEqual(runs[0].config, ledger.configHash({ preload: [] }), 'and neither is node\'s');
  // The exit code: green and no --status is 0; green with the runner's nonzero (bun leaves a file that would not load out of its JUnit) is that.
  await junitAt(dir, ledger.JUNIT, passing(await fixture('bun.xml')));
  assert.equal(ledgerCli(dir, ['--junit', ledger.JUNIT]).status, 0);
  await junitAt(dir, ledger.JUNIT, again(passing(await fixture('bun.xml')), 1));
  assert.equal(ledgerCli(dir, ['--junit', ledger.JUNIT, '--status', '3']).status, 3);
  // Usage: a bad flag is exit 2, before anything is read.
  for (const args of [[], ['--junit'], ['--junit', 'x.xml', '--runner', 'jest'], ['--junit', 'x.xml', '--status', '300'], ['--acme']]) {
    const r = ledgerCli(dir, args);
    assert.equal(r.status, 2, JSON.stringify(args));
    assert.match(r.stderr, /usage: node scripts\/keel\/test-ledger\.mjs --junit <file>/);
  }
  assert.equal((await readRuns(dir)).runs.length, 4);
});

/**
 * The zero-tests gate on JUnit, read in `dir` by `mod`: a file with no
 * testcase, no file, a file of only a file's own entry, and a file already
 * recorded each fail as "no tests ran", unless allowEmpty; what is not JUnit
 * fails even then.
 */
async function assertEmptyJunit(dir, mod) {
  const at = join(dir, 'junit.xml');
  const read = (status = 0) => mod.junitRun({ junit: at, status, cwd: dir });
  await writeFile(at, await fixture('vitest-empty.xml'));
  let r = await read();
  assert.equal(r.code, 1, `a JUnit file with no tests: no tests ran\n${r.lines.join('\n')}`);
  assert.equal(r.lines.at(-1), ledger.NO_TESTS);
  await rm(at);
  r = await read();
  assert.equal(r.code, 1, 'no file: the tests did not run');
  assert.match(r.lines[0], /no JUnit file at junit\.xml: the tests did not run/);
  await writeFile(at, await fixture('vitest-load-failure.xml'));
  assert.equal((await read()).code, 1, 'only a file that would not load: no test ran');
  await writeFile(at, passing(await fixture('bun.xml')));
  assert.equal((await read()).code, 0, 'a run with tests passes');
  r = await read();
  assert.equal(r.code, 1, 'the same file again is stale: the runner wrote nothing new (bun writes none when no test ran)');
  assert.match(r.lines[0], /junit\.xml is one already recorded: the tests wrote no new one/);
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ tests: { allowEmpty: true } }));
  await writeFile(at, await fixture('vitest-empty.xml'));
  assert.equal((await read()).code, 0, 'allowEmpty: a project with no tests yet passes');
  assert.equal((await read(4)).code, 4, 'allowEmpty never hides the runner\'s own failure');
  await writeFile(at, '<testsuites><testsuite name="a.test.ts">');
  r = await read();
  assert.equal(r.code, 1, 'not JUnit: never a pass, allowEmpty or not');
  assert.match(r.lines[0], /junit\.xml is not JUnit the ledger can read \(<testsuite> is never closed/);
  await rm(join(dir, '.keel', 'keel.json'));
}

test('--junit: a file with no tests, no file, or a stale one is "no tests ran" (exit 1), as a node run is; allowEmpty lets it pass', async t => {
  const { dir } = await acmeRepo(t);
  await mkdir(join(dir, '.keel'), { recursive: true });
  await assertEmptyJunit(dir, ledger);
  // The command says it too, last, as the reporter does.
  await writeFile(join(dir, 'empty.xml'), await fixture('vitest-empty.xml'));
  const r = ledgerCli(dir, ['--junit', 'empty.xml', '--status', '0']);
  assert.equal(r.status, 1);
  assert.equal(r.stdout.trimEnd(), ledger.NO_TESTS);
});

test('mutations: an empty JUnit file that passes without allowEmpty, or a stale file read again, fails the zero-tests test', async t => {
  for (const [from, to] of [
    ['return { lines, code: empty ? 1 : status || (failed ? 1 : 0) };', 'return { lines, code: status || (failed ? 1 : 0) };'],
    ['if (history?.runs.some(r => r.junit === hash)) {', 'if (false) {'],
  ]) {
    const { dir } = await acmeRepo(t);
    await mkdir(join(dir, '.keel'), { recursive: true });
    const m = await mutant(t, from, to);
    await assert.rejects(assertEmptyJunit(dir, m), assert.AssertionError, `mutant survived: ${to}`);
  }
});

/** One report's bytes at two paths (two packages, each its own folder) are two runs; the same path read again is stale. */
async function assertStalePerPath(dir, mod) {
  const xml = passing(await fixture('bun.xml'));
  await junitAt(dir, 'junit.xml', xml);
  await junitAt(dir, 'web/junit.xml', xml);
  assert.equal((await mod.junitRun({ junit: 'junit.xml', cwd: dir })).code, 0);
  const web = await mod.junitRun({ junit: 'junit.xml', cwd: join(dir, 'web') });
  assert.equal(web.code, 0, `web's identical report is its own run, not the root's read again\n${web.lines.join('\n')}`);
  const twice = await mod.junitRun({ junit: 'junit.xml', cwd: dir });
  assert.equal(twice.code, 1, 'the root\'s report read again is stale');
  assert.deepEqual((await readRuns(dir)).runs.map(r => r.dir), ['.', 'web']);
}

test('stale is per path: two packages\' byte-identical reports are two runs; one report read twice is one (review on #56)', async t => {
  const { dir } = await acmeRepo(t);
  await assertStalePerPath(dir, ledger);
});

/** A test named exactly like its file is a test when it ran: only vitest's failed entry for a file that would not load is the file's (review on #56). */
function assertNamedLikeItsFile(mod) {
  const one = (runner, outcome) => mod.junitTests(mod.readXml(`<testsuites><testsuite name="a.test.ts"><testcase name="a.test.ts" classname="${runner === 'vitest' ? 'a.test.ts' : ''}" time="0.001"${outcome === 'fail' ? '><failure message="no"/></testcase>' : '/>'}</testsuite></testsuites>`), runner);
  for (const runner of ['bun', 'vitest']) assert.deepEqual([one(runner, 'pass').ran, one(runner, 'pass').failed], [1, 0], `${runner}: a passing test named for its file ran`);
  assert.deepEqual([one('bun', 'fail').ran, one('bun', 'fail').failed], [1, 1], 'bun writes no load entry: a failed one is a test');
  assert.deepEqual([one('vitest', 'fail').ran, one('vitest', 'fail').failed], [0, 1], 'vitest\'s failed entry named for the file is the file\'s, not a test');
}

test('a test named exactly like its file counts as a test; only vitest\'s failed entry for the file is the file\'s', () => {
  assertNamedLikeItsFile(ledger);
});

test('mutation: any testcase named for its file taken as the file\'s turns a green run into "no tests ran", and fails the named-like-its-file test', async t => {
  const m = await mutant(t, "const own = runner === 'vitest' && Boolean(raw) && child.attrs.name === raw && caseOutcome(child) === 'fail';", 'const own = Boolean(raw) && child.attrs.name === raw;');
  assert.throws(() => assertNamedLikeItsFile(m), assert.AssertionError);
});

/** A top-level test and a describe of one name, in one file, are two tests: never flaky together, never each other's baseline (review on #56). */
function assertSuiteKind(mod) {
  const run = (testOutcome, suiteOutcome, ms = 10) => ({ ...runOf({ tests: {} }), runner: 'bun',
    tests: [{ file: 'a.test.ts', name: 'save', outcome: testOutcome, ms }, { file: 'a.test.ts', name: 'save', describe: true, outcome: suiteOutcome, ms: 900 }] });
  assert.deepEqual(mod.flaky([run('pass', 'fail')]), [], 'a passing test and a failing describe of one name, in one run, are not a flake');
  const opts = { window: 3, factor: 2, floorMs: 200 };
  assert.deepEqual(mod.slower([run('pass', 'pass'), run('pass', 'pass'), run('pass', 'pass'), run('pass', 'pass', 10)], opts), [], 'the test is judged against its own times, not the describe\'s');
  const both = mod.flaky([run('pass', 'pass'), run('fail', 'pass')]);
  assert.deepEqual(both.map(f => [f.name, f.describe ?? false]), [['save', false]], 'the test that did flake is named, as a test');
}

test('a test and a describe of one name are two tests in flaky and slower (review on #56)', () => {
  assertSuiteKind(ledger);
});

test('mutation: an identity without the suite kind keys the test and the describe together, and fails the two-tests test', async t => {
  const m = await mutant(t, "const key = t => `${t.file ?? ''}\\u0000${t.describe === true ? 'd' : 't'}\\u0000${t.name}`;", "const key = t => `${t.file ?? ''}\\u0000${t.name}`;");
  assert.throws(() => assertSuiteKind(m), assert.AssertionError);
});

/** A test file whose path a shell would split is one quoted word in its run-alone command (review on #56). */
function assertQuotedFile(mod) {
  for (const runner of ['node', 'bun', 'vitest']) {
    const cmd = mod.aloneCommand({ file: 'tests/acme widget.test.ts', name: 'save', runner });
    assert.ok(cmd.includes(` 'tests/acme widget.test.ts'`), `${runner}: ${cmd}`);
  }
  assert.equal(mod.aloneCommand({ file: 'tests/a.test.ts', name: 'save', runner: 'bun' }), "bun test tests/a.test.ts -t '^ ?save$'", 'a plain path stays as it is');
}

test('a run-alone command quotes a test file path a shell would split', () => {
  assertQuotedFile(ledger);
});

test('mutation: an unquoted path fails the quoted-file test', async t => {
  const m = await mutant(t, "const file = rel && !/^[\\w./@+-]+$/.test(rel) ? quote(rel) : rel;", 'const file = rel;');
  assert.throws(() => assertQuotedFile(m), assert.AssertionError);
});

test('"tests".junit lives in .keel/test-runs/, which ignores itself; a report there is ignored even when nothing is recorded (review on #56)', async t => {
  assert.deepEqual(testsConfigProblems({ tests: { junit: '.keel/test-runs/vitest.xml' } }), []);
  for (const junit of ['reports/vitest.xml', 'junit.xml', '.keel/test-runs/sub/x.xml', '.keel/test-runs/', '.keel/test-runs/a b.xml']) assert.ok(testsConfigProblems({ tests: { junit } }).length, junit);
  const { dir, git } = await acmeRepo(t);
  await junitAt(dir, ledger.JUNIT, await fixture('vitest-empty.xml'));
  assert.equal((await ledger.junitRun({ cwd: dir })).code, 1, 'no tests ran: nothing recorded');
  assert.equal(git('status', '--porcelain'), '', 'and still no untracked report');
});

test('mutation: a stale check on the bytes alone takes the second package\'s run for the first\'s, and fails the per-path test', async t => {
  const { dir } = await acmeRepo(t);
  const m = await mutant(t, 'const hash = sha12(`${shown}\\u0000${xml}`);', 'const hash = sha12(xml);');
  await assert.rejects(assertStalePerPath(dir, m), assert.AssertionError);
});

test('mutation: a JUnit file outside keel\'s directories left in the dirty check makes every run dirty, and fails the record test\'s clean tree', async t => {
  const { dir } = await acmeRepo(t);
  const m = await mutant(t, '...where(root, { exclude: shown === at ? [] : [shown] })', '...where(root)');
  await junitAt(dir, 'reports/vitest.xml', await fixture('vitest.xml'));
  await m.junitRun({ junit: 'reports/vitest.xml', cwd: dir });
  assert.equal((await readRuns(dir)).runs[0].dirty, true, 'the mutant counts the JUnit file: the clean-tree assertion above is what catches it');
  await junitAt(dir, 'reports/vitest.xml', again(await fixture('vitest.xml'), 1));
  await ledger.junitRun({ junit: 'reports/vitest.xml', cwd: dir });
  assert.equal((await readRuns(dir)).runs[1].dirty, false);
});

/** Runs of two runners on one clean tree, one config hash even: never flaky together, never compared for time. */
function assertRunnersApart(mod) {
  const opts = { window: 3, factor: 2, floorMs: 200 };
  const as = (runner, run) => runner === 'node' ? run : { ...run, runner };
  for (const [a, b] of [['node', 'bun'], ['bun', 'vitest'], ['node', 'vitest']]) {
    const mixed = [as(a, runOf({ tests: { drop: ['pass', 10] } })), as(b, runOf({ tests: { drop: ['fail', 10] } }))];
    assert.deepEqual(mod.flaky(mixed), [], `${a} passing and ${b} failing is not flaky: the runner moved`);
    const runs = history(200, 500, opts);
    runs[runs.length - 1] = as(b, runs.at(-1));
    for (let i = 0; i < runs.length - 1; i++) runs[i] = as(a, runs[i]);
    assert.deepEqual(mod.slower(runs, opts), [], `a ${b} run is not judged against ${a}'s`);
    assert.equal(mod.comparable(runs, runs.at(-1)).length, 0);
  }
  const same = [as('bun', runOf({ tests: { drop: ['pass', 10] } })), as('bun', runOf({ tests: { drop: ['fail', 10] } }))];
  assert.deepEqual(mod.flaky(same).map(f => [f.name, f.runner]), [['drop', 'bun']], 'within one runner it is flaky, and says which runner');
  const base = mod.configHash({ env: {}, preload: [] });
  assert.equal(mod.configHash({ env: {}, preload: [], runner: 'node' }), base, 'node\'s hash is as it was');
  assert.equal(new Set(['node', 'bun', 'vitest'].map(runner => mod.configHash({ env: {}, preload: [], runner }))).size, 3, 'the runner is in the config hash');
  assert.equal(mod.laneOf({ dir: '.', config: 'c' }), mod.laneOf({ dir: '.', config: 'c', runner: 'node' }), 'a record without a runner is node\'s');
}

test('the runner is part of the config and the lane: runs of two runners are never flaky together or compared for time', () => {
  assertRunnersApart(ledger);
});

test('mutations: a lane without the runner, or a config hash without it, fails the runners test', async t => {
  for (const [from, to] of [
    ["${runnerOf(r) === 'node' ? '' : `\\u0000${runnerOf(r)}`}`;", '`;'],
    ["...(runner === 'node' ? {} : { runner })", ''],
  ]) {
    const m = await mutant(t, from, to);
    assert.throws(() => assertRunnersApart(m), assert.AssertionError, `mutant survived: ${to}`);
  }
});

/**
 * A run-alone filter runs the finding and nothing else (review on #56): a top-level test `save` is its whole
 * name, so not `save draft`; a describe `save` is the start of its tests' names. The JUnit reading keeps which is which.
 */
async function assertAlone(mod) {
  // bun's full name has a leading space and joins describes with spaces; vitest's has none.
  const runs = (test, full) => new RegExp(/-t '(.*)'$/.exec(mod.aloneCommand(test))[1]).test(full);
  for (const runner of ['bun', 'vitest']) {
    const save = { file: 'a.test.ts', name: 'save', runner };
    assert.equal(runs(save, ' save'), true, runner);
    assert.equal(runs(save, 'save'), true, runner);
    assert.equal(runs(save, ' save draft'), false, `${runner}: a test's filter is its whole name`);
    const group = { ...save, describe: true };
    assert.equal(runs(group, ' save opens the file'), true, `${runner}: a describe's filter is the start of its tests' names`);
  }
  assert.deepEqual(mod.junitTests(mod.readXml(await fixture('bun.xml')), 'bun').tests.filter(x => x.describe).map(x => x.name), ['Acme widgets', 'rockets & <crates>']);
  assert.deepEqual(mod.junitTests(mod.readXml(await fixture('vitest.xml')), 'vitest').tests.filter(x => x.describe).map(x => x.name), ['Acme widgets', 'rockets & <crates>']);
  // A finding carries it: flaky and slower.
  const one = (outcome, ms) => ({ ...runOf({ tests: {} }), runner: 'bun', tests: [{ file: 'a.test.ts', name: 'Acme widgets', describe: true, outcome, ms }] });
  assert.equal(mod.flaky([one('pass', 1), one('fail', 1)])[0].describe, true);
  assert.equal(mod.slower([one('pass', 100), one('pass', 100), one('pass', 100), one('pass', 900)], { window: 3, factor: 2, floorMs: 200 })[0].describe, true);
}

test('a run-alone filter runs the finding alone: a test is its whole name, a describe the start of its tests\' names', async () => {
  await assertAlone(ledger);
});

test('mutations: one filter for both, or a describe not kept from the JUnit or in a finding, fails the run-alone test', async t => {
  for (const [from, to] of [
    ["test.describe ? `^ ?${escaped}( |$)` : `^ ?${escaped}$`", '`^ ?${escaped}( |$)`'],
    ['...(g.describe ? { describe: true } : {}), ', ''],
    ['const s = seen.get(k) ?? { file: t.file ?? null, name: t.name, ...suiteOf(t),', 'const s = seen.get(k) ?? { file: t.file ?? null, name: t.name,'],
  ]) {
    const m = await mutant(t, from, to);
    await assert.rejects(assertAlone(m), assert.AssertionError, `mutant survived: ${to}`);
  }
});

/** A file that names its runner is read as that runner's: a --runner or "tests".runner that says otherwise is refused, never a misread record. */
async function assertRunnerAgrees(dir, mod) {
  await junitAt(dir, 'junit.xml', await fixture('vitest.xml'));
  let r = await mod.junitRun({ junit: 'junit.xml', runner: 'bun', cwd: dir });
  assert.equal(r.code, 1, r.lines.join('\n'));
  assert.match(r.lines[0], /junit\.xml is not JUnit the ledger can read \(it is vitest's JUnit, but the runner is bun \(--runner\); say vitest\)/);
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ tests: { runner: 'bun' } }));
  r = await mod.junitRun({ junit: 'junit.xml', cwd: dir });
  assert.equal(r.code, 1);
  assert.match(r.lines[0], /the runner is bun \(\.keel\/keel\.json "tests"\.runner\); say vitest/);
  assert.equal((await readRuns(dir)).runs.length, 0, 'nothing recorded');
  r = await mod.junitRun({ junit: 'junit.xml', runner: 'vitest', cwd: dir });
  assert.equal(r.code, 1, 'the flag wins over the config, and agrees with the file: read, and red for its failed tests');
  assert.equal((await readRuns(dir)).runs[0].runner, 'vitest');
}

test('a --runner or "tests".runner that contradicts the JUnit file is refused, never read as the wrong runner\'s (review on #56)', async t => {
  const { dir } = await acmeRepo(t);
  await mkdir(join(dir, '.keel'), { recursive: true });
  await assertRunnerAgrees(dir, ledger);
});

test('mutation: a runner that overrides what the file says reads vitest as bun, and fails the runner test', async t => {
  const { dir } = await acmeRepo(t);
  await mkdir(join(dir, '.keel'), { recursive: true });
  const m = await mutant(t, '    if (says && kind !== says) throw', '    if (false) throw');
  await assert.rejects(assertRunnerAgrees(dir, m), assert.AssertionError);
});

test('a bun or vitest finding\'s run-alone command is that runner\'s, from its suite\'s folder; "tests" takes runner and junit', () => {
  assert.equal(aloneCommand({ file: 'sub/b.test.ts', name: 'slow-ish (x)', runner: 'bun' }), "bun test sub/b.test.ts -t '^ ?slow-ish \\(x\\)$'");
  assert.equal(aloneCommand({ file: 'web/a.test.ts', name: 'Acme widgets', describe: true, runner: 'vitest', dir: 'web' }), `cd "$(git rev-parse --show-toplevel)"/'web' && npx vitest run a.test.ts -t '^ ?Acme widgets( |$)'`);
  assert.equal(aloneCommand({ file: 'web/a.test.ts', name: 'Acme widgets', describe: true, runner: 'vitest', dir: 'web' }, [], { here: 'web' }), "npx vitest run a.test.ts -t '^ ?Acme widgets( |$)'");
  const block = hygiene([{ ...runOf({ tests: { 'fails on purpose': ['pass', 1] } }), runner: 'bun' }, { ...runOf({ tests: { 'fails on purpose': ['fail', 1] } }), runner: 'bun' }], { window: 3, factor: 2, floorMs: 200 });
  assert.equal(block[2].trim(), "bun test tests/anvils.test.mjs -t '^ ?fails on purpose$'");
  assert.deepEqual(testsConfigProblems({ tests: { runner: 'bun', junit: '.keel/test-runs/junit.xml' } }), []);
  for (const tests of [{ runner: 'jest' }, { junit: '' }, { junit: '/tmp/acme.xml' }, { junit: '../acme.xml' }, { junit: 3 }]) {
    assert.ok(testsConfigProblems({ tests }).length, JSON.stringify(tests));
  }
});

// ---- phase 55: inconclusive, and files pinned to stalls ---------------------------

const INCONCLUSIVE_TESTS = `import { test } from 'node:test';
test('a frame rate is measured', t => { t.diagnostic('keel:inconclusive 31 fps measured; the machine was busy'); });
test('a reel plays', async t => { await t.test('one frame', t2 => { t2.diagnostic('keel:inconclusive one frame late'); }); });
test('a crate says so and fails', t => { t.diagnostic('keel:inconclusive no frames'); throw new Error('anvil'); });
test('an anvil is ordered', t => { t.diagnostic('ordered at 9'); });
`;

/** The Acme repo with the inconclusive tests as its suite, committed; the outcomes of one run with the ledger. */
async function inconclusiveRun(t, source) {
  const { dir, git } = await acmeRepo(t, source);
  await writeFile(join(dir, 'tests', 'acme.test.mjs'), INCONCLUSIVE_TESTS);
  git('commit', '-qam', 'acme: inconclusive');
  const r = nodeTest(dir, WITH);
  assert.equal(r.status, 1, 'the failing test fails the run; an inconclusive one does not');
  const last = (await readRuns(dir)).runs.at(-1);
  assert.deepEqual(last.flags, [], 'the node flags a rerun carries: none here (the reporters are the run\'s own)');
  return last.tests.map(x => [x.name, x.outcome, x.inconclusive ?? null]);
}

test('phase 55: a passing test that says keel:inconclusive (itself or in a subtest) is recorded inconclusive, never pass or fail; a failure stays a failure', async t => {
  assert.deepEqual(await inconclusiveRun(t), [
    ['a frame rate is measured', 'inconclusive', '31 fps measured; the machine was busy'],
    ['a reel plays', 'inconclusive', 'one frame late'],
    ['a crate says so and fails', 'fail', null],
    ['an anvil is ordered', 'pass', null],
  ]);
  // Neither pass nor fail: never flaky beside a pass or a fail, never slower, and never a cited proof's pass.
  const runs = [runOf({ tests: { 'a frame': ['pass', 10] } }), runOf({ tests: { 'a frame': ['inconclusive', 900] } })];
  assert.deepEqual(flaky(runs), []);
  assert.deepEqual(flaky([...runs, runOf({ tests: { 'a frame': ['fail', 10] } })]).map(f => [f.passed, f.failed]), [[1, 1]], 'only the pass and the fail count');
  const steadyRuns = [...Array(4)].map(() => runOf({ tests: { 'a frame': ['pass', 10] } }));
  assert.deepEqual(slower([...steadyRuns, runOf({ tests: { 'a frame': ['inconclusive', 5000] } })], { window: 3, factor: 2, floorMs: 0 }), []);
  assert.deepEqual(lastOutcome([runOf({ tests: { 'a frame': ['inconclusive', 1] } })], 'tests/anvils.test.mjs', 'a frame').matched.map(x => x.outcome), ['inconclusive'], 'not a pass');
  assert.equal(ledger.inconclusiveOf('keel:inconclusive'), 'the machine kept it from judging');
  assert.equal(ledger.inconclusiveOf('keel:inconclusively'), null);
  assert.equal(ledger.inconclusiveOf('ordered at 9'), null);
});

test('mutation: a ledger that ignores the inconclusive diagnostic records those tests as passes', async t => {
  const source = await mutated('const what = inconclusiveOf(d?.message);', 'const what = null;');
  const got = await inconclusiveRun(t, source);
  assert.deepEqual(got.map(([, o]) => o), ['pass', 'pass', 'fail', 'pass'], 'the mutant says pass, which the test above refuses');
});

test('"tests".stalls: a list of files relative to the repo\'s root, pinned to stalls', () => {
  assert.deepEqual(testsConfigProblems({ tests: { stalls: ['tests/acme.test.mjs'] } }), []);
  for (const bad of ['tests/acme.test.mjs', ['/abs/acme.test.mjs'], ['../acme.test.mjs'], [''], [3]]) {
    assert.ok(testsConfigProblems({ tests: { stalls: bad } }).length, JSON.stringify(bad));
  }
  assert.deepEqual(ledger.stallsPins({ tests: { stalls: ['./tests/acme.test.mjs'] } }), ['tests/acme.test.mjs']);
  assert.deepEqual(ledger.stallsPins({ tests: { stalls: ['../x.mjs'] } }), [], 'a bad entry pins nothing');
  // PR #57 review: one bad entry never disables the good ones; it is named, and the run fails (tests/stalls.test.mjs).
  assert.deepEqual(ledger.stallsPins({ tests: { stalls: ['tests/acme.test.mjs', '../x.mjs', 3] } }), ['tests/acme.test.mjs']);
  assert.deepEqual(ledger.stallsBad({ tests: { stalls: ['tests/acme.test.mjs', '../x.mjs', 3] } }), ['../x.mjs', 3]);
  assert.deepEqual(ledger.stallsBad({ tests: { stalls: 'tests/acme.test.mjs' } }), ['tests/acme.test.mjs']);
  assert.deepEqual(ledger.stallsBad({}), []);
  assert.equal(ledger.pinned('/acme', {}), null, 'nothing pinned: nothing runs');
});
