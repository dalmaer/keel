// keel ready and keel integrate (phase 83): clones of one bare Acme origin, on
// this machine's disk. No network. The full gate is a tiny fake: in-process,
// a function that reads the tree; through the CLI, a project `check` script
// that logs each run. The origin's post-receive hook logs every push to main,
// so "one push" is counted where it happens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ready, integrate, fastChecks, parseReady, pushable, LOCK } from '../lib/integrate.mjs';
import { run } from './helpers/run.mjs';

const KEEL = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(KEEL, 'bin', 'keel.mjs');
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// The CLI's gate: logs a line per run to GATE_LOG, and fails when a tracked file says BREAK.
const GATE = `import { readdirSync, readFileSync, appendFileSync } from 'node:fs';
appendFileSync(process.env.GATE_LOG, process.cwd() + '\\n');
const broken = readdirSync('.').filter(f => f.endsWith('.txt')).some(f => readFileSync(f, 'utf8').includes('BREAK'));
process.exit(broken ? 1 : 0);
`;

/**
 * One bare Acme origin and clones a and b. `pushes()` is every push to main
 * the origin received. `env(machine)` is a session's environment.
 */
async function acme(t, { check = 'node gate.mjs', fast } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-integrate-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const seed = join(dir, 'seed'), origin = join(dir, 'origin.git');
  await mkdir(join(seed, '.keel'), { recursive: true });
  await writeFile(join(seed, '.keel', 'keel.json'), JSON.stringify({ name: 'Acme', repo: 'acme/app', check, ...(fast ? { delivery: { fast } } : {}) }));
  await writeFile(join(seed, 'gate.mjs'), GATE);
  await writeFile(join(seed, 'fast.mjs'), 'process.exit(process.env.FAST_FAIL ? 1 : 0);\n');
  await writeFile(join(seed, 'anvil.txt'), 'one anvil\n');
  execFileSync('git', ['init', '-q', '-b', 'main', seed]);
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'acme');
  execFileSync('git', ['clone', '-q', '--bare', seed, origin]);
  const log = join(dir, 'pushes.log');
  await writeFile(join(origin, 'hooks', 'post-receive'), `#!/bin/sh\nwhile read old new ref; do if [ "$ref" = refs/heads/main ]; then echo "$new" >> "${log}"; fi; done\n`);
  await chmod(join(origin, 'hooks', 'post-receive'), 0o755);
  const a = join(dir, 'a'), b = join(dir, 'b');
  for (const clone of [a, b]) execFileSync('git', ['clone', '-q', origin, clone]);
  const pushes = async () => (await readFile(log, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  const env = machine => ({ ...process.env, KEEL_PROVIDER: 'claude', KEEL_SESSION: `session-${machine}`, KEEL_MACHINE: machine, GATE_LOG: join(dir, 'gate.log') });
  const gateRuns = async () => (await readFile(join(dir, 'gate.log'), 'utf8').catch(() => '')).split('\n').filter(Boolean).length;
  return { dir, origin, a, b, pushes, env, gateRuns };
}

let clock = Date.parse('2026-10-17T10:00:00.000Z');
/** A session's change on its own branch in `clone`, committed and marked ready. */
async function change(clone, branch, files, env) {
  git(clone, 'fetch', '-q', 'origin');
  git(clone, 'checkout', '-q', '-B', branch, 'origin/main');
  for (const [f, text] of Object.entries(files)) await writeFile(join(clone, f), text);
  git(clone, 'add', '-A');
  git(clone, 'commit', '-q', '-m', `acme: ${branch}`);
  const r = await ready({ root: clone }, { env, now: (clock += 1000) });
  assert.equal(r.data.ok, true, r.text);
  return git(clone, 'rev-parse', 'HEAD');
}

/** The fake full gate, in-process: fails on a BREAK, and on left.txt and right.txt together (an interaction). */
function fakeGate() {
  const runs = [];
  const gate = async dir => {
    const files = (await readdir(dir)).filter(f => f.endsWith('.txt'));
    const text = await Promise.all(files.map(f => readFile(join(dir, f), 'utf8')));
    runs.push(files.sort().join(','));
    const fail = text.some(x => x.includes('BREAK')) || (files.includes('left.txt') && files.includes('right.txt'));
    return { status: fail ? 1 : 0 };
  };
  return { gate, runs };
}
const onMain = (origin, f) => { try { git(origin, 'cat-file', '-e', `main:${f}`); return true; } catch { return false; } };
const remoteRefs = (origin, prefix) => git(origin, 'for-each-ref', '--format=%(refname:short)', `refs/heads/${prefix}`).split('\n').filter(Boolean);

test('keel ready records a branch as ready without running the full gate', async t => {
  const { a, origin, env, gateRuns } = await acme(t, { fast: ['node fast.mjs'] });
  git(a, 'checkout', '-q', '-b', 'claude/anvil');
  await writeFile(join(a, 'anvil.txt'), 'two anvils\n');
  git(a, 'commit', '-q', '-am', 'acme: two anvils');
  const head = git(a, 'rev-parse', 'HEAD');
  const r = run(process.execPath, [BIN, 'ready', '--check', 'node fast.mjs --again', '--json'], { cwd: a, env: env('m1') });
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ready, true);
  assert.deepEqual(out.checks, [{ command: 'node fast.mjs', status: 0 }, { command: 'node fast.mjs --again', status: 0 }]);
  // The full gate never ran.
  assert.equal(await gateRuns(), 0);
  // The branch is pushed, and ready/<branch> is keel's commit on it: one parent, the head, the same tree, the record.
  assert.equal(git(origin, 'rev-parse', 'claude/anvil'), head);
  const sha = git(origin, 'rev-parse', 'ready/claude/anvil');
  assert.equal(git(origin, 'log', '-1', '--format=%P', sha), head);
  assert.equal(git(origin, 'rev-parse', `${sha}^{tree}`), git(origin, 'rev-parse', `${head}^{tree}`));
  const rec = parseReady(git(origin, 'log', '-1', '--format=%B', sha));
  assert.equal(rec.status, 'ready');
  assert.equal(rec.branch, 'claude/anvil');
  assert.equal(rec.head, head);
  assert.equal(rec.session, 'session-m1');
  assert.equal(rec.machine, 'm1');
  assert.deepEqual(rec.checks, out.checks);
});

test('keel ready refuses the full gate as a fast check, a failing fast check, the default branch and an uncommitted tree; nothing is pushed', async t => {
  const { a, origin, env, gateRuns } = await acme(t);
  git(a, 'checkout', '-q', '-b', 'claude/anvil');
  await writeFile(join(a, 'anvil.txt'), 'two anvils\n');
  git(a, 'commit', '-q', '-am', 'acme: two anvils');
  // The full gate, named as a fast check (spacing aside), is refused before anything runs.
  const gate = run(process.execPath, [BIN, 'ready', '--check', 'node  gate.mjs', '--json'], { cwd: a, env: env('m1') });
  assert.equal(gate.status, 2, gate.stdout);
  assert.match(JSON.parse(gate.stdout).error, /never runs the full gate/);
  assert.throws(() => fastChecks({ check: 'npm test' }, ['npm test']), /never runs the full gate/);
  assert.throws(() => fastChecks({}, ['npm run check']), /never runs the full gate/);
  assert.equal(await gateRuns(), 0);
  // A failing fast check: exit 1, nothing pushed.
  const failing = run(process.execPath, [BIN, 'ready', '--check', 'node fast.mjs', '--json'], { cwd: a, env: { ...env('m1'), FAST_FAIL: '1' } });
  assert.equal(failing.status, 1, failing.stdout + failing.stderr);
  assert.equal(JSON.parse(failing.stdout).ready, false);
  assert.deepEqual(remoteRefs(origin, 'ready/'), []);
  assert.deepEqual(remoteRefs(origin, 'claude/'), []);
  // An uncommitted tree is not handed off.
  await writeFile(join(a, 'loose.txt'), 'loose\n');
  const dirty = await ready({ root: a }, { env: env('m1') }).catch(e => e);
  assert.match(dirty.message, /uncommitted/);
  await rm(join(a, 'loose.txt'));
  // The default branch is the integrator's to write.
  git(a, 'checkout', '-q', 'main');
  const main = await ready({ root: a }, { env: env('m1') }).catch(e => e);
  assert.equal(main.exitCode, 2);
  assert.match(main.message, /default branch/);
  assert.deepEqual(remoteRefs(origin, 'ready/'), []);
});

test('two integrators racing for the lock: exactly one runs', async t => {
  const { a, b, origin, env, pushes } = await acme(t);
  await change(a, 'claude/anvil', { 'anvil.txt': 'two anvils\n' }, env('m1'));
  git(b, 'fetch', '-q', 'origin');
  let arrived = 0, go, loserDone;
  const barrier = new Promise(r => { go = r; });
  const lost = new Promise(r => { loserDone = r; });
  const { gate, runs } = fakeGate();
  // Both have read the remote before either pushes the lock; the winner's gate waits until the loser has answered.
  const beforeLock = async () => { if (++arrived === 2) go(); await barrier; };
  const slowGate = async dir => { await Promise.race([lost, new Promise(r => setTimeout(r, 5000))]); return gate(dir); };
  const one = (root, m) => integrate({ root }, { env: env(m), gate: slowGate, beforeLock }).then(r => { if (r.data.refused) loserDone(); return r; });
  const results = await Promise.all([one(a, 'm1'), one(b, 'm2')]);
  const refused = results.filter(r => r.data.refused), ran = results.filter(r => !r.data.refused);
  assert.equal(refused.length, 1, JSON.stringify(results.map(r => r.data)));
  assert.equal(ran.length, 1);
  assert.equal(refused[0].exitCode, 1);
  assert.match(refused[0].text, /Another integrator holds claims\/integrate/);
  assert.equal(runs.length, 1, 'one gate run, by the one integrator');
  assert.deepEqual(ran[0].data.landed.map(l => l.branch), ['claude/anvil']);
  assert.equal((await pushes()).length, 1);
  // The lock is released when the run ends.
  assert.deepEqual(remoteRefs(origin, LOCK), []);
});

test('the full gate runs once for a batch that passes, and the batch lands in one push', async t => {
  const { a, b, origin, env, pushes } = await acme(t);
  await change(a, 'claude/anvil', { 'anvil.txt': 'two anvils\n' }, env('m1'));
  await change(b, 'codex/rocket', { 'rocket.txt': 'one rocket\n' }, env('m2'));
  const { gate, runs } = fakeGate();
  const r = await integrate({ root: a }, { env: env('m1'), gate });
  assert.equal(r.exitCode ?? 0, 0, r.text);
  assert.equal(r.data.gates, 1);
  assert.equal(runs.length, 1);
  assert.deepEqual(runs, ['anvil.txt,rocket.txt'], 'the one run is on the combined tree');
  assert.deepEqual(r.data.landed.map(l => l.branch), ['claude/anvil', 'codex/rocket'], 'in the order they were marked ready');
  assert.deepEqual(await pushes(), [r.data.pushed]);
  assert.equal(git(origin, 'rev-parse', 'main'), r.data.pushed);
  assert.ok(onMain(origin, 'rocket.txt'));
  assert.equal(git(origin, 'show', 'main:anvil.txt'), 'two anvils');
  assert.deepEqual(remoteRefs(origin, 'ready/'), [], 'landed changes lose their ready refs');
  assert.match(r.text, /ran 1 time\./);
});

test('three ready changes, one breaking the gate: the two good ones land in one push, the bad one is isolated by splitting and reported', async t => {
  const { a, b, origin, env, pushes } = await acme(t);
  await change(a, 'claude/anvil', { 'anvil-two.txt': 'two anvils\n' }, env('m1'));
  const bad = await change(b, 'codex/broken', { 'broken.txt': 'BREAK\n' }, env('m2'));
  await change(a, 'claude/rocket', { 'rocket.txt': 'one rocket\n' }, env('m1'));
  const { gate, runs } = fakeGate();
  const r = await integrate({ root: a }, { env: env('m1'), gate });
  assert.equal(r.exitCode, 1, 'a change was sent back');
  assert.deepEqual(r.data.landed.map(l => l.branch), ['claude/anvil', 'claude/rocket']);
  assert.equal(r.data.blocked.length, 1);
  assert.equal(r.data.blocked[0].branch, 'codex/broken');
  assert.equal(r.data.blocked[0].head, bad);
  assert.match(r.data.blocked[0].reason, /fails the gate on main/);
  assert.deepEqual(r.data.blocked[0].with, []);
  // The whole batch first, then the halves: [anvil, broken] on main, anvil alone, broken on anvil and alone on main, rocket on anvil.
  assert.equal(runs[0], 'anvil-two.txt,anvil.txt,broken.txt,rocket.txt');
  assert.equal(r.data.gates, runs.length);
  assert.equal(runs.length, 6);
  assert.equal((await pushes()).length, 1, 'one push');
  assert.ok(onMain(origin, 'anvil-two.txt') && onMain(origin, 'rocket.txt'));
  assert.ok(!onMain(origin, 'broken.txt'), 'nothing failing is pushed');
  // The pushed tree is one the gate passed.
  assert.ok(runs.includes('anvil-two.txt,anvil.txt,rocket.txt'));
  // Reported back: its ready ref stays, now blocked, with the reason.
  assert.deepEqual(remoteRefs(origin, 'ready/'), ['ready/codex/broken']);
  const rec = parseReady(git(origin, 'log', '-1', '--format=%B', 'ready/codex/broken'));
  assert.equal(rec.status, 'blocked');
  assert.equal(rec.head, bad);
  assert.match(rec.blocked, /fails the gate/);
  assert.match(r.text, /Sent back: codex\/broken fails the gate on main/);
  // A blocked change waits for its session: the next run gates nothing.
  const again = await integrate({ root: b }, { env: env('m2'), gate });
  assert.equal(again.data.gates, 0);
  assert.deepEqual(again.data.stillBlocked.map(s => s.branch), ['codex/broken']);
  // Marked ready again by its session (fixed), it lands.
  git(b, 'checkout', '-q', 'codex/broken');
  await writeFile(join(b, 'broken.txt'), 'fixed\n');
  git(b, 'commit', '-q', '-am', 'acme: fixed');
  await ready({ root: b }, { env: env('m2'), now: (clock += 1000) });
  const fixed = await integrate({ root: b }, { env: env('m2'), gate });
  assert.equal(fixed.exitCode ?? 0, 0, fixed.text);
  assert.deepEqual(fixed.data.landed.map(l => l.branch), ['codex/broken']);
  assert.deepEqual(remoteRefs(origin, 'ready/'), []);
});

test('two individually passing changes whose combination fails: one lands, the other is reported as conflicting with it, and nothing failing is pushed', async t => {
  const { a, b, origin, env, pushes } = await acme(t);
  await change(a, 'claude/left', { 'left.txt': 'left\n' }, env('m1'));
  await change(b, 'codex/right', { 'right.txt': 'right\n' }, env('m2'));
  const { gate, runs } = fakeGate();
  const r = await integrate({ root: a }, { env: env('m1'), gate });
  assert.equal(r.exitCode, 1);
  assert.deepEqual(r.data.landed.map(l => l.branch), ['claude/left']);
  assert.equal(r.data.blocked.length, 1);
  assert.equal(r.data.blocked[0].branch, 'codex/right');
  assert.match(r.data.blocked[0].reason, /conflicts with claude\/left: each passes the gate alone, and together they fail it/);
  assert.deepEqual(r.data.blocked[0].with, ['claude/left']);
  // Each passed alone (right on main is the diagnosis run); together they failed.
  assert.ok(runs.includes('anvil.txt,left.txt') && runs.includes('anvil.txt,right.txt'));
  assert.equal(runs.filter(x => x === 'anvil.txt,left.txt,right.txt').length, 2, 'the whole batch, then right on top of left');
  // One push, of a tree that passed: left only.
  const pushed = await pushes();
  assert.equal(pushed.length, 1);
  assert.ok(onMain(origin, 'left.txt'));
  assert.ok(!onMain(origin, 'right.txt'));
  assert.equal((await gate(await treeDir(t, origin))).status, 0, 'the tree on main passes the gate');
});

/** main's tree, checked out in a scratch dir. */
async function treeDir(t, origin) {
  const dir = await mkdtemp(join(tmpdir(), 'keel-integrate-main-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  execFileSync('git', ['clone', '-q', origin, dir]);
  return dir;
}

test('a change that does not merge on top of an earlier one is sent back as conflicting with it', async t => {
  const { a, b, origin, env } = await acme(t);
  await change(a, 'claude/two', { 'anvil.txt': 'two anvils\n' }, env('m1'));
  await change(b, 'codex/three', { 'anvil.txt': 'three anvils\n' }, env('m2'));
  const { gate } = fakeGate();
  const r = await integrate({ root: a }, { env: env('m1'), gate });
  assert.deepEqual(r.data.landed.map(l => l.branch), ['claude/two']);
  assert.match(r.data.blocked[0].reason, /conflicts with claude\/two: it merges onto main alone/);
  assert.equal(git(origin, 'show', 'main:anvil.txt'), 'two anvils');
});

test('only a tree the gate passed is pushable without gating it again', () => {
  const passed = new Set(['t-left']);
  assert.equal(pushable('t-left', passed), true);
  assert.equal(pushable('t-left-and-right', passed), false);
  assert.equal(pushable('t-left', new Set()), false);
});

test('main moving while the batch is gated: nothing is overwritten, nothing lands, every change stays ready', async t => {
  const { a, b, origin, env } = await acme(t);
  await change(a, 'claude/anvil', { 'anvil-two.txt': 'two anvils\n' }, env('m1'));
  const { gate } = fakeGate();
  // Someone else's push to main lands during the gate run.
  const moving = async dir => {
    git(b, 'fetch', '-q', 'origin');
    git(b, 'checkout', '-q', '-B', 'other', 'origin/main');
    await writeFile(join(b, 'other.txt'), 'pushed meanwhile\n');
    git(b, 'add', '-A');
    git(b, 'commit', '-q', '-m', 'acme: meanwhile');
    git(b, 'push', '-q', 'origin', 'HEAD:main');
    return gate(dir);
  };
  const theirs = () => git(b, 'rev-parse', 'HEAD');
  const r = await integrate({ root: a }, { env: env('m1'), gate: moving }).catch(e => e);
  assert.equal(r.exitCode, 1);
  assert.match(r.message, /could not be pushed[\s\S]*Nothing landed; every change stays ready/);
  assert.equal(git(origin, 'rev-parse', 'main'), theirs(), 'their push is not overwritten');
  assert.deepEqual(remoteRefs(origin, 'ready/'), ['ready/claude/anvil']);
  assert.deepEqual(remoteRefs(origin, LOCK), [], 'the lock is released on the way out');
});

test('keel integrate through the CLI: the project\'s own check is the gate, in a worktree; the checkout is untouched and the lock released', async t => {
  const { a, b, origin, env, pushes, gateRuns } = await acme(t);
  await change(a, 'claude/anvil', { 'anvil.txt': 'two anvils\n' }, env('m1'));
  await change(b, 'codex/broken', { 'broken.txt': 'BREAK\n' }, env('m2'));
  git(a, 'checkout', '-q', 'main');
  const before = git(a, 'rev-parse', 'HEAD');
  const r = run(process.execPath, [BIN, 'integrate', '--json'], { cwd: a, env: env('m1') });
  assert.equal(r.status, 1, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.landed.map(l => l.branch), ['claude/anvil']);
  assert.deepEqual(out.blocked.map(l => l.branch), ['codex/broken']);
  assert.equal(out.command, 'node gate.mjs');
  assert.equal(await gateRuns(), out.gates);
  assert.equal((await pushes()).length, 1);
  assert.ok(!onMain(origin, 'broken.txt'));
  assert.equal(git(a, 'rev-parse', 'HEAD'), before, 'the integrator\'s own checkout is not moved');
  assert.equal(git(a, 'status', '--porcelain'), '');
  assert.equal(git(a, 'worktree', 'list').split('\n').length, 1, 'the worktree is removed');
  assert.deepEqual(remoteRefs(origin, LOCK), []);
  // A lock someone holds: refused, exit 1, nothing gated.
  git(origin, 'branch', LOCK, 'main');
  const held = run(process.execPath, [BIN, 'integrate', '--json'], { cwd: a, env: env('m1') });
  assert.equal(held.status, 1);
  assert.equal(JSON.parse(held.stdout).refused, true);
  assert.equal(await gateRuns(), out.gates);
});
