import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, cleanEnv } from './helpers/run.mjs';
import { runProfile } from '../scripts/profile.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'acme-profile-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir };
}
function partition(p) {
  const m = p.timingMs;
  assert.ok(Math.abs(m.subprocessBusy + m.directNetworkBusy - m.subprocessNetworkOverlap - m.observedBusy) < 0.001);
  assert.ok(Math.abs(m.parentSpawnToPreload + m.observedBusy + m.localResidual - m.childUntilExit) < 0.001);
}

test('real CLI preserves stdout, stderr and success/failure status; private dedicated profile', t => {
  const { dir } = fixture(t);
  for (const args of [['--agent-help'], ['Acme-invalid-command', '--json']]) {
    const plain = run(process.execPath, ['bin/keel.mjs', ...args], { cwd: root });
    const output = join(dir, `${args.length}-${args[0]}.json`);
    const measured = run(process.execPath, ['scripts/profile.mjs', '--output', output, '--', ...args], { cwd: root });
    assert.equal(measured.status, plain.status);
    assert.equal(measured.stdout, plain.stdout);
    assert.equal(measured.stderr, plain.stderr);
    const record = JSON.parse(readFileSync(output));
    assert.equal(record.code, plain.status);
    assert.ok(record.profile.timingMs.parentSpawnToPreload > 0);
    assert.ok(record.profile.timingMs.cliImports > 0);
    assert.ok(record.elapsedMs >= record.profile.timingMs.childUntilExit);
    assert.equal(statSync(output).mode & 0o777, 0o600);
    partition(record.profile);
  }
});

test('overlapping subprocesses and direct fetch have union accounting and no secrets', async () => {
  const entry = join(root, 'tests/fixtures/profile/overlap.mjs');
  const r = await runProfile([], { entry, stdio: 'ignore', env: cleanEnv(process.env) });
  assert.equal(r.code, 0);
  assert.equal(r.profile.counts.subprocess, 4);
  assert.equal(r.profile.counts.directNetwork, 1);
  assert.equal(r.profile.counts.failures, 1);
  assert.ok(r.profile.timingMs.subprocessNetworkOverlap > 0);
  assert.equal(r.profile.incomplete.subprocess, 0);
  assert.equal(r.profile.incomplete.directNetwork, 0);
  assert.doesNotMatch(JSON.stringify(r), /Acme|127\.0|authorization|secret/);
  partition(r.profile);
});

test('sync, async and failed spawns, promisify and opaque gh classification', async () => {
  const entry = join(root, 'tests/fixtures/profile/subprocess-failures.mjs');
  const r = await runProfile([], { entry, stdio: 'ignore', env: { ...cleanEnv(process.env), KEEL_GH: process.execPath } });
  assert.equal(r.code, 0);
  assert.equal(r.profile.counts.subprocess, 4);
  assert.equal(r.profile.counts.failures, 4);
  assert.equal(r.profile.counts.ghOpaque, 1);
  assert.ok(r.profile.timingMs.ghNetworkCapableOpaque > 0);
  partition(r.profile);
});

test('HTTP response, refused fetch and request failures are observed without swallowing errors', async () => {
  const entry = join(root, 'tests/fixtures/profile/http.mjs');
  const r = await runProfile([], { entry, stdio: 'ignore', env: cleanEnv(process.env) });
  assert.equal(r.code, 0);
  assert.equal(r.profile.counts.directNetwork, 4);
  assert.equal(r.profile.counts.failures, 3);
  partition(r.profile);
});

test('uncaught child errors still fail and abrupt exit retains bounded aggregate', async () => {
  const entry = join(root, 'tests/fixtures/profile/uncaught.mjs');
  const r = await runProfile([], { entry, stdio: 'ignore', env: cleanEnv(process.env) });
  assert.equal(r.code, 1);
  assert.equal(r.profile.counts.failures, 101);
  assert.ok(JSON.stringify(r).length < 4096);
});

test('signals report missing profile honestly and preload is inert without opt-in', async () => {
  const entry = join(root, 'tests/fixtures/profile/signal.mjs');
  const r = await runProfile([], { entry, stdio: 'ignore', env: cleanEnv(process.env) });
  assert.equal(r.signal, 'SIGKILL');
  assert.equal(r.profileUnavailable, true);
  const inert = run(process.execPath, [join(root, 'tests/fixtures/profile/inert.mjs')]);
  assert.equal(inert.status, 0);
  assert.equal(inert.stdout, '');
  assert.equal(inert.stderr, '');
});

test('benchmark retains samples, stats and environment on synthetic read-only project', t => {
  const { dir } = fixture(t);
  const output = join(dir, 'bench.json');
  const r = run(process.execPath, [join(root, 'scripts/profile-benchmark.mjs'), '--output', output, '--samples', '2', '--json'], { cwd: dir });
  // Missing project failures remain in the samples and runner status.
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  const report = JSON.parse(readFileSync(output));
  assert.equal(report.samples, 2);
  assert.equal(report.environment.node, process.version);
  for (const snapshot of [report.environment.start, report.environment.end]) {
    assert.equal(new Date(snapshot.timestamp).toISOString(), snapshot.timestamp);
    assert.equal(snapshot.loadavg.length, 3);
    assert.ok(snapshot.loadavg.every(n => Number.isFinite(n) && n >= 0));
  }
  assert.ok(Date.parse(report.environment.start.timestamp) <= Date.parse(report.environment.end.timestamp));
  assert.deepEqual(Object.keys(report.results), ['help', 'status', 'next']);
  for (const value of Object.values(report.results)) {
    assert.equal(value.raw.length, 2);
    assert.ok(value.stats.elapsedMs.min <= value.stats.elapsedMs.median);
    assert.ok(value.stats.elapsedMs.median <= value.stats.elapsedMs.max);
  }
  assert.doesNotMatch(JSON.stringify(report), /Acme|secret/);
});

test('both runners support help without a destination or execution', () => {
  for (const script of ['profile.mjs', 'profile-benchmark.mjs']) {
    const r = run(process.execPath, [join(root, 'scripts', script), '--help']);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^Usage: node scripts\/profile/);
    assert.equal(r.stderr, '');
  }
});

test('exec callback promise and sync count each child and failure once', async () => {
  const entry = join(root, 'tests/fixtures/profile/exec.mjs');
  for (const mode of ['callback', 'promise', 'sync']) {
    for (const outcome of ['success', 'failure']) {
      const r = await runProfile([mode, outcome], { entry, stdio: 'ignore', env: cleanEnv(process.env) });
      assert.equal(r.code, 0, `${mode} ${outcome}: builtin return and output contract`);
      assert.equal(r.profile.counts.subprocess, 1, `${mode} ${outcome}: one child`);
      assert.equal(r.profile.counts.failures, outcome === 'failure' ? 1 : 0, `${mode} ${outcome}: failure counted once`);
      assert.equal(r.profile.incomplete.subprocess, 0);
      assert.doesNotMatch(JSON.stringify(r), /Acme|secret|printf/);
      partition(r.profile);
    }
  }
});
