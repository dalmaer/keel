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
  assert.equal(cmd, "ACME_MODE=<as in the run> env -u NODE_OPTIONS node --import ./pre.mjs --test --test-name-pattern='^the mode holds$' tests/mode.test.mjs");
  // The person fills in the value; NODE_OPTIONS in their shell is unset, as it was in the run.
  const r = run('sh', ['-c', cmd.replace('<as in the run>', "'b'")], { cwd: dir, env: { ...bare(), NODE_OPTIONS: '--stack-size=900' } });
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

/** A configEnv secret: its value is never in a run file or a printed command; two values are still two configs. */
async function keepsSecret(t, source) {
  const { dir, git } = await acmeRepo(t, source);
  await mkdir(join(dir, '.keel'), { recursive: true });
  await writeFile(join(dir, '.keel', 'keel.json'), JSON.stringify({ tests: { configEnv: ['ACME_TOKEN'] } }));
  git('add', '-A'); git('commit', '-qm', 'token');
  const outs = [nodeTest(dir, WITH, { ACME_TOKEN: 'acme-secret-123' }), nodeTest(dir, WITH, { ACME_TOKEN: 'acme-secret-123', ACME_FAIL: '1' }), nodeTest(dir, WITH, { ACME_TOKEN: 'acme-secret-456' })];
  const cmd = printed(outs[1].stdout, /flaky {3}tests\/acme\.test\.mjs "the roadrunner is caught"/);
  assert.match(cmd, /^ACME_TOKEN=<as in the run> /, 'the variable is named, its value is not');
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
  assert.equal(mod.aloneCommand({ file: 'tests/a.test.mjs', name: 'x', setting: secret }), "NODE_OPTIONS=<as in the run> node --test --test-name-pattern='^x$' tests/a.test.mjs");
  assert.equal(mod.aloneCommand({ file: 'tests/a.test.mjs', name: 'x', setting: { env: { ACME_MODE: { name: 'ACME_MODE', set: false, hash: null }, NODE_OPTIONS: null }, preload: [] } }),
    "env -u ACME_MODE -u NODE_OPTIONS node --test --test-name-pattern='^x$' tests/a.test.mjs", 'each unset variable is unset before node');
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
    ["const file = test.file ? posix.relative(dir === '.' ? '' : dir, test.file) || test.file : '';", "const file = test.file ?? '';"],
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
  // The total bounds every lane together.
  for (let i = 0; i < 3; i++) await mod.record(dir, { ...runOf({ config: 'acmeconfig03', tests: { a: ['pass', 1] } }), dir: '.' }, { window: 20, total: 100 });
  assert.equal((await mod.readRuns(dir)).runs.length, 100);
}

test('record keeps each lane (a suite\'s folder × its config) its own history: four lanes interleaved, 30 runs each, keep the window and one or more each; a total caps them all', async t => {
  await assertLanes(t, ledger);
});

test('mutation: one lane for every run (keep 50 in all) fails the lanes test', async t => {
  const m = await mutant(t, 'export const laneOf = r => `${dirOf(r)}\\u0000${configOf(r)}`;', "export const laneOf = () => 'all';");
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

test('mutation: a fixed total of 400 fails the wide-lanes test', async t => {
  const m = await mutant(t, 'const cap = total ?? Math.max(TOTAL, lanes.size * (window + 10));', 'const cap = total ?? TOTAL;');
  await assert.rejects(assertWideLanes(t, m), assert.AssertionError);
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
