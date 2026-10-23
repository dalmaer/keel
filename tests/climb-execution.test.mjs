import { test } from 'node:test';
import fileOperations from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { agentRan } from '../scripts/plates/climb.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, readFile, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { denialEvidence, preflight, durations, completion } from '../scripts/plates/climb-execution.mjs';
import { acme, step, execution, git } from './helpers/climb.mjs';

test('denial evidence has bounded categories without command, path or message leakage', () => {
  const secret = 'private-token-and-path';
  const r = denialEvidence({ permission_denials: Array.from({ length: 100 }, () => ({ tool_name: 'Bash', tool_input: { command: secret }, message: secret })) });
  assert.equal(r.count, 100);
  assert.equal(r.entries.length, 8);
  assert.equal(r.omitted, 92);
  assert.ok(!JSON.stringify(r).includes(secret));
  assert.deepEqual(denialEvidence({ permission_denials: [{ tool_name: secret }] }).entries, [{ tool: 'unknown', reason: 'permission-denied' }]);
});

test('preflight checks scratch capabilities, cleans up, and stops before later commands on failure', async t => {
  const root = await mkdtemp(join(tmpdir(), 'acme-preflight-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const seen = [];
  const good = await preflight(root, { execute: (command, args, opts) => { seen.push([command, args, opts]); return { status: 0 }; } });
  assert.equal(good.ok, true);
  assert.equal(good.agentPermissions, 'unverified');
  assert.equal(seen.length, 5);
  assert.ok(seen.every(x => x[2].timeout === 10000 && x[2].shell === false));
  const bad = await preflight(root, { execute: () => ({ status: 1, stderr: 'secret' }) });
  assert.equal(bad.state, 'blocked');
  assert.equal(bad.checks.length, 2);
  assert.ok(!JSON.stringify(bad).includes('secret'));
  assert.deepEqual(await readdir(root), []);
});

test('duration includes baseline and queue wall time without summing phases or inventing CPU', () => {
  const r = durations({ started: 100, baselineStarted: 110, baselineEnded: 1576, agentSeconds: 92, judgeStarted: 1680, now: 1715 });
  assert.deepEqual([r.setup, r.baseline, r.agent, r.judge, r.total, r.cpu], [10, 1466, 92, 35, 1615, null]);
  assert.equal(durations({}).baseline, null);
  assert.equal(durations({ started: 200, now: 100 }).total, null);
  assert.deepEqual([completion({ kept: 0 }, { tried: [] }), completion({ kept: 0 }, { tried: [{ verdict: 'revert', rounds: [] }] }), completion({ kept: 1 })], ['no-candidate', 'incomplete', 'candidate']);
});

test('actual execution workflow fails with unchanged HEAD and retains sanitized denial receipt', async t => {
  const dir = await acme(t);
  const temp = await mkdtemp(join(tmpdir(), 'acme-receipt-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  await cp(join(dir, 'scripts/plates'), join(temp, 'plates/scripts/plates'), { recursive: true });
  const file = join(temp, 'execution.json');
  await writeFile(file, execution({ is_error: false, num_turns: 30, duration_ms: 79452, permission_denials: [{ tool_name: 'Bash', tool_input: { command: 'private-path-and-token' } }] }));
  const head = git(dir, ['rev-parse', 'HEAD']);
  const r = await step(t, dir, 'Did the agent run?', { OUTCOME: 'success', EXECUTION: file, MINUTES: '45', STARTED: String(Date.now() / 1000 - 92), RUNNER_TEMP: temp });
  assert.equal(r.status, 1, r.out);
  assert.equal(r.outputs.state, 'blocked');
  assert.equal(git(dir, ['rev-parse', 'HEAD']), head);
  const receipt = await readFile(join(temp, 'climb-execution.json'), 'utf8');
  assert.ok(!receipt.includes('private-path-and-token'));
  assert.equal(JSON.parse(receipt).denials.count, 1);
});

test('report requires completed comparison or failing proof evidence for no-improvement', async t => {
  const { climb, json } = await import('./helpers/climb.mjs');
  const dir = await acme(t);
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(dir, '.plates/climb'), { recursive: true });
  const night = { job: 'test-time', date: '2026-10-23', started: new Date().toISOString(), base: git(dir, ['rev-parse', 'HEAD']), command: 'npm test', baseline: { median: 100, spread: 0, times: [100] }, margin: 0.1 };
  const cases = [
    [[], 'no-candidate'],
    [[{ verdict: 'revert', what: 'could not run tests', why: 'runner unavailable', rounds: [] }], 'incomplete'],
    [[{ verdict: 'revert', what: 'no gain', rounds: [{ base: 100, candidate: 99, change: -0.01 }, { base: 100, candidate: 99, change: -0.01 }] }], 'no-improvement'],
    [[{ verdict: 'revert', what: 'still flaky', rounds: [], runs: 10, passed: 0, failed: 1, tree: 'a'.repeat(40) }], 'no-improvement'],
  ];
  for (const [tried, expected] of cases) {
    await writeFile(join(dir, '.plates/climb/night.json'), JSON.stringify({ ...night, tried }));
    const r = climb(dir, ['report', '--json']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(json(r).state, expected);
  }
});

test('failed judge guard still leaves a separate wall-cost receipt', async t => {
  const { mkdir } = await import('node:fs/promises');
  const dir = await acme(t);
  const temp = await mkdtemp(join(tmpdir(), 'acme-judge-cost-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const clock = await step(t, dir, 'Start the judge clock', { RUNNER_TEMP: temp });
  assert.equal(clock.status, 0, clock.out);
  const bin = join(temp, 'bin');
  await mkdir(bin);
  await writeFile(join(bin, 'node'), '#!/bin/sh\nexit 9\n', { mode: 0o755 });
  const failure = await step(t, dir, 'Judge the night', { RUNNER_TEMP: temp, PATH: `${bin}:${process.env.PATH}`, GITHUB_SHA: git(dir, ['rev-parse', 'HEAD']) });
  assert.equal(failure.status, 9, failure.out);
  const cost = await step(t, dir, 'Record judge costs', { RUNNER_TEMP: temp, START: clock.outputs.started, JUDGE_START: clock.outputs.started, BASELINE_START: '', BASELINE_END: '', AGENT_SECONDS: '' });
  assert.equal(cost.status, 0, cost.out);
  const r = JSON.parse(await readFile(join(temp, 'climb-durations.json'), 'utf8'));
  assert.ok(r.judge >= 0);
  assert.ok(r.total >= r.judge);
  assert.equal(r.cpu, null);
  assert.equal(r.baseline, null);
  const workflow = await readFile(new URL('../practices/climb/files/.github/workflows/plates-climb.yml', import.meta.url), 'utf8');
  assert.match(workflow, /- name: Record judge costs\n        if: always\(\)/);
  assert.match(workflow, /for f in body.md issue.md issue-title.txt report.json climb-durations.json/);
});

test('execution evidence reads through short reads, retaining later permission denials', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'acme-short-read-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'execution.jsonl');
  const prefix = JSON.stringify({ type: 'result', is_error: false }) + '\n';
  await writeFile(file, prefix + JSON.stringify({ type: 'result', is_error: false, permission_denials: [{ tool_name: 'Bash' }] }));
  const originalOpen = fileOperations.open;
  let reads = 0, closed = false;
  t.mock.method(fileOperations, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    const read = handle.read.bind(handle), close = handle.close.bind(handle);
    handle.read = (buffer, offset, length, position) => read(buffer, offset, ++reads === 1 ? Buffer.byteLength(prefix) : length, position);
    handle.close = async () => { closed = true; await close(); };
    return handle;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  const r = await agentRan({ outcome: 'success', file, minutes: 45 });
  assert.equal(r.ok, false);
  assert.equal(r.denials.count, 1);
  assert.equal(r.evidence, 'complete');
  assert.ok(reads >= 3, 'short read is followed by the tail and EOF');
  assert.equal(closed, true);
});

test('execution evidence accepts the exact bound and blocks overflow for both providers', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'acme-evidence-bound-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'execution.json');
  const result = JSON.stringify({ type: 'result', is_error: false });
  await writeFile(file, result.padEnd(8 * 1024 * 1024, ' '));
  assert.equal((await agentRan({ outcome: 'success', file, minutes: 45 })).ok, true);
  await writeFile(file, result.padEnd(8 * 1024 * 1024 + 1, ' '));
  for (const agent of ['claude', 'codex']) {
    const r = await agentRan({ outcome: 'success', file, minutes: 45, agent });
    assert.equal(r.ok, false);
    assert.equal(r.state, 'blocked');
    assert.equal(r.evidence, 'oversized');
    assert.match(r.line, /exceeds the 8 MiB limit/);
    assert.doesNotMatch(r.line, /did not start|secret|before its/);
  }
});

test('missing, empty and invalid execution evidence stay neutral and blocked at timeout', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'acme-evidence-unavailable-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const [name, content, evidence] of [['missing', null, 'missing'], ['empty', '  ', 'empty'], ['invalid', '{private text', 'no-valid-result']]) {
    const file = join(dir, name);
    if (content !== null) await writeFile(file, content);
    const r = await agentRan({ outcome: 'failure', file, minutes: 45, started: 0, now: 2700000 });
    assert.equal(r.ok, false);
    assert.equal(r.state, 'blocked');
    assert.equal(r.evidence, evidence);
    assert.match(r.line, /Execution cannot be verified, including at timeout/);
    assert.doesNotMatch(r.line, /did not start|before its|secret|private text/);
  }
  for (const name of ['missing', 'empty']) {
    const r = await agentRan({ outcome: 'failure', file: join(dir, name), minutes: 45, started: 0, now: 2700000, agent: 'codex' });
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, false);
    assert.equal(r.evidence, name);
    assert.doesNotMatch(r.line, /did not start|before its|secret/);
  }
});

test('execution evidence read failures after partial progress are sanitized and close the handle', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'acme-evidence-error-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'private-path');
  await writeFile(file, JSON.stringify({ type: 'result', is_error: false }));
  const originalOpen = fileOperations.open;
  let reads = 0, closed = false;
  t.mock.method(fileOperations, 'open', async (...args) => {
    const handle = await originalOpen(...args);
    const read = handle.read.bind(handle), close = handle.close.bind(handle);
    handle.read = (...args) => { if (++reads > 1) throw new Error('private-token-and-path'); return read(...args); };
    handle.close = async () => { closed = true; await close(); };
    return handle;
  });
  syncBuiltinESMExports();
  t.after(() => { t.mock.restoreAll(); syncBuiltinESMExports(); });
  await assert.rejects(agentRan({ outcome: 'success', file, minutes: 45 }), { message: 'climb: execution evidence could not be read' });
  assert.equal(closed, true);
});
