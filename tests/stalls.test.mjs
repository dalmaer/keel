// Stalls (phase 55): keel test <file> --stalls pauses a test's whole process
// group at seeded moments, and names each test that passed without stalls and
// failed with them: it judges the wall clock. Files pinned in .keel/keel.json
// "tests": { "stalls": [...] } run with stalls in the gate, through the test
// ledger. The fixtures are tiny synthetic Acme tests; KEEL_STALLS_SHAPE (a test
// seam) makes a stall land inside a 50 ms wait every time, so what is named
// depends on the seed and the shape, never on how busy this machine is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir, platform, arch } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { run, cleanEnv } from './helpers/run.mjs';
import { runFiles, judge, planOf, stallsOf, shapeOf, seedOf, replay, preloadsOfScript, flagsOfScript, SHAPE } from '../practices/night/files/scripts/keel/stalls.mjs';
import { configHash } from '../practices/night/files/scripts/keel/test-ledger.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const NIGHT = join(KEEL, 'practices/night/files/scripts/keel');
const BIN = join(KEEL, 'bin/keel.mjs');

/**
 * A stall lands inside any 50 ms wait (never 40 ms running between stalls) and outlasts a 100 ms deadline,
 * as far as this process's own timers keep time: on a loaded machine a gap can run late, so the crate
 * waits five times, and one wait a stall lands in is enough.
 */
const TIGHT = { firstMs: [0, 40], gapMs: [0, 40], stallMs: [120, 200] };
const tightEnv = () => ({ ...process.env, KEEL_STALLS_SHAPE: JSON.stringify(TIGHT) });

const DEADLINE = 'a crate arrives by its deadline';
const MOCKED = 'a crate arrives by its deadline, on mock timers';
/** A 100 ms deadline on a 50 ms wait: by the wall clock, and the same under mock.timers. */
const CRATE = `import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
const wait = ms => new Promise(r => setTimeout(r, ms));
test(${JSON.stringify(DEADLINE)}, async () => {
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    await wait(50);
    assert.ok(Date.now() - t0 < 100, \`took \${Date.now() - t0} ms\`);
  }
});
test(${JSON.stringify(MOCKED)}, async () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const t0 = Date.now();
    const p = wait(50);
    mock.timers.tick(50);
    await p;
    assert.ok(Date.now() - t0 < 100);
  } finally { mock.timers.reset(); }
});
`;
const MOCKED_ONLY = CRATE.replace(/test\(".*?deadline",[\s\S]*?\n\}\);\n/, '');

async function scratch(t, prefix = 'keel-stalls-') {
  const dir = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

/** An Acme repo: `files` committed, with the night's ledger and stalls scripts in scripts/keel. */
async function acme(t, files, config = {}) {
  const dir = await scratch(t);
  const all = {
    '.keel/keel.json': `${JSON.stringify({ name: 'Acme', ...config }, null, 2)}\n`,
    'scripts/keel/test-ledger.mjs': await readFile(join(NIGHT, 'test-ledger.mjs'), 'utf8'),
    'scripts/keel/stalls.mjs': await readFile(join(NIGHT, 'stalls.mjs'), 'utf8'),
    ...files,
  };
  for (const [p, text] of Object.entries(all)) {
    await mkdir(dirname(join(dir, p)), { recursive: true });
    await writeFile(join(dir, p), text);
  }
  const git = (...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-qm', 'acme');
  return { dir, git };
}

test('the same seed gives the same stalls, about once a second and never two seconds apart; another seed, others', () => {
  assert.deepEqual(planOf(7, 50), planOf(7, 50));
  assert.notDeepEqual(planOf(7, 50), planOf(8, 50));
  const plan = planOf(20261009, 1000);
  assert.ok(plan[0].gap >= 0 && plan[0].gap <= 1000, 'the first comes within a second');
  for (const [i, s] of plan.entries()) {
    assert.ok(s.ms >= 50 && s.ms <= 500, `stall ${i}: ${s.ms} ms`);
    if (i) assert.ok(s.gap >= 500 && s.gap <= 1500, `gap ${i}: ${s.gap} ms`);
    if (i) assert.ok(s.gap + plan[i - 1].ms <= 2000, `stall ${i} starts within two seconds of the last`);
  }
  const mean = plan.slice(1).reduce((a, s, i) => a + s.gap + plan[i].ms, 0) / (plan.length - 1);
  assert.ok(mean > 1000 && mean < 1600, `about once a second: every ${Math.round(mean)} ms`);
  assert.deepEqual(shapeOf({}), SHAPE);
  assert.deepEqual(shapeOf({ KEEL_STALLS_SHAPE: JSON.stringify(TIGHT) }), TIGHT);
  assert.throws(() => shapeOf({ KEEL_STALLS_SHAPE: '{"stallMs":[9,1]}' }), /stallMs/);
  assert.equal(seedOf('42'), 42);
  for (const bad of ['-1', '1.5', 'x', String(2 ** 32)]) assert.equal(seedOf(bad), null, bad);
  assert.equal(stallsOf(1).next().value.gap, planOf(1, 1)[0].gap);
});

test('judge names only what passed without stalls and failed with them', () => {
  const t = (name, outcome) => ({ file: 'tests/acme.test.mjs', name, outcome, ms: 1 });
  const plain = [t('waits', 'pass'), t('broken', 'fail'), t('steady', 'pass'), t('plays', 'pass'), t('gone', 'pass'), t('unsure', 'inconclusive')];
  const stalled = [t('waits', 'fail'), t('broken', 'fail'), t('steady', 'pass'), t('plays', 'inconclusive'), t('unsure', 'fail'), t('new', 'fail')];
  const j = judge(plain, stalled);
  assert.deepEqual(j.named.map(x => x.name), ['waits']);
  assert.deepEqual(j.both.map(x => x.name), ['broken'], 'a plain failure: stalls cannot judge it');
  // PR #57 review: an inconclusive run without stalls is no pass to compare with, so it is never named.
  assert.deepEqual(j.unbased.map(x => [x.name, x.plain]), [['unsure', 'inconclusive'], ['new', null]]);
  // PR #57 review: two tests of one name are two tests; each is judged against its own plain run.
  const twice = judge([t('twin', 'skip'), t('twin', 'pass')], [t('twin', 'fail'), t('twin', 'pass')]);
  assert.deepEqual(twice.named, [], 'the first twin was skipped plainly: no pass to compare with');
  assert.deepEqual(twice.unbased.map(x => [x.name, x.plain]), [['twin', 'skip']]);
  assert.deepEqual(judge([t('twin', 'pass'), t('twin', 'skip')], [t('twin', 'fail'), t('twin', 'skip')]).named.map(x => x.name), ['twin']);
  assert.deepEqual(j.inconclusive.map(x => x.name), ['plays']);
  assert.deepEqual(j.missing.map(x => x.name), ['gone']);
});

test('--stalls pauses the whole process group, a test\'s own child too, at the seed\'s stalls', async t => {
  const dir = await scratch(t);
  const ticks = join(dir, 'ticks.json');
  // tests/fixtures/stalls/group.mjs: its child ticks every 5 ms for 800 ms and writes when each tick ran.
  const shape = { firstMs: [100, 150], gapMs: [60, 100], stallMs: [60, 100] };
  const r = await runFiles({ files: [join(KEEL, 'tests/fixtures/stalls/group.mjs')], cwd: dir, seed: 55, shape, env: { ...process.env, ACME_TICKS: ticks } });
  assert.deepEqual(r.tests.map(x => [x.name, x.outcome]), [['a child ticks', 'pass']], r.stderr);
  assert.deepEqual(r.stalls.map(s => s.ms), planOf(55, r.stalls.length, shape).map(s => s.ms), 'the stalls are the seed\'s, in order');
  const plan = planOf(55, r.stalls.length, shape);
  let due = 0;
  for (const [i, s] of r.stalls.entries()) {
    due += plan[i].gap;
    assert.ok(s.at >= due - 5, `stall ${i} at ${s.at} ms, not before its seeded ${due} ms`);
    due = s.at + (s.end - s.start);
  }
  const at = JSON.parse(await readFile(ticks, 'utf8'));
  const inside = r.stalls.filter(s => s.start > at[0] && s.end < at.at(-1));
  assert.ok(inside.length >= 2, `stalls landed while the child ran: ${inside.length}`);
  for (const s of inside) {
    const during = at.filter(x => x >= s.start + 25 && x <= s.end - 5);
    assert.deepEqual(during, [], `the child ran during a ${s.end - s.start} ms stall`);
  }
  assert.ok(r.paused >= inside.reduce((a, s) => a + s.ms, 0));
});

test('paused time is not counted against the timeout; running time is', async t => {
  const dir = await scratch(t);
  await writeFile(join(dir, 'quick.test.mjs'), "import { test } from 'node:test';\ntest('an anvil is ordered', () => {});\n");
  await writeFile(join(dir, 'slow.test.mjs'), "import { test } from 'node:test';\ntest('an anvil takes its time', () => new Promise(r => setTimeout(r, 5000)));\n");
  // One 2.5 s stall at the start, against a 2 s limit: the wall passes it, the running time does not.
  const once = { firstMs: [0, 0], gapMs: [60_000, 60_000], stallMs: [2500, 2500] };
  const paused = await runFiles({ files: ['quick.test.mjs'], cwd: dir, seed: 1, shape: once, timeoutMs: 2000 });
  assert.equal(paused.timedOut, false);
  assert.ok(paused.wall > 2000 && paused.paused >= 2500, JSON.stringify({ wall: paused.wall, paused: paused.paused }));
  assert.deepEqual(paused.tests.map(x => x.outcome), ['pass']);
  const slow = await runFiles({ files: ['slow.test.mjs'], cwd: dir, timeoutMs: 800 });
  assert.equal(slow.timedOut, true, 'running time past the limit stops the run');
  assert.ok(slow.wall < 4000, `stopped near its limit, not at the test's end: ${slow.wall} ms`);
});

test('PR #57 review: SIGINT, SIGTERM or the command\'s own exit during a stall ends the test\'s group: never left stopped, never left running', async t => {
  for (const sig of ['SIGTERM', 'SIGINT', 'exit']) {
    const r = run(process.execPath, [join(KEEL, 'tests/fixtures/stalls/interrupt.mjs')], { env: { ...process.env, ACME_SIGNAL: sig } });
    const pid = Number(r.stdout.trim());
    assert.ok(pid > 0, `${sig}: the runner was stopped, then the driver was signalled: ${r.stdout}${r.stderr}`);
    t.after(() => { for (const s of ['SIGCONT', 'SIGKILL']) { try { process.kill(-pid, s); } catch { /* gone */ } } });
    const state = () => (execFileSync('ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
    let left = 'T';
    for (const until = Date.now() + 5000; Date.now() < until;) {
      try { left = state() || 'gone'; } catch { left = 'gone'; }
      if (left === 'gone' || left.startsWith('Z')) break;
      await new Promise(done => setTimeout(done, 50));
    }
    assert.ok(left === 'gone' || left.startsWith('Z'), `${sig}: the runner is still there (${left}): ${left.includes('T') ? 'stopped' : 'running'}`);
  }
});

test('a 100 ms deadline on a 50 ms wait passes plainly and is named under stalls; under mock.timers it passes both', async t => {
  const dir = await scratch(t);
  await writeFile(join(dir, 'crate.test.mjs'), CRATE);
  const stalled = await runFiles({ files: ['crate.test.mjs'], cwd: dir, seed: 9, env: tightEnv() });
  assert.deepEqual(stalled.tests.map(x => [x.name, x.outcome]), [[DEADLINE, 'fail'], [MOCKED, 'pass']], 'the wall-clock test fails with stalls, every time; the mocked one never');
  assert.match(stalled.tests[0].error, /^took \d+ ms$/);
  const plain = await runFiles({ files: ['crate.test.mjs'], cwd: dir });
  assert.equal(plain.stalls.length, 0);
  assert.equal(plain.tests.find(x => x.name === MOCKED).outcome, 'pass');
  if (plain.tests.find(x => x.name === DEADLINE).outcome !== 'pass') {
    // The plain half judges this machine's wall clock: busy enough to miss 100 ms with no stall, it cannot say.
    t.diagnostic(`keel:inconclusive the plain 50 ms wait overran 100 ms with no stall: ${plain.tests[0].error}`);
    return;
  }
  assert.deepEqual(judge(plain.tests, stalled.tests).named.map(x => x.name), [DEADLINE]);
});

test('keel test --stalls names the wall-clock test against the ledger\'s pass on this tree, and replays its seed', async t => {
  const { dir, git } = await acme(t, { 'tests/crate.test.mjs': CRATE });
  // The ledger's run of this very tree, an hour ago: both passed. keel test reads it in place of a plain run.
  // It must be this run's lane: the same folder and config (keel test runs here with no preload, and this env).
  const config = configHash({ env: cleanEnv(tightEnv()), preload: [], configEnv: [] });
  const record = { commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), dirty: false, machine: { os: platform(), arch: arch(), cpus: 4 }, node: process.version, dir: '.', config, date: new Date(Date.now() - 3_600_000).toISOString(), tests: [DEADLINE, MOCKED].map(name => ({ file: 'tests/crate.test.mjs', name, outcome: 'pass', ms: 51 })) };
  await mkdir(join(dir, '.keel/test-runs'), { recursive: true });
  await writeFile(join(dir, '.keel/test-runs/.gitignore'), '*\n');
  // PR #57 review: a pass under another config (NODE_OPTIONS, a preload, a configEnv value), or from another folder, never stands in.
  await writeFile(join(dir, '.keel/test-runs/2026-10-09T09-00-00-000Z-1.json'), JSON.stringify({ ...record, config: 'acmeother01' }));
  // Nor does a pass on another node, OS or architecture.
  await writeFile(join(dir, '.keel/test-runs/2026-10-09T09-10-00-000Z-1.json'), JSON.stringify({ ...record, node: 'v0.0.0' }));
  await writeFile(join(dir, '.keel/test-runs/2026-10-09T09-20-00-000Z-1.json'), JSON.stringify({ ...record, machine: { ...record.machine, os: 'acmeos' } }));
  await writeFile(join(dir, '.keel/test-runs/2026-10-09T09-30-00-000Z-1.json'), JSON.stringify({ ...record, dir: 'web' }));
  const other = JSON.parse(run(process.execPath, [BIN, 'test', 'tests/crate.test.mjs', '--stalls', '--seed', '7', '--json'], { cwd: dir, env: tightEnv() }).stdout);
  assert.equal(other.plain.from, 'run', 'another lane\'s pass is not this run\'s baseline');
  assert.deepEqual(preloadsOfScript('node --import ./h.mjs --require=r.cjs -r \'q.cjs\' --test'), ['--import', './h.mjs', '--require=r.cjs', '-r', 'q.cjs'], 'as written: the form the ledger records and hashes');
  // PR #57 review: a quoted path keeps its spaces, and the suite's other node flags come along; the run's own do not.
  const script = "node --import './test helpers/setup.mjs' --conditions=acme -C dev --experimental-vm-modules --test --test-reporter=spec --test-timeout 5000 --test-name-pattern x tests/ && echo done";
  assert.deepEqual(preloadsOfScript(script), ['--import', './test helpers/setup.mjs']);
  assert.deepEqual(flagsOfScript(script), ['--import', './test helpers/setup.mjs', '--conditions=acme', '-C', 'dev', '--experimental-vm-modules']);
  assert.deepEqual(flagsOfScript('vitest run'), [], 'not node\'s runner: nothing to carry');
  await writeFile(join(dir, '.keel/test-runs/2026-10-09T10-00-00-000Z-1.json'), JSON.stringify(record));

  const r = run(process.execPath, [BIN, 'test', 'tests/crate.test.mjs', '--stalls', '--seed', '7', '--json'], { cwd: dir, env: tightEnv() });
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.seed, 7);
  assert.equal(out.plain.from, 'ledger');
  assert.deepEqual(out.named.map(x => [x.file, x.name]), [['tests/crate.test.mjs', DEADLINE]]);
  assert.equal(out.stalled.tests.find(x => x.name === MOCKED).outcome, 'pass', 'mock timers pass with stalls');
  assert.ok(out.stalled.stalls.length >= 1);
  assert.deepEqual(out.stalled.stalls.map(s => s.ms), planOf(7, out.stalled.stalls.length, TIGHT).map(s => s.ms), 'seed 7\'s stalls');
  assert.equal(out.replay, 'keel test tests/crate.test.mjs --stalls --seed 7');
  assert.equal(replay(['tests/crate.test.mjs'], 7, "it's"), "keel test tests/crate.test.mjs --name 'it'\\''s' --stalls --seed 7");
  // PR #57 review: a file is a shell word too.
  assert.equal(replay(['tests/a crate.test.mjs', 'tests/$(touch x).test.mjs'], 7), "keel test 'tests/a crate.test.mjs' 'tests/$(touch x).test.mjs' --stalls --seed 7");

  const text = run(process.execPath, [BIN, 'test', 'tests/crate.test.mjs', '--stalls', '--seed', '7'], { cwd: dir, env: tightEnv() });
  assert.equal(text.status, 1);
  assert.match(text.stdout, /^Judges the wall clock \(passed without stalls, failed with them\):\n {2}tests\/crate\.test\.mjs "a crate arrives by its deadline": took \d+ ms$/m);
  assert.match(text.stdout, /"tests": \{ "stalls": \["tests\/crate\.test\.mjs"\] \}/);
  assert.match(text.stdout, /^Replay these stalls: keel test tests\/crate\.test\.mjs --stalls --seed 7$/m);

  // Narrowed, it runs plainly itself: the ledger's whole-file run is not this run.
  const named = JSON.parse(run(process.execPath, [BIN, 'test', 'tests/crate.test.mjs', '--name', 'mock timers', '--stalls', '--json'], { cwd: dir, env: tightEnv() }).stdout);
  assert.equal(named.plain.from, 'run');
  assert.deepEqual(named.stalled.tests.map(x => [x.name, x.outcome]), [[MOCKED, 'pass']]);
  assert.deepEqual(named.named, []);
  assert.match(String(named.seed), /^\d+$/, 'a fresh seed, printed');

  for (const [args, why] of [[['tests/crate.test.mjs'], /--stalls/], [['tests/crate.test.mjs', '--stalls', '--seed', 'x'], /--seed/], [['tests/nope.test.mjs', '--stalls'], /no test file/], [['--stalls'], /keel test <file>/]]) {
    const bad = run(process.execPath, [BIN, 'test', ...args, '--json'], { cwd: dir });
    assert.equal(bad.status, 2, args.join(' '));
    assert.match(JSON.parse(bad.stdout).error, why);
  }
});

const WITH = ['--test-reporter=spec', '--test-reporter-destination=stdout', '--test-reporter=./scripts/keel/test-ledger.mjs', '--test-reporter-destination=stdout'];
const gate = (dir, extra = [], env = tightEnv()) => run(process.execPath, ['--test', ...WITH, ...extra, 'tests/crate.test.mjs', 'tests/anvil.test.mjs'], { cwd: dir, env });
const ANVIL = "import { test } from 'node:test';\ntest('an anvil is ordered', () => {});\n";
const PIN = { tests: { stalls: ['tests/crate.test.mjs'] } };

test('a file pinned to stalls runs with them in the gate, from a fresh seed a failure prints with its replay', async t => {
  const { dir } = await acme(t, { 'tests/crate.test.mjs': CRATE, 'tests/anvil.test.mjs': ANVIL }, PIN);
  const r = gate(dir);
  assert.equal(r.status, 1, r.stdout + r.stderr);
  const m = /^keel stalls: tests\/crate\.test\.mjs failed with stalls \(\d+ stalls?, [\d.]+ s paused, [\d.]+ s in all\), seed (\d+)\. Replay: keel test tests\/crate\.test\.mjs --stalls --seed (\d+)$/m.exec(r.stdout);
  assert.ok(m, r.stdout);
  assert.equal(m[1], m[2], 'the replay carries the seed');
  assert.match(r.stdout, /^ {2}"a crate arrives by its deadline" (passed plainly and failed with stalls: it judges the wall clock|failed with stalls and plainly): took \d+ ms$/m);
  assert.doesNotMatch(r.stdout, /anvil\.test\.mjs (passed|failed) with/, 'an unpinned file runs once');
  const again = gate(dir);
  const seed = /seed (\d+)\./.exec(again.stdout)?.[1];
  assert.ok(seed && seed !== m[1], `a fresh seed each gate: ${m[1]} then ${seed}`);
});

test('a pinned file on mock timers passes with stalls; a narrowed run, or nothing pinned, runs none', async t => {
  const { dir } = await acme(t, { 'tests/crate.test.mjs': MOCKED_ONLY, 'tests/anvil.test.mjs': ANVIL }, PIN);
  const r = gate(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^keel stalls: tests\/crate\.test\.mjs passed with \d+ stalls?, [\d.]+ s paused, [\d.]+ s in all, seed \d+\.$/m);
  // PR #57 review: one bad entry neither disables the good pins nor passes quietly.
  const { dir: mixed } = await acme(t, { 'tests/crate.test.mjs': MOCKED_ONLY, 'tests/anvil.test.mjs': ANVIL }, { tests: { stalls: ['tests/crate.test.mjs', '../elsewhere.test.mjs'] } });
  const m = gate(mixed);
  assert.equal(m.status, 1, m.stdout);
  assert.match(m.stdout, /^keel stalls: "tests"\.stalls pins nothing with "\.\.\/elsewhere\.test\.mjs"/m);
  assert.match(m.stdout, /^keel stalls: tests\/crate\.test\.mjs passed with /m, 'the good pin still runs');
  assert.doesNotMatch(gate(dir, ['--test-name-pattern=anvil']).stdout, /keel stalls/, 'a narrowed run');
  const { dir: bare } = await acme(t, { 'tests/crate.test.mjs': CRATE, 'tests/anvil.test.mjs': ANVIL });
  assert.doesNotMatch(gate(bare).stdout, /keel stalls/, 'nothing pinned');
});

test('PR #57 review: a pinned file runs with stalls after its own run, never beside it', async t => {
  // It holds an exclusive lock (a port, a database, a fixture) for 1.5 s: two copies at once fail with no stall at all.
  const HOLDS = `import { test } from 'node:test';
import { openSync, closeSync, unlinkSync } from 'node:fs';
test('an anvil holds the lock', async () => {
  const fd = openSync(process.env.ACME_LOCK, 'wx');
  try { await new Promise(r => setTimeout(r, 1500)); } finally { closeSync(fd); unlinkSync(process.env.ACME_LOCK); }
});
`;
  const { dir } = await acme(t, { 'tests/crate.test.mjs': HOLDS, 'tests/anvil.test.mjs': ANVIL }, PIN);
  const lock = join(await scratch(t), 'anvil.lock');
  const gentle = { ...process.env, ACME_LOCK: lock, KEEL_STALLS_SHAPE: JSON.stringify({ firstMs: [0, 40], gapMs: [200, 300], stallMs: [50, 60] }) };
  const r = gate(dir, [], gentle);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^keel stalls: tests\/crate\.test\.mjs passed with /m);
});

test('PR #57 review: keel test fails when the run without stalls dies with no test failed', async t => {
  const { dir } = await acme(t, { 'tests/once.test.mjs': await readFile(join(KEEL, 'tests/fixtures/stalls/dies-once.mjs'), 'utf8') });
  const once = join(await scratch(t), 'once');
  const r = run(process.execPath, [BIN, 'test', 'tests/once.test.mjs', '--stalls', '--json'], { cwd: dir, env: { ...process.env, ACME_ONCE: once } });
  const out = JSON.parse(r.stdout);
  assert.equal(out.plain.from, 'run');
  assert.equal(out.plain.exitCode, null, 'its runner was killed');
  assert.deepEqual(out.stalled.tests.map(x => x.outcome), ['pass'], 'with stalls it passed');
  assert.equal(r.status, 1, 'no comparison was made: never a clean 0');
});

test('PR #57 review: keel test runs a workspace\'s file from its own folder, with its own preloads', async t => {
  const WS = `import { test } from 'node:test';
import assert from 'node:assert/strict';
test('the workspace is set up', () => {
  assert.equal(globalThis.ACME_SETUP, 'web');
  assert.match(process.cwd(), /[\\\\/]web$/);
  assert.ok(process.execArgv.includes('--conditions=acme'), "the suite's conditions");
});
`;
  const { dir } = await acme(t, {
    'web/package.json': `${JSON.stringify({ name: 'acme-web', scripts: { test: "node --import './test helpers/setup.mjs' --conditions=acme --test tests/" } })}\n`,
    'web/test helpers/setup.mjs': "globalThis.ACME_SETUP = 'web';\n",
    'web/tests/ws.test.mjs': WS,
  });
  const r = run(process.execPath, [BIN, 'test', 'tests/ws.test.mjs', '--stalls', '--seed', '3', '--json'], { cwd: join(dir, 'web') });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.files, ['web/tests/ws.test.mjs'], 'reported from the project\'s root');
  assert.deepEqual([...out.plain.tests, ...out.stalled.tests].map(x => [x.file, x.outcome]), [['web/tests/ws.test.mjs', 'pass'], ['web/tests/ws.test.mjs', 'pass']]);
  assert.equal(out.replay, 'keel test tests/ws.test.mjs --stalls --seed 3', 'replayed from where it was run');
});

test('PR #57 review: keel test that ran no test (only a suite, or a --name that matches none) judged nothing, and fails', async t => {
  const { dir } = await acme(t, { 'tests/crate.test.mjs': CRATE, 'tests/empty.test.mjs': "import { describe } from 'node:test';\ndescribe('an empty crate', () => {});\n" });
  for (const args of [['tests/empty.test.mjs'], ['tests/crate.test.mjs', '--name', 'no such crate']]) {
    const r = run(process.execPath, [BIN, 'test', ...args, '--stalls', '--json'], { cwd: dir });
    assert.equal(r.status, 1, `${args.join(' ')}: ${r.stdout}`);
    assert.equal(JSON.parse(r.stdout).ran.stalled, 0);
    assert.deepEqual(JSON.parse(r.stdout).named, []);
  }
  const text = run(process.execPath, [BIN, 'test', 'tests/empty.test.mjs', '--stalls'], { cwd: dir }).stdout;
  assert.match(text, /^ {2}no test ran: nothing was judged$/m);
  assert.doesNotMatch(text, /No test judges the wall clock here/);
});

test('mutation: a ledger that never starts its pinned files runs none, and says nothing', async t => {
  const { dir } = await acme(t, { 'tests/crate.test.mjs': MOCKED_ONLY, 'tests/anvil.test.mjs': ANVIL }, PIN);
  const path = join(dir, 'scripts/keel/test-ledger.mjs');
  const text = await readFile(path, 'utf8');
  assert.ok(text.includes('    pins?.saw(e);\n'));
  await writeFile(path, text.replace('    pins?.saw(e);\n', ''));
  assert.doesNotMatch(gate(dir).stdout, /keel stalls/, 'the test above, which asks for the line, would fail');
});
