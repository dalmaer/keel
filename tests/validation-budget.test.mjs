import './helpers/hermetic.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import childProcesses from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { constants, mkdirSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import fileOperations from 'node:fs/promises';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath, symlink, chmod, link, unlink, rmdir, readdir, stat, rename } from 'node:fs/promises';
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
const validPid = value => Number.isSafeInteger(value) && value > 1 && value < 2 ** 31;
const decodePid = text => /^\d+\n$/.test(text) && validPid(Number(text)) ? Number(text) : undefined;
const decodeOwner = text => { const value = JSON.parse(text); return value && validPid(value.child) && validPid(value.wrapper) ? value : undefined; };
async function waitForMarker(path, decode, timeout = 15000) {
  let value;
  await until(async () => {
    let text;
    try { text = await readFile(path, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    try { value = decode(text); }
    catch (error) { if (error instanceof SyntaxError) return false; throw error; }
    return value !== undefined;
  }, timeout);
  return value;
}
const waitForText = (path, expected) => waitForMarker(path, text => text === expected ? text : undefined);
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

test('marker handshakes wait through empty and partial publication before accepting complete values', async t => {
  const f = await fixture(t);
  for (const [name, decode, partial, complete, expected] of [
    ['pid', decodePid, '123', '12345\n', 12345],
    ['owner', decodeOwner, '{"wrapper":12345,', '{"wrapper":12345,"child":23456}', { wrapper: 12345, child: 23456 }],
  ]) {
    const path = join(f.dir, name); await writeFile(path, '');
    let observed = Promise.withResolvers(), expectedRead = '', settled = false;
    const pending = waitForMarker(path, text => { if (text === expectedRead) observed.resolve(text); return decode(text); });
    pending.then(() => { settled = true; }, () => {});
    assert.equal(await Promise.race([observed.promise, pending]), ''); assert.equal(settled, false);
    observed = Promise.withResolvers(); expectedRead = partial; await writeFile(path, partial);
    assert.equal(await Promise.race([observed.promise, pending]), partial); assert.equal(settled, false);
    await writeFile(path, complete); assert.deepEqual(await pending, expected);
  }
  const invalid = join(f.dir, 'never-complete'); await writeFile(invalid, '');
  await assert.rejects(waitForMarker(invalid, decodePid, 50), /within its bound/);
});

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
  const first = runAsync(process.execPath, f.args('run', 0, ['--timeout-ms', '30000'], held));
  try {
    await waitForText(ready, 'ready');
    await until(async () => { const state = await inspectBudget({ stateDir: f.stateDir }); return !state.coordinationBusy && state.leases.some(row => row.state === 'running' && Number.isInteger(row.childPid) && row.childPid > 1); });
    const denied = run(process.execPath, f.args('run', 1)); assert.equal(denied.status, 2); assert.match(denied.stderr, /capacity_busy/);
    const worktree = join(f.dir, 'anvil-worktree'); git(f.roots[0], ['worktree', 'add', '-qb', 'acme-worktree', worktree]);
    const args = f.args('run'); args[args.indexOf('--root') + 1] = worktree;
    const alsoDenied = run(process.execPath, args); assert.equal(alsoDenied.status, 2); assert.match(alsoDenied.stderr, /capacity_busy/);
    const during = await inspectBudget({ stateDir: f.stateDir, capacity: 1 }); assert.equal(during.used, 1); assert.equal(during.leases.length, 1); assert.equal(during.leases[0].root, f.roots[0]);
  } finally { await writeFile(release, 'Acme released'); await first; }
  const done = await first; assert.equal(done.status, 0, done.stderr);
  const next = run(process.execPath, f.args('run', 1)); assert.equal(next.status, 0, next.stderr);
  assert.equal((await inspectBudget({ stateDir: f.stateDir, capacity: 1 })).history.length, 2);
});

test('two fresh competing writers admit at most capacity and never overwrite another reservation', { timeout: 45000 }, async t => {
  const f = await fixture(t), ready = join(f.dir, 'ready'), release = join(f.dir, 'release');
  const argv = [process.execPath, '-e', `const fs=require('fs');fs.appendFileSync(${JSON.stringify(ready)},'Acme\\n');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))clearInterval(timer)},10)`];
  const a = runAsync(process.execPath, f.args('run', 0, ['--timeout-ms', '30000'], argv), { timeout: 35000 });
  const b = runAsync(process.execPath, f.args('run', 1, ['--timeout-ms', '30000'], argv), { timeout: 35000 });
  try {
    // A held winner cannot exit normally until released: the first result is a
    // bounded admission refusal, never an assumed startup sleep.
    const first = await Promise.race([a, b]); assert.equal(first.status, 2, first.stderr);
    await waitForText(ready, 'Acme\n');
    // Ready precedes running-state bookkeeping. Inspect only after both
    // wrappers settle: atomic publication may legitimately unlink an open reader.
  } finally { await writeFile(release, 'go'); await Promise.allSettled([a, b]); }
  const results = await Promise.all([a, b]);
  assert.deepEqual(results.map(result => result.status).sort(), [0, 2]);
  assert.equal(await readFile(ready, 'utf8'), 'Acme\n', 'exactly one competing workload executes');
  const winner = results.findIndex(result => result.status === 0);
  const report = JSON.parse(results[winner].stdout);
  assert.equal(report.released, true); assert.equal(report.childStatus, 0);
  const state = await inspectBudget({ stateDir: f.stateDir, capacity: 1 });
  assert.equal(state.capacity, 1); assert.equal(state.used, 0);
  assert.equal(state.coordinationBusy, false); assert.deepEqual(state.leases, []);
  assert.equal(state.history.length, 1, 'the sole reservation survives as one completion receipt');
  const receipt = state.history[0];
  assert.equal(receipt.id, report.id); assert.equal(receipt.repo, f.repos[winner]);
  assert.equal(receipt.root, f.roots[winner]); assert.equal(receipt.released, true);
  assert.equal(receipt.childStatus, 0);
});


test('state inspection refuses an inode replaced by an actual writer; settled inspection retains both receipts', { timeout: 15000 }, async t => {
  const f = await fixture(t), target = await inspectBudgetTarget(f.options(0));
  const marker = join(f.dir, 'executions');
  const options = { stateDir: f.stateDir, capacity: 1, target, argv: [process.execPath, '-e', `require('fs').appendFileSync(${JSON.stringify(marker)}, 'Acme\\n')`], foreground: true, json: true, timeoutMs: 5000 };
  const initial = await runBudget(options); assert.equal(initial.status, 0);
  const path = join(f.stateDir, 'state.json'), before = await stat(path);
  const originalOpen = fileOperations.open, readerRelease = Promise.withResolvers();
  let intercepted = false, readerWaiting = false, detached;
  const observer = t.mock.method(fileOperations, 'open', async (...args) => {
    const file = await Reflect.apply(originalOpen, fileOperations, args);
    if (args[0] === path && !(args[1] & constants.O_CREAT) && !intercepted) {
      intercepted = true; const actualStat = file.stat.bind(file);
      t.mock.method(file, 'stat', async (...values) => {
        readerWaiting = true; await readerRelease.promise;
        detached = await actualStat(...values); return detached;
      });
    }
    return file;
  });
  syncBuiltinESMExports();
  let reading, writing, completed;
  try {
    reading = inspectBudget({ stateDir: f.stateDir, capacity: 1 });
    await until(() => readerWaiting, 5000);
    // The open is real. Let the real writer publish via storeState's atomic
    // rename before the reader obtains its real stat; no verdict is mocked.
    writing = runBudget(options); completed = await writing;
    assert.equal(completed.status, 0); assert.equal(completed.released, true);
    const published = await stat(path);
    assert.notDeepEqual([published.dev, published.ino], [before.dev, before.ino]);
    const refused = assert.rejects(reading, { code: 'unsafe_input_file' });
    readerRelease.resolve(); await refused;
    assert.deepEqual([detached.dev, detached.ino], [before.dev, before.ino]);
    assert.equal(detached.nlink, 0, 'atomic replacement unlinked the opened state inode');
    assert.equal(published.nlink, 1, 'the newly published state remains singly linked');
  } finally {
    readerRelease.resolve(); await Promise.allSettled([reading, writing]);
    observer.mock.restore(); syncBuiltinESMExports();
  }
  const after = await inspectBudget({ stateDir: f.stateDir, capacity: 1 });
  assert.equal(after.used, 0); assert.equal(after.coordinationBusy, false);
  assert.deepEqual(after.leases, []);
  assert.deepEqual(after.history.map(receipt => receipt.id), [initial.id, completed.id]);
  assert.ok(after.history.every(receipt => receipt.released && receipt.childStatus === 0));
  assert.equal(await readFile(marker, 'utf8'), 'Acme\nAcme\n', 'inspection never retries a workload');
});

test('weighted admission keeps spare capacity usable and refuses only excess work', async t => {
  const f = await fixture(t), ready = join(f.dir, 'weighted-ready'), release = join(f.dir, 'weighted-release');
  const argsFor = (index, weight, argv) => { const args = f.args('run', index, ['--weight', String(weight), '--timeout-ms', '30000'], argv); args[args.indexOf('--capacity') + 1] = '3'; return args; };
  const held = [process.execPath, '-e', `const fs=require('fs');fs.writeFileSync(${JSON.stringify(ready)},'ready');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))clearInterval(timer)},10)`];
  const pending = runAsync(process.execPath, argsFor(0, 2, held));
  try {
    await waitForText(ready, 'ready');
    await until(async () => { const state = await inspectBudget({ stateDir: f.stateDir }); return !state.coordinationBusy && state.leases.some(row => row.state === 'running' && Number.isInteger(row.childPid) && row.childPid > 1); });
    const excess = run(process.execPath, argsFor(1, 2)); assert.equal(excess.status, 2); assert.match(excess.stderr, /capacity_busy/);
    const spare = run(process.execPath, argsFor(1, 1)); assert.equal(spare.status, 0, spare.stderr);
    assert.equal((await inspectBudget({ stateDir: f.stateDir })).used, 2);
  } finally { await writeFile(release, 'go'); await pending; }
  assert.equal((await pending).status, 0); assert.equal((await inspectBudget({ stateDir: f.stateDir })).used, 0);
});

test('owned completion waits for a healthy competing writer and never steals a stranded guard', async t => {
  for (const stranded of [false, true]) {
    const f = await fixture(t), ready = join(f.dir, 'writer-ready'), release = join(f.dir, 'writer-release'), exited = join(f.dir, 'writer-exited');
    const target = await inspectBudgetTarget(f.options(0));
    const argv = [process.execPath, '-e', `const fs=require('fs');fs.writeFileSync(${JSON.stringify(ready)},String(process.pid)+'\\n');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){clearInterval(timer);fs.writeFileSync(${JSON.stringify(exited)},'exiting');process.exit(7)}},10)`];
    const pending = runBudget({ stateDir: f.stateDir, capacity: 1, target, argv, foreground: true, json: true, timeoutMs: 30000 });
    const guard = join(f.stateDir, 'coordination');
    const ownerPath = join(guard, 'owner.json'), ownerBytes = JSON.stringify({ id: 'Acme-other-writer' });
    let childPid;
    try {
      childPid = await waitForMarker(ready, decodePid);
      await until(async () => { const state = await inspectBudget({ stateDir: f.stateDir }); return !state.coordinationBusy && state.leases.some(row => row.state === 'running' && row.childPid === childPid); });
      await mkdir(guard, { mode: 0o700 }); await writeFile(ownerPath, ownerBytes, { mode: 0o600 });
      await writeFile(release, 'go'); await waitForText(exited, 'exiting');
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
      if (validPid(childPid)) { try { process.kill(-childPid, 'SIGKILL'); } catch {} }
      await pending;
    }
  }
});

for (const resume of [true, false]) test(`owner observation bounds partial publication with writer resume=${resume}`, { timeout: 15000 }, async t => {
  const f = await fixture(t), target = await inspectBudgetTarget(f.options(0));
  const options = { stateDir: f.stateDir, capacity: 1, target, argv: [process.execPath, '-e', 'process.exit(0)'], foreground: true, json: true, timeoutMs: 5000 };
  assert.equal((await runBudget(options)).status, 0);
  const path = join(f.stateDir, 'coordination/owner.json');
  const ready = Promise.withResolvers(), release = Promise.withResolvers(), written = Promise.withResolvers();
  const originalOpen = fileOperations.open; let held = false, reads = 0;
  const observer = t.mock.method(fileOperations, 'open', async (...args) => {
    const file = await Reflect.apply(originalOpen, fileOperations, args);
    if (args[0] !== path) return file;
    if ((args[1] & constants.O_CREAT) && !held) {
      held = true; const write = file.writeFile.bind(file);
      t.mock.method(file, 'writeFile', async (...values) => {
        ready.resolve(); await release.promise;
        const result = await write(...values); written.resolve(); return result;
      });
    } else if (!(args[1] & constants.O_CREAT)) {
      const read = file.readFile.bind(file);
      t.mock.method(file, 'readFile', async (...values) => {
        const bytes = await read(...values); reads++;
        if (reads === 1) {
          assert.equal(bytes.length, 0, 'the actual writer has not published JSON yet');
          if (resume) { release.resolve(); await written.promise; }
        }
        return bytes;
      });
    }
    return file;
  });
  syncBuiltinESMExports();
  const pending = runBudget(options);
  try {
    await ready.promise;
    await assert.rejects(runBudget(options), { code: 'coordination_busy_inspect_do_not_steal' });
    if (resume) {
      const observed = await inspectBudget({ stateDir: f.stateDir });
      assert.equal(observed.coordinationBusy, true);
      assert.ok(observed.coordinationOwner === null || typeof observed.coordinationOwner.id === 'string');
    } else {
      await assert.rejects(inspectBudget({ stateDir: f.stateDir }), SyntaxError);
      assert.equal(reads, 4, 'persistent incomplete publication has a fixed read bound');
      assert.equal(await readFile(path, 'utf8'), '');
    }
  } finally {
    release.resolve(); await pending; observer.mock.restore(); syncBuiltinESMExports();
  }
  assert.equal((await pending).status, 0);
  const after = await inspectBudget({ stateDir: f.stateDir });
  assert.equal(after.used, 0); assert.equal(after.coordinationBusy, false);
  assert.equal(after.history.length, 2, 'observation never launches or retries a command');
});

test('owner observation remains busy when its opened owner is removed by the actual writer', { timeout: 15000 }, async t => {
  const f = await fixture(t), target = await inspectBudgetTarget(f.options(0));
  const options = { stateDir: f.stateDir, capacity: 1, target, argv: [process.execPath, '-e', 'process.exit(0)'], foreground: true, json: true, timeoutMs: 5000 };
  assert.equal((await runBudget(options)).status, 0);
  const path = join(f.stateDir, 'coordination/owner.json'), originalOpen = fileOperations.open;
  const writerReady = Promise.withResolvers(), writerRelease = Promise.withResolvers();
  const readerReady = Promise.withResolvers(), readerRelease = Promise.withResolvers();
  let held = false, holdReader = false, detachedLinks;
  const observer = t.mock.method(fileOperations, 'open', async (...args) => {
    const file = await Reflect.apply(originalOpen, fileOperations, args);
    if (args[0] !== path) return file;
    if ((args[1] & constants.O_CREAT) && !held) {
      held = true; const write = file.writeFile.bind(file);
      t.mock.method(file, 'writeFile', async (...values) => { const result = await write(...values); writerReady.resolve(); await writerRelease.promise; return result; });
    } else if (!(args[1] & constants.O_CREAT) && holdReader) {
      holdReader = false; const stat = file.stat.bind(file);
      t.mock.method(file, 'stat', async (...values) => { readerReady.resolve(); await readerRelease.promise; const result = await stat(...values); detachedLinks = result.nlink; return result; });
    }
    return file;
  });
  syncBuiltinESMExports();
  const pending = runBudget(options); let reading;
  try {
    await writerReady.promise; holdReader = true;
    reading = inspectBudget({ stateDir: f.stateDir });
    await readerReady.promise; writerRelease.resolve(); assert.equal((await pending).status, 0);
    readerRelease.resolve(); const observed = await reading;
    assert.equal(detachedLinks, 0, 'real cleanup removed the opened inode');
    assert.equal(observed.coordinationBusy, true); assert.equal(observed.coordinationOwner, null);
  } finally {
    writerRelease.resolve(); readerRelease.resolve(); await Promise.allSettled([pending, reading]);
    observer.mock.restore(); syncBuiltinESMExports();
  }
  const after = await inspectBudget({ stateDir: f.stateDir });
  assert.equal(after.used, 0); assert.equal(after.coordinationBusy, false); assert.equal(after.history.length, 2);
});

test('owner observation refuses persistent malformed data, unsafe files and replacement after open', async t => {
  for (const kind of ['malformed', 'mode', 'hardlink', 'symlink', 'replacement', 'detached-unsafe', 'state-unlinked', 'guard-replacement', 'state-replacement', 'io']) {
    const f = await fixture(t); assert.equal(run(process.execPath, f.args('run')).status, 0);
    const guard = join(f.stateDir, 'coordination'), path = join(guard, 'owner.json'), bytes = '{"id":"Acme-owner"}';
    await mkdir(guard, { mode: 0o700 }); await writeFile(path, kind === 'malformed' ? '{' : bytes, { mode: 0o600 });
    const stateBefore = await readFile(join(f.stateDir, 'state.json'));
    if (kind === 'mode' || kind === 'detached-unsafe') await chmod(path, 0o644);
    if (kind === 'hardlink') await link(path, join(f.dir, 'alias'));
    if (kind === 'symlink') { await unlink(path); const target = join(f.dir, 'target'); await writeFile(target, bytes, { mode: 0o600 }); await symlink(target, path); }
    const originalOpen = fileOperations.open; let changed = false;
    const observedPath = kind === 'state-unlinked' ? join(f.stateDir, 'state.json') : path;
    const observer = t.mock.method(fileOperations, 'open', async (...args) => {
      const file = await Reflect.apply(originalOpen, fileOperations, args);
      if (args[0] === observedPath && !changed && ['replacement', 'detached-unsafe', 'state-unlinked', 'guard-replacement', 'state-replacement', 'io'].includes(kind)) {
        changed = true; const stat = file.stat.bind(file);
        t.mock.method(file, 'stat', async (...values) => {
          if (kind === 'io') throw Object.assign(new Error('Acme I/O failure'), { code: 'EIO' });
          if (kind === 'guard-replacement' || kind === 'state-replacement') {
            const directory = kind === 'guard-replacement' ? guard : f.stateDir;
            await rename(directory, join(f.dir, 'old-directory')); await mkdir(directory, { mode: 0o700 });
            if (kind === 'state-replacement') {
              await writeFile(join(f.stateDir, 'state.json'), stateBefore, { mode: 0o600 });
              await mkdir(guard, { mode: 0o700 });
            }
            await writeFile(path, '{"id":"Acme-replacement"}', { mode: 0o600 });
          } else {
            await unlink(observedPath);
            if (kind === 'replacement') await writeFile(path, '{"id":"Acme-replacement"}', { mode: 0o600 });
          }
          return stat(...values);
        });
      }
      return file;
    });
    syncBuiltinESMExports();
    try {
      const code = { replacement: 'coordination_owner_replaced', symlink: 'symlink_path_refused', 'guard-replacement': 'coordination_directory_replaced', 'state-replacement': 'state_directory_replaced', io: 'EIO' }[kind] ?? 'unsafe_input_file';
      await assert.rejects(inspectBudget({ stateDir: f.stateDir }), kind === 'malformed' ? SyntaxError : { code });
    } finally { observer.mock.restore(); syncBuiltinESMExports(); }
    if (kind !== 'state-unlinked') assert.deepEqual(await readFile(join(f.stateDir, 'state.json')), stateBefore);
    const refused = run(process.execPath, f.args('run')); assert.equal(refused.status, 2);
    assert.equal((await stat(guard)).isDirectory(), true, 'inspection cannot remove or steal the guard');
    if (kind === 'replacement') assert.equal(await readFile(path, 'utf8'), '{"id":"Acme-replacement"}');
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

async function fullHistory(f, { count = 3, nearLimit = true } = {}) {
  assert.equal(run(process.execPath, f.args('run')).status, 0);
  const path = join(f.stateDir, 'state.json'), state = JSON.parse(await readFile(path, 'utf8'));
  state.history = Array.from({ length: count }, (_, i) => ({ ...state.history[0], id: `Acme-old-${i}`, retainedDetail: { sequence: i, values: [null, true, 'Acme detail'] }, padding: '' }));
  if (nearLimit) state.history[0].padding = 'x'.repeat(1024 * 1024 - 64 - Buffer.byteLength(JSON.stringify(state, null, 2) + '\n'));
  const bytes = JSON.stringify(state, null, 2) + '\n'; await writeFile(path, bytes);
  return { path, state, bytes };
}

async function archivedHistory(f) {
  const directory = join(f.stateDir, 'receipts'), names = await readdir(directory), receipts = [];
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  for (const name of names) {
    assert.match(name, /^[a-f0-9]{64}\.json$/);
    const path = join(directory, name), bytes = await readFile(path);
    assert.equal(name, createHash('sha256').update(bytes).digest('hex') + '.json');
    assert.equal((await stat(path)).mode & 0o777, 0o400);
    receipts.push(JSON.parse(bytes));
  }
  return receipts;
}

test('near-capacity history admits and releases work while preserving complete older receipts across restart', async t => {
  const f = await fixture(t), original = await fullHistory(f);
  assert.equal(Buffer.byteLength(original.bytes), 1024 * 1024 - 64);
  const result = run(process.execPath, f.args('run'));
  assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).released, true);
  const status = run(process.execPath, [CLI, 'status', '--state-dir', f.stateDir, '--json']);
  assert.equal(status.status, 0, status.stderr); const after = JSON.parse(status.stdout);
  assert.equal(after.used, 0); assert.ok(Buffer.byteLength(await readFile(original.path)) <= 1024 * 1024);
  const archived = await archivedHistory(f); assert.ok(archived.length > 0);
  const retained = [...archived, ...after.history].filter(row => row.id.startsWith('Acme-old-')).sort((a, b) => a.retainedDetail.sequence - b.retainedDetail.sequence);
  assert.deepEqual(retained, original.state.history);
  const archiveBytes = await Promise.all((await readdir(join(f.stateDir, 'receipts'))).map(name => readFile(join(f.stateDir, 'receipts', name))));
  assert.equal(run(process.execPath, f.args('run')).status, 0);
  assert.deepEqual(await Promise.all((await readdir(join(f.stateDir, 'receipts'))).map(name => readFile(join(f.stateDir, 'receipts', name)))), archiveBytes);
});

test('history filled while a command runs cannot block its confirmed completion release', async t => {
  const f = await fixture(t), ready = join(f.dir, 'history-ready'), release = join(f.dir, 'history-release');
  assert.equal(run(process.execPath, f.args('run')).status, 0);
  const argv = [process.execPath, '-e', `const fs=require('fs');fs.writeFileSync(${JSON.stringify(ready)},String(process.pid)+'\\n');const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)}))clearInterval(timer)},10)`];
  const pending = runAsync(process.execPath, f.args('run', 0, ['--timeout-ms', '30000'], argv));
  let original;
  try {
    const childPid = await waitForMarker(ready, decodePid);
    await until(async () => { const state = await inspectBudget({ stateDir: f.stateDir }); return !state.coordinationBusy && state.leases.some(row => row.state === 'running' && row.childPid === childPid); });
    const path = join(f.stateDir, 'state.json'), state = JSON.parse(await readFile(path, 'utf8'));
    state.history[0].padding = '';
    state.history[0].padding = 'x'.repeat(1024 * 1024 - 1 - Buffer.byteLength(JSON.stringify(state, null, 2) + '\n'));
    original = state.history[0]; await writeFile(path, JSON.stringify(state, null, 2) + '\n');
  } finally { await writeFile(release, 'go'); await pending; }
  const result = await pending; assert.equal(result.status, 0, result.stderr); assert.equal(JSON.parse(result.stdout).released, true);
  assert.equal((await inspectBudget({ stateDir: f.stateDir })).used, 0);
  assert.deepEqual(await archivedHistory(f), [original]);
});

test('recent history count is bounded and an identical immutable archive is reused without replacement', async t => {
  const f = await fixture(t), original = await fullHistory(f, { count: 205, nearLimit: false });
  const directory = join(f.stateDir, 'receipts'); await mkdir(directory, { mode: 0o700 });
  const bytes = Buffer.from(JSON.stringify(original.state.history[0]) + '\n'), path = join(directory, createHash('sha256').update(bytes).digest('hex') + '.json');
  await writeFile(path, bytes, { mode: 0o400 }); const before = await stat(path);
  const result = run(process.execPath, f.args('run')); assert.equal(result.status, 0, result.stderr);
  const state = await inspectBudget({ stateDir: f.stateDir }); assert.equal(state.used, 0); assert.equal(state.history.length, 200);
  const after = await stat(path); assert.equal(after.ino, before.ino); assert.equal(after.mtimeMs, before.mtimeMs);
  const retained = [...await archivedHistory(f), ...state.history].filter(row => row.id.startsWith('Acme-old-')).sort((a, b) => a.retainedDetail.sequence - b.retainedDetail.sequence);
  assert.deepEqual(retained, original.state.history);
});

test('a reused archive must sync successfully before active history can be replaced', async t => {
  const f = await fixture(t), original = await fullHistory(f), target = await inspectBudgetTarget(f.options(0));
  const directory = join(f.stateDir, 'receipts'); await mkdir(directory, { mode: 0o700 });
  const bytes = Buffer.from(JSON.stringify(original.state.history[0]) + '\n');
  const path = join(directory, createHash('sha256').update(bytes).digest('hex') + '.json');
  await writeFile(path, bytes, { mode: 0o400 });
  const marker = join(f.dir, 'must-not-run'), originalOpen = fileOperations.open; let syncCalls = 0;
  const observer = t.mock.method(fileOperations, 'open', async (...args) => {
    const file = await Reflect.apply(originalOpen, fileOperations, args);
    if (args[0] === path) t.mock.method(file, 'sync', async () => { syncCalls++; throw Object.assign(new Error('Acme sync failure'), { code: 'EIO' }); });
    return file;
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(runBudget({ stateDir: f.stateDir, capacity: 1, target, argv: [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`], foreground: true, json: true }), { code: 'EIO' });
    assert.equal(syncCalls, 1); assert.equal(await exists(marker), false);
    assert.equal(await readFile(original.path, 'utf8'), original.bytes); assert.deepEqual(await readFile(path), bytes);
  } finally { observer.mock.restore(); syncBuiltinESMExports(); }
});

test('unsafe or conflicting archives refuse admission without losing or rewriting active history', async t => {
  for (const kind of ['directory-symlink', 'conflicting-file', 'writable-file', 'file-symlink']) {
    const f = await fixture(t), original = await fullHistory(f), directory = join(f.stateDir, 'receipts');
    const bytes = Buffer.from(JSON.stringify(original.state.history[0]) + '\n'), filename = createHash('sha256').update(bytes).digest('hex') + '.json';
    const outside = join(f.dir, 'outside'); await mkdir(outside, { mode: 0o700 });
    if (kind === 'directory-symlink') await symlink(outside, directory);
    else {
      await mkdir(directory, { mode: 0o700 });
      if (kind === 'file-symlink') { await writeFile(join(outside, filename), bytes, { mode: 0o400 }); await symlink(join(outside, filename), join(directory, filename)); }
      else await writeFile(join(directory, filename), kind === 'conflicting-file' ? '{}\n' : bytes, { mode: kind === 'writable-file' ? 0o600 : 0o400 });
    }
    const marker = join(f.dir, 'forbidden-workload');
    const result = run(process.execPath, f.args('run', 0, [], [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`])); assert.equal(result.status, 2, `${kind}: ${result.stderr}`);
    assert.equal(await exists(marker), false);
    assert.equal(await readFile(original.path, 'utf8'), original.bytes);
    assert.equal((await inspectBudget({ stateDir: f.stateDir })).used, 0);
    if (kind === 'conflicting-file') assert.equal(await readFile(join(directory, filename), 'utf8'), '{}\n');
  }
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
  assert.equal(result.status, 124, result.stderr); const report = JSON.parse(result.stdout); assert.equal(report.timedOut, true); assert.equal(report.released, true); if (await exists(marker)) assert.ok('once'.startsWith(await readFile(marker, 'utf8')));
  assert.equal((await inspectBudget({ stateDir: f.stateDir })).used, 0);
});

test('a surviving foreground descendant retains capacity after its direct parent exits', async t => {
  const f = await fixture(t), release = join(f.dir, 'descendant-release'), stopped = join(f.dir, 'descendant-stopped'), leader = join(f.dir, 'descendant-group');
  // The surviving supervisor reaps the polling worker before acknowledging.
  // Fixture deletion cannot race a worker that still needs its release file.
  const argv = ['/bin/sh', '-c', 'printf "%s\\n" "$$" > "$3"; ((while [ ! -f "$1" ]; do sleep 0.01; done) & worker=$!; wait "$worker"; printf stopped > "$2") >/dev/null 2>&1 &', 'acme', release, stopped, leader];
  let group;
  try {
    const result = run(process.execPath, f.args('run', 0, [], argv));
    group = await waitForMarker(leader, decodePid);
    assert.equal(result.status, 75, result.stderr);
    const report = JSON.parse(result.stdout); assert.equal(report.released, false); assert.equal(report.childStatus, 0);
    const state = await inspectBudget({ stateDir: f.stateDir }); assert.equal(state.used, 1); assert.equal(state.leases[0].state, 'uncertain');
    assert.equal(state.leases[0].id, report.id); assert.equal(state.leases[0].childPid, group); assert.equal(state.leases[0].root, f.roots[0]);
  } finally {
    await writeFile(release, 'stop');
    try { await waitForText(stopped, 'stopped'); }
    finally {
      // Also terminate any remaining supervisor, or the worker if its bounded
      // acknowledgement failed. Never signal zero/unknown groups or wait for
      // Linux PID1 to reap an exited orphan before removing this fixture.
      if (validPid(group)) {
        try { process.kill(-group, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
    }
  }
  const next = run(process.execPath, f.args('run', 1)); assert.equal(next.status, 2); assert.match(next.stderr, /capacity_busy/);
});

test('a confirmed-start command receives forwarded termination and releases its proven exited group', async t => {
  const f = await fixture(t), ready = join(f.dir, 'ready'), release = join(f.dir, 'stop');
  const argv = [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(ready)},JSON.stringify({wrapper:process.ppid,child:process.pid}));const timer=setInterval(()=>{if(require('fs').existsSync(${JSON.stringify(release)}))clearInterval(timer)},10)`];
  const pending = runAsync(process.execPath, f.args('run', 0, ['--timeout-ms', '30000'], argv));
  let owned;
  try {
    owned = await waitForMarker(ready, decodeOwner);
    assert.ok(Number.isInteger(owned.child) && owned.child > 1); assert.ok(Number.isInteger(owned.wrapper) && owned.wrapper > 1);
    await until(async () => (await inspectBudget({ stateDir: f.stateDir })).leases.some(row => row.pid === owned.wrapper && row.childPid === owned.child));
    process.kill(owned.wrapper, 'SIGTERM');
    const result = await pending; assert.equal(result.status, 143, result.stderr);
    assert.equal(JSON.parse(result.stdout).released, true);
    assert.equal((await inspectBudget({ stateDir: f.stateDir })).used, 0);
  } finally {
    await writeFile(release, 'stop');
    if (Number.isInteger(owned?.child) && owned.child > 1) { try { process.kill(-owned.child, 'SIGKILL'); } catch {} }
    await pending;
  }
});

test('a killed wrapper leaves its lease reserved even after its owned child is stopped', async t => {
  const f = await fixture(t), ready = join(f.dir, 'ready'), release = join(f.dir, 'stop');
  const argv = [process.execPath, '-e', `require('fs').writeFileSync(${JSON.stringify(ready)},JSON.stringify({wrapper:process.ppid,child:process.pid}));const timer=setInterval(()=>{if(require('fs').existsSync(${JSON.stringify(release)}))clearInterval(timer)},10)`];
  const pending = runAsync(process.execPath, f.args('run', 0, ['--timeout-ms', '30000'], argv));
  let owned;
  try {
    owned = await waitForMarker(ready, decodeOwner);
    assert.ok(Number.isInteger(owned.child) && owned.child > 1); assert.ok(Number.isInteger(owned.wrapper) && owned.wrapper > 1);
    await until(async () => (await inspectBudget({ stateDir: f.stateDir })).leases.some(row => row.pid === owned.wrapper && row.childPid === owned.child));
    process.kill(owned.wrapper, 'SIGKILL');
    if (Number.isInteger(owned.child) && owned.child > 1) { try { process.kill(-owned.child, 'SIGKILL'); } catch {} }
    await pending;
    const after = await inspectBudget({ stateDir: f.stateDir }); assert.equal(after.used, 1); assert.equal(after.leases[0].pid, owned.wrapper);
    const next = run(process.execPath, f.args('run', 1)); assert.equal(next.status, 2); assert.match(next.stderr, /capacity_busy/);
  } finally {
    await writeFile(release, 'stop');
    if (Number.isInteger(owned?.child) && owned.child > 1) { try { process.kill(-owned.child, 'SIGKILL'); } catch {} }
    await pending;
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
