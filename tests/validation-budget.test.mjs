import './helpers/hermetic.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcesses from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mkdirSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, symlink, chmod, link, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, runAsync } from './helpers/run.mjs';
import { inspectBudgetTarget, inspectBudget, runBudget } from '../lib/validation-budget.mjs';

const CLI = fileURLToPath(new URL('../scripts/validation-budget.mjs', import.meta.url));
const pause = ms => new Promise(done => setTimeout(done, ms));
async function until(check, timeout = 15000) {
  const end = performance.now() + timeout;
  while (performance.now() < end) { if (await check()) return; await pause(20); }
  assert.fail('Acme condition did not complete within its bound');
}
const exists = async path => { try { await readFile(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
function git(root, args) { const r = run('git', ['-c', 'core.fsmonitor=false', '-C', root, ...args]); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); }
async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'plates-acme-admission-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const manifest = join(dir, 'manifest.json'), roots = [join(dir, 'anvil'), join(dir, 'forge')], repos = ['acme/anvil', 'acme/forge'];
  await writeFile(manifest, JSON.stringify(repos.map(repo => ({ repo, role: 'managed' }))));
  for (let i = 0; i < roots.length; i++) {
    await mkdir(join(roots[i], '.plates'), { recursive: true });
    await writeFile(join(roots[i], '.plates', 'plates.json'), JSON.stringify({ repo: repos[i], check: 'npm run acme-required' }));
    git(roots[i], ['init', '-q']); git(roots[i], ['add', '.plates']); git(roots[i], ['commit', '-qm', 'Acme baseline']); git(roots[i], ['remote', 'add', 'origin', `https://github.com/${repos[i]}.git`]);
  }
  const stateDir = join(dir, 'host-budget');
  const options = index => ({ manifest, root: roots[index], repo: repos[index] });
  const args = (mode, index = 0, extra = [], argv = [process.execPath, '-e', 'process.exit(0)']) => [CLI, mode, '--manifest', manifest, '--repo', repos[index], '--root', roots[index], '--state-dir', stateDir, '--capacity', '1', '--foreground-contract', '--json', ...extra, '--', ...argv];
  return { dir, manifest, roots, repos, stateDir, options, args };
}

test('status and plans are read-only, retain command digest only, and require managed actual identity', async t => {
  const f = await fixture(t), secret = 'Acme-secret-not-for-receipts';
  const status = run(process.execPath, [CLI, 'status', '--state-dir', f.stateDir, '--json']);
  assert.equal(status.status, 0, status.stderr); assert.equal(JSON.parse(status.stdout).initialized, false);
  const plan = run(process.execPath, f.args('plan', 0, [], [process.execPath, '-e', `throw new Error('${secret}')`]));
  assert.equal(plan.status, 0, plan.stderr); const data = JSON.parse(plan.stdout);
  assert.equal(data.executes, false); assert.equal(data.target.repo, 'acme/anvil'); assert.equal(data.argvCount, 3); assert.match(data.commandDigest, /^[a-f0-9]{64}$/); assert.ok(!plan.stdout.includes(secret));
  await assert.rejects(readFile(join(f.stateDir, 'state.json')), { code: 'ENOENT' });
  git(f.roots[0], ['remote', 'set-url', 'origin', 'https://github.com/acme/wrong.git']);
  const denied = run(process.execPath, f.args('run')); assert.equal(denied.status, 2); assert.match(denied.stderr, /repository_identity_mismatch/);
  await assert.rejects(readFile(join(f.stateDir, 'state.json')), { code: 'ENOENT' });
});

test('inspection isolates Git environment and refuses checkout filters or repository-local executables', async t => {
  const f = await fixture(t), marker = join(f.dir, 'inspection-ran');
  const injected = run(process.execPath, f.args('plan'), { env: { ...process.env, GIT_DIR: join(f.roots[1], '.git'), GIT_WORK_TREE: f.roots[1], GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: `touch ${marker}` } });
  assert.equal(injected.status, 0, injected.stderr); assert.equal(JSON.parse(injected.stdout).target.repo, f.repos[0]); assert.equal(await exists(marker), false);
  git(f.roots[0], ['config', 'filter.acme.clean', `touch ${marker}`]);
  const filtered = run(process.execPath, f.args('plan')); assert.equal(filtered.status, 2); assert.match(filtered.stderr, /repository_filters_unsupported/); assert.equal(await exists(marker), false);
  git(f.roots[0], ['config', '--unset', 'filter.acme.clean']);
  const bin = join(f.roots[0], 'bin'); await mkdir(bin); await writeFile(join(bin, 'git'), '#!/bin/sh\nexit 91\n', { mode: 0o700 });
  const local = run(process.execPath, f.args('plan'), { env: { ...process.env, PATH: bin + ':' + process.env.PATH } });
  assert.equal(local.status, 2); assert.match(local.stderr, /target_git_executable_refused/);
  const relative = run(process.execPath, f.args('plan'), { env: { ...process.env, PATH: '.:' + process.env.PATH } });
  assert.equal(relative.status, 2); assert.match(relative.stderr, /relative_path_entry_refused/);
  await assert.rejects(readFile(join(f.stateDir, 'state.json')), { code: 'ENOENT' });
});

test('state inside the target checkout is refused by plan and run without bookkeeping writes', async t => {
  const f = await fixture(t);
  for (const stateDir of [f.roots[0], join(f.roots[0], 'admission-state')]) {
    for (const mode of ['plan', 'run']) {
      const args = f.args(mode); args[args.indexOf('--state-dir') + 1] = stateDir;
      const result = run(process.execPath, args); assert.equal(result.status, 2); assert.match(result.stderr, /state_inside_target_refused/);
      assert.equal(await exists(join(stateDir, 'state.json')), false);
    }
  }
});

test('explicit foreground contract and valid weights are required before any workload or state write', async t => {
  const f = await fixture(t), marker = join(f.dir, 'executed');
  const argv = [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)}, 'Acme')`];
  const missing = run(process.execPath, f.args('run', 0, [], argv).filter(arg => arg !== '--foreground-contract'));
  assert.equal(missing.status, 2); assert.equal(await exists(marker), false);
  for (const weight of ['0', '2', 'NaN']) {
    const r = run(process.execPath, f.args('run', 0, ['--weight', weight], argv)); assert.equal(r.status, 2); assert.equal(await exists(marker), false);
  }
  await assert.rejects(readFile(join(f.stateDir, 'state.json')), { code: 'ENOENT' });
  const help = run(process.execPath, [CLI, '--help', '--json']); assert.equal(help.status, 0); assert.match(JSON.parse(help.stdout).usage, /foreground-contract/);
});

test('confirmed success and failure preserve argv, environment and exit status without persisting private values', async t => {
  const f = await fixture(t), capture = join(f.dir, 'capture.json'), secret = 'Acme-private-value';
  const argv = [process.execPath, '-e', `require('fs').writeFileSync(process.argv[1], JSON.stringify({args:process.argv.slice(2),value:process.env.ACME_VALUE,marker:process.env.NODE_TEST_ACME}));process.exit(7)`, capture, 'literal $(touch forbidden)', 'with space', '', secret];
  const r = run(process.execPath, f.args('run', 0, [], argv), { env: { ...process.env, ACME_VALUE: secret, NODE_TEST_ACME: 'remove inherited test marker' } });
  assert.equal(r.status, 7, r.stderr); const report = JSON.parse(r.stdout); assert.equal(report.released, true); assert.equal(report.childStatus, 7); assert.equal(report.foregroundContract, 'posix-cooperative-process-group'); assert.equal(report.cpuMs, null);
  assert.deepEqual(JSON.parse(await readFile(capture, 'utf8')), { args: argv.slice(4), value: secret });
  const bytes = await readFile(join(f.stateDir, 'state.json'), 'utf8'); assert.ok(!bytes.includes(secret)); assert.ok(!bytes.includes('literal $'));
  const state = await inspectBudget({ stateDir: f.stateDir, capacity: 1 }); assert.equal(state.used, 0); assert.equal(state.history.length, 1);
  const success = run(process.execPath, f.args('run')); assert.equal(success.status, 0, success.stderr);
});

test('shared state enforces contention across separate repositories and Git worktrees without altering defaults', async t => {
  const f = await fixture(t), ready = join(f.dir, 'ready'), release = join(f.dir, 'release');
  const held = [process.execPath, '-e', `const fs=require('fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(timer)}},10)`];
  const first = runAsync(process.execPath, f.args('run', 0, ['--timeout-ms', '10000'], held));
  await until(() => exists(ready));
  await until(async () => { const state = await inspectBudget({ stateDir: f.stateDir }); return !state.coordinationBusy && state.leases.some(row => row.state === 'running' && Number.isInteger(row.childPid) && row.childPid > 1); });
  const denied = run(process.execPath, f.args('run', 1)); assert.equal(denied.status, 2); assert.match(denied.stderr, /capacity_busy/);
  const worktree = join(f.dir, 'anvil-worktree'); git(f.roots[0], ['worktree', 'add', '-qb', 'acme-worktree', worktree]);
  const args = f.args('run'); args[args.indexOf('--root') + 1] = worktree;
  const alsoDenied = run(process.execPath, args); assert.equal(alsoDenied.status, 2); assert.match(alsoDenied.stderr, /capacity_busy/);
  const during = await inspectBudget({ stateDir: f.stateDir, capacity: 1 }); assert.equal(during.used, 1); assert.equal(during.leases.length, 1); assert.equal(during.leases[0].root, f.roots[0]);
  await writeFile(release, 'Acme released'); const done = await first; assert.equal(done.status, 0, done.stderr);
  const next = run(process.execPath, f.args('run', 1)); assert.equal(next.status, 0, next.stderr);
  assert.equal((await inspectBudget({ stateDir: f.stateDir, capacity: 1 })).history.length, 2);
});

test('two fresh competing writers admit at most capacity and never overwrite another reservation', async t => {
  const f = await fixture(t), ready = join(f.dir, 'ready'), release = join(f.dir, 'release');
  const argv = [process.execPath, '-e', `const fs=require('fs');fs.appendFileSync(${JSON.stringify(ready)},'Acme\\n');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))clearInterval(timer)},10)`];
  const a = runAsync(process.execPath, f.args('run', 0, ['--timeout-ms', '30000'], argv));
  const b = runAsync(process.execPath, f.args('run', 1, ['--timeout-ms', '30000'], argv));
  try {
    // A held winner cannot exit normally until released: the first result is a
    // bounded admission refusal, never an assumed startup sleep.
    const first = await Promise.race([a, b]); assert.equal(first.status, 2, first.stderr);
    await until(async () => (await inspectBudget({ stateDir: f.stateDir })).initialized);
    const state = await inspectBudget({ stateDir: f.stateDir, capacity: 1 });
    assert.ok(state.used <= 1); assert.ok(state.leases.length <= 1);
  } finally { await writeFile(release, 'go'); }
  const results = await Promise.all([a, b]);
  assert.deepEqual(results.map(result => result.status).sort(), [0, 2]);
  const runs = await exists(ready) ? (await readFile(ready, 'utf8')).trim().split('\n').length : 0;
  assert.ok(runs <= 1, 'at most one competing workload executes');
  const state = await inspectBudget({ stateDir: f.stateDir, capacity: 1 });
  assert.ok(state.leases.length + state.history.filter(row => row.released).length <= 1);
  assert.equal(state.used, 0);
});

test('weighted admission keeps spare capacity usable and refuses only excess work', async t => {
  const f = await fixture(t), ready = join(f.dir, 'weighted-ready'), release = join(f.dir, 'weighted-release');
  const argsFor = (index, weight, argv) => { const args = f.args('run', index, ['--weight', String(weight), '--timeout-ms', '30000'], argv); args[args.indexOf('--capacity') + 1] = '3'; return args; };
  const held = [process.execPath, '-e', `const fs=require('fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))clearInterval(timer)},10)`];
  const pending = runAsync(process.execPath, argsFor(0, 2, held));
  try {
    await until(() => exists(ready));
    await until(async () => { const state = await inspectBudget({ stateDir: f.stateDir }); return !state.coordinationBusy && state.leases.some(row => row.state === 'running' && Number.isInteger(row.childPid) && row.childPid > 1); });
    const excess = run(process.execPath, argsFor(1, 2)); assert.equal(excess.status, 2); assert.match(excess.stderr, /capacity_busy/);
    const spare = run(process.execPath, argsFor(1, 1)); assert.equal(spare.status, 0, spare.stderr);
    assert.equal((await inspectBudget({ stateDir: f.stateDir })).used, 2);
  } finally { await writeFile(release, 'go'); }
  assert.equal((await pending).status, 0); assert.equal((await inspectBudget({ stateDir: f.stateDir })).used, 0);
});

test('owned completion waits for a healthy competing writer and never steals a stranded guard', async t => {
  for (const stranded of [false, true]) {
    const f = await fixture(t), ready = join(f.dir, 'writer-ready'), release = join(f.dir, 'writer-release'), exited = join(f.dir, 'writer-exited');
    const target = await inspectBudgetTarget(f.options(0));
    const argv = [process.execPath, '-e', `const fs=require('fs');fs.writeFileSync(${JSON.stringify(ready)},String(process.pid));const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(timer);fs.writeFileSync(${JSON.stringify(exited)},'exiting');process.exit(7)}},10)`];
    const pending = runBudget({ stateDir: f.stateDir, capacity: 1, target, argv, foreground: true, json: true, timeoutMs: 30000 });
    await until(() => exists(ready));
    const childPid = Number(await readFile(ready, 'utf8')); assert.ok(Number.isInteger(childPid) && childPid > 1);
    await until(async () => { const state = await inspectBudget({ stateDir: f.stateDir }); return !state.coordinationBusy && state.leases.some(row => row.state === 'running' && row.childPid === childPid); });
    const guard = join(f.stateDir, 'coordination'); await mkdir(guard, { mode: 0o700 });
    const ownerPath = join(guard, 'owner.json'), ownerBytes = JSON.stringify({ id: 'Acme-other-writer' });
    await writeFile(ownerPath, ownerBytes, { mode: 0o600 });
    try {
      await writeFile(release, 'go'); await until(() => exists(exited));
      await until(() => { try { process.kill(childPid, 0); return false; } catch (error) { return error.code === 'ESRCH'; } });
      // Child exit is observed first; a bounded turn gives this same-process
      // runBudget its close callback while the synthetic writer owns the guard.
      await pause(100);
      assert.equal(await readFile(ownerPath, 'utf8'), ownerBytes);
      if (!stranded) { await unlink(ownerPath); await rmdir(guard); }
      const result = await pending;
      assert.equal(result.status, stranded ? 75 : 7); assert.equal(result.released, !stranded);
      const state = await inspectBudget({ stateDir: f.stateDir }); assert.equal(state.used, stranded ? 1 : 0);
      if (stranded) assert.equal(await readFile(ownerPath, 'utf8'), ownerBytes);
    } finally {
      await writeFile(release, 'go');
      // Only remove the exact fixture-owned guard; production never steals it.
      if (await exists(ownerPath) && await readFile(ownerPath, 'utf8') === ownerBytes) { await unlink(ownerPath); await rmdir(guard); }
      if (Number.isInteger(childPid) && childPid > 1) { try { process.kill(-childPid, 'SIGKILL'); } catch {} }
    }
  }
});

test('execution timeout starts before running bookkeeping and stops when the direct child completes', async t => {
  for (const naturalDelay of [0, 500]) {
    const f = await fixture(t), target = await inspectBudgetTarget(f.options(0));
    const guard = join(f.stateDir, 'coordination'), ownerPath = join(guard, 'owner.json');
    const ownerBytes = JSON.stringify({ id: 'Acme-start-bookkeeping-writer' });
    const originalLaunch = childProcesses.spawn; let launches = 0, releasedByExit = false, directExit;
    // Observe the actual production launch unchanged. This production-boundary
    // instrumentation follows reconciliation-parallel.test.mjs; it does not
    // launch test processes separately or alter helper context stripping.
    const observer = t.mock.method(childProcesses, 'spawn', (...args) => {
      const child = Reflect.apply(originalLaunch, childProcesses, args); launches++;
      mkdirSync(guard, { mode: 0o700 }); writeFileSync(ownerPath, ownerBytes, { mode: 0o600 });
      child.once('exit', (status, signal) => {
        directExit = { status, signal };
        // Deliberately hold bookkeeping past the 100ms execution deadline AFTER
        // observed exit. This tests false timeout classification, not startup.
        setTimeout(() => { unlinkSync(ownerPath); rmdirSync(guard); releasedByExit = true; }, 150);
      });
      return child;
    });
    syncBuiltinESMExports();
    try {
      const result = await runBudget({ stateDir: f.stateDir, capacity: 1, target, argv: ['/bin/sh', '-c', naturalDelay ? 'sleep 1' : 'exit 0'], foreground: true, json: true, timeoutMs: 100 });
      assert.equal(launches, 1); assert.equal(releasedByExit, true);
      // A descheduled fast child may legitimately exceed its execution deadline.
      // Once actual exit0 is observed, bookkeeping alone must never make it a timeout.
      const expectedTimeout = Boolean(naturalDelay) || directExit.status !== 0;
      assert.equal(result.status, expectedTimeout ? 124 : 0); assert.equal(result.timedOut, expectedTimeout); assert.equal(result.released, true);
      if (!naturalDelay) t.diagnostic(JSON.stringify({ fastChildExit: directExit, confirmedFastSuccess: directExit.status === 0 }));
      assert.equal((await inspectBudget({ stateDir: f.stateDir })).used, 0);
    } finally {
      observer.mock.restore(); syncBuiltinESMExports();
      if (await exists(ownerPath) && await readFile(ownerPath, 'utf8') === ownerBytes) { await unlink(ownerPath); await rmdir(guard); }
    }
  }
});

test('a missing executable fails once and releases its reservation with a spawn diagnosis', async t => {
  const f = await fixture(t);
  const result = run(process.execPath, f.args('run', 0, [], [join(f.dir, 'missing-acme-binary')]));
  assert.equal(result.status, 1, result.stderr); const report = JSON.parse(result.stdout);
  assert.equal(report.spawnError, 'ENOENT'); assert.equal(report.released, true);
  const state = await inspectBudget({ stateDir: f.stateDir }); assert.equal(state.used, 0); assert.equal(state.history.length, 1);
});

test('capacity conflicts, missing prior state, foreign host and old leases fail closed', async t => {
  const f = await fixture(t);
  assert.equal(run(process.execPath, f.args('run')).status, 0);
  const changed = f.args('run'); changed[changed.indexOf('--capacity') + 1] = '2';
  const conflict = run(process.execPath, changed); assert.equal(conflict.status, 2); assert.match(conflict.stderr, /capacity_policy_conflict/);
  const path = join(f.stateDir, 'state.json'), original = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...original, host: 'Acme-other-host' }));
  const foreign = run(process.execPath, f.args('run')); assert.equal(foreign.status, 2); assert.match(foreign.stderr, /foreign_state/);
  const target = await inspectBudgetTarget(f.options(0));
  const stale = { id: 'Acme-stale', foregroundContract: 'posix-cooperative-process-group', pid: 99999999, uid: process.getuid(), host: original.host, root: target.root, repo: target.repo, revision: target.revision, weight: 1, childPid: 99999998, state: 'uncertain', commandDigest: 'a'.repeat(64), createdAt: '1999-01-01T00:00:00Z' };
  await writeFile(path, JSON.stringify({ ...original, leases: [stale] }));
  const staleResult = run(process.execPath, f.args('run')); assert.equal(staleResult.status, 2); assert.match(staleResult.stderr, /capacity_busy/); assert.deepEqual((await inspectBudget({ stateDir: f.stateDir })).leases, [stale]);
  await rm(path); const missing = run(process.execPath, f.args('run')); assert.equal(missing.status, 2); assert.match(missing.stderr, /state_missing/);
});

test('unsafe state symlinks, permissions, linked files and stranded coordination are refusals', async t => {
  const f = await fixture(t), outside = join(f.dir, 'outside'); await mkdir(outside, { mode: 0o700 });
  await symlink(outside, f.stateDir); assert.equal(run(process.execPath, f.args('run')).status, 2); await rm(f.stateDir);
  assert.equal(run(process.execPath, f.args('run')).status, 0);
  await chmod(f.stateDir, 0o755); const unsafe = run(process.execPath, f.args('run')); assert.equal(unsafe.status, 2); assert.match(unsafe.stderr, /unsafe_state_directory/); await chmod(f.stateDir, 0o700);
  const path = join(f.stateDir, 'state.json'), saved = await readFile(path); await rm(path); const destination = join(outside, 'state.json'); await writeFile(destination, saved, { mode: 0o600 }); await symlink(destination, path);
  assert.equal(run(process.execPath, f.args('run')).status, 2); assert.deepEqual(await readFile(destination), saved); await rm(path); await writeFile(path, saved, { mode: 0o600 });
  const alias = join(outside, 'alias.json'); await link(path, alias); assert.equal(run(process.execPath, f.args('run')).status, 2); await unlink(alias);
  await mkdir(join(f.stateDir, 'coordination'), { mode: 0o700 }); const busy = run(process.execPath, f.args('run')); assert.equal(busy.status, 2); assert.match(busy.stderr, /coordination_busy/); assert.equal((await inspectBudget({ stateDir: f.stateDir })).coordinationBusy, true);
});

test('timeout terminates its owned foreground group and preserves timeout outcome without retry', async t => {
  const f = await fixture(t), marker = join(f.dir, 'runs');
  const argv = ['/bin/sh', '-c', 'printf once > "$1"; trap "" TERM; exec sleep 60', 'acme', marker];
  const result = run(process.execPath, f.args('run', 0, ['--timeout-ms', '100'], argv), { timeout: 10000 });
  assert.equal(result.status, 124, result.stderr); const report = JSON.parse(result.stdout); assert.equal(report.timedOut, true); assert.equal(report.released, true); if (await exists(marker)) assert.equal(await readFile(marker, 'utf8'), 'once');
  assert.equal((await inspectBudget({ stateDir: f.stateDir })).used, 0);
});

test('a surviving foreground descendant retains capacity after its direct parent exits', async t => {
  const f = await fixture(t), release = join(f.dir, 'descendant-release');
  const argv = ['/bin/sh', '-c', '(while [ ! -f "$1" ]; do sleep 0.01; done) >/dev/null 2>&1 &', 'acme', release];
  try {
    const result = run(process.execPath, f.args('run', 0, [], argv)); assert.equal(result.status, 75, result.stderr);
    const report = JSON.parse(result.stdout); assert.equal(report.released, false); assert.equal(report.childStatus, 0);
    const state = await inspectBudget({ stateDir: f.stateDir }); assert.equal(state.used, 1); assert.equal(state.leases[0].state, 'uncertain');
  } finally { await writeFile(release, 'stop'); }
  const next = run(process.execPath, f.args('run', 1)); assert.equal(next.status, 2); assert.match(next.stderr, /capacity_busy/);
});

test('a confirmed-start command receives forwarded termination and releases its proven exited group', async t => {
  const f = await fixture(t), ready = join(f.dir, 'ready');
  const argv = [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(ready)},JSON.stringify({wrapper:process.ppid,child:process.pid}));setInterval(()=>{},1000)`];
  const pending = runAsync(process.execPath, f.args('run', 0, ['--timeout-ms', '30000'], argv));
  let owned;
  try {
    await until(() => exists(ready)); owned = JSON.parse(await readFile(ready, 'utf8'));
    assert.ok(Number.isInteger(owned.child) && owned.child > 1); assert.ok(Number.isInteger(owned.wrapper) && owned.wrapper > 1);
    await until(async () => (await inspectBudget({ stateDir: f.stateDir })).leases.some(row => row.pid === owned.wrapper && row.childPid === owned.child));
    process.kill(owned.wrapper, 'SIGTERM');
    const result = await pending; assert.equal(result.status, 143, result.stderr);
    assert.equal(JSON.parse(result.stdout).released, true);
    assert.equal((await inspectBudget({ stateDir: f.stateDir })).used, 0);
  } finally {
    if (Number.isInteger(owned?.child) && owned.child > 1) { try { process.kill(-owned.child, 'SIGKILL'); } catch {} }
  }
});

test('a killed wrapper leaves its lease reserved even after its owned child is stopped', async t => {
  const f = await fixture(t), ready = join(f.dir, 'ready');
  const argv = [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(ready)},JSON.stringify({wrapper:process.ppid,child:process.pid}));setInterval(()=>{},1000)`];
  const pending = runAsync(process.execPath, f.args('run', 0, ['--timeout-ms', '30000'], argv));
  let owned;
  try {
    await until(() => exists(ready)); owned = JSON.parse(await readFile(ready, 'utf8'));
    assert.ok(Number.isInteger(owned.child) && owned.child > 1); assert.ok(Number.isInteger(owned.wrapper) && owned.wrapper > 1);
    await until(async () => (await inspectBudget({ stateDir: f.stateDir })).leases.some(row => row.pid === owned.wrapper && row.childPid === owned.child));
    process.kill(owned.wrapper, 'SIGKILL');
    if (Number.isInteger(owned.child) && owned.child > 1) { try { process.kill(-owned.child, 'SIGKILL'); } catch {} }
    await pending;
    const after = await inspectBudget({ stateDir: f.stateDir }); assert.equal(after.used, 1); assert.equal(after.leases[0].pid, owned.wrapper);
    const next = run(process.execPath, f.args('run', 1)); assert.equal(next.status, 2); assert.match(next.stderr, /capacity_busy/);
  } finally {
    if (Number.isInteger(owned?.child) && owned.child > 1) { try { process.kill(-owned.child, 'SIGKILL'); } catch {} }
  }
});

test('five paired synthetic workloads preserve outcomes; timings are observations, not savings', async t => {
  const f = await fixture(t), target = await inspectBudgetTarget(f.options(0)), output = join(f.dir, 'output');
  const argv = [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(output)}, String(Array.from({length:1000},(_,i)=>i).reduce((a,b)=>a+b,0)))`];
  const pairs = [];
  for (let index = 0; index < 5; index++) {
    const start = performance.now(), direct = run(argv[0], argv.slice(1), { cwd: target.root }), directWallMs = performance.now() - start;
    const directResult = await readFile(output, 'utf8'); await rm(output);
    const admitted = await runBudget({ stateDir: f.stateDir, capacity: 1, target, argv, foreground: true, json: true });
    assert.equal(direct.status, 0); assert.equal(admitted.status, 0); assert.equal(await readFile(output, 'utf8'), directResult);
    pairs.push({ index, workload: 'Acme sum 0..999', directStatus: direct.status, admittedStatus: admitted.status, directWallMs, admittedWallMs: admitted.wallMs, cpuMs: null, overlapping: false, interpretation: 'paired correctness observation, not speedup benchmark' });
  }
  t.diagnostic(JSON.stringify({ schema: 1, pairs, runtime: process.version, authority: 'synthetic-correctness-only' }));
  assert.equal((await inspectBudget({ stateDir: f.stateDir })).history.length, 5);
});
