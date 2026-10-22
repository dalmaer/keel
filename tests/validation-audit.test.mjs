// Synthetic retained evidence exercises audit claims, not the gate implementation.
import './helpers/hermetic.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run } from './helpers/run.mjs';
import { auditValidation, cohortDigest, inputsDigest, AUDIT_LIMITS } from '../lib/validation-audit.mjs';

const repo = 'acme/anvil', head = 'a'.repeat(40), tree = 'b'.repeat(40), digest = 'c'.repeat(64);
const manifest = [{ repo, role: 'managed' }, { repo: 'acme/source', role: 'source' }];
const observedAt = '2026-10-22T20:00:00Z';
const inputs = Object.fromEntries(['command', 'config', 'runtime', 'environment', 'selection', 'workflow', 'lock', 'cache'].map(k => [k, digest]));
const input = records => ({ schema: 1, observedAt, records });
const report = records => auditValidation(manifest, input(records));
const rules = records => report(records).findings.map(f => f.rule);
function gate(change = {}) {
  const r = { id: 'gate-1', repo, kind: 'gate', gateSource: 'configured-check', head, tree, dirty: false, completed: true, status: 0, invocationId: 'run-1', purpose: 'candidate', startedAt: '2026-10-22T19:00:00Z', endedAt: '2026-10-22T19:00:01Z', wallMs: 1000, cpuMs: 800, queueMs: 40, inputs: { ...inputs }, manifestDigest: digest, requiredStages: ['ordinary', 'generated'], ...change };
  r.stages ??= r.requiredStages.map(id => ({ id, head: r.head, tree: r.tree, dirty: false, completed: true, status: 0, inputsDigest: inputsDigest(r.inputs), manifestDigest: r.manifestDigest }));
  r.baseline ??= { sampleCount: 5, medianWallMs: 1000, thresholdRatio: 1.2, cohortDigest: cohortDigest(r) };
  return r;
}
function review(change = {}) {
  return { id: 'review-1', repo, kind: 'review', head, review: { base: tree, reviewedBase: tree, reviewedHead: head, inputComplete: true, workflow: '.github/workflows/acme-review.yml', expectedWorkflow: '.github/workflows/acme-review.yml', workflowHead: head, expectedWorkflowHead: head, event: 'ready_for_review', allowedEvents: ['ready_for_review'] }, ...change };
}
function reuse(change = {}) {
  return { id: 'reuse-1', repo, kind: 'reuse', head, tree, dirty: false, inputs: { ...inputs }, manifestDigest: digest, requiredStages: ['ordinary', 'generated'], wallMs: 0, cpuMs: 0, reuse: { gateId: 'gate-1', policy: '24-hours', artifactIntegrity: 'verified', artifactExpired: false }, ...change };
}

test('complete recorded evidence has no findings and remains advisory', () => {
  const r = report([gate(), review(), reuse()]);
  assert.equal(r.findings.length, 0);
  assert.equal(r.authority, 'advisory-only');
  assert.equal(r.coverage.length, 1, 'source-only entries are excluded');
  assert.equal(Object.hasOwn(r, 'canReuse'), false);
  assert.match(r.limits.join(' '), /not independently verified gate authority/);
});

test('redundant complete gates require proven identical inputs and distinct invocations', () => {
  const a = gate(), b = gate({ id: 'gate-2', invocationId: 'run-2' });
  const repeated = report([a, b, a, review()]);
  const findings = repeated.findings.filter(f => f.rule === 'redundant-gates');
  assert.equal(findings.length, 1); assert.equal(findings[0].count, 2);
  assert.equal(repeated.duplicateRecords, 1);
  assert.deepEqual(repeated.findings, report([review(), b, a, a]).findings);
  for (const changed of [
    { invocationId: a.invocationId }, { purpose: 'platform' }, { retryOf: a.id }, { parentId: a.id },
    { head: 'd'.repeat(40) }, { tree: 'd'.repeat(40) }, { dirty: true }, { completed: false }, { status: 1 },
    { inputs: { ...inputs, environment: 'e'.repeat(64) } }, { inputs: { ...inputs, selection: null } }, { manifestDigest: null },
  ]) assert.equal(rules([a, gate({ ...b, ...changed }), review()]).includes('redundant-gates'), false, JSON.stringify(changed));
  const reversed = gate({ ...b, requiredStages: [...b.requiredStages].reverse(), stages: [...b.stages].reverse() });
  assert.equal(rules([a, reversed, review()]).includes('redundant-gates'), true, 'stage union order is not an input difference');
});

test('conflicting records are unusable, deterministic and cannot satisfy reuse', () => {
  const a = gate(), b = gate({ status: 1 });
  const r = report([a, b, reuse()]);
  assert.ok(r.findings.some(f => f.rule === 'conflicting-evidence'));
  assert.ok(r.findings.some(f => f.rule === 'unsupported-reuse'));
  assert.deepEqual(r, report([b, a, reuse()]));
  const extra = { ...a, privateBody: 'Acme private text' };
  assert.equal(report([a, extra]).findings.some(f => f.rule === 'conflicting-evidence'), false, 'unknown private fields have no authority');
});

test('incomplete attestations reject failed missing duplicate and wrong-input children', () => {
  const a = gate();
  const variants = [
    { gateSource: null }, { gateSource: 'explicit-command' }, { dirty: null }, { invocationId: null }, { requiredStages: [] }, { stages: [] },
    { stages: a.stages.slice(1) }, { stages: [...a.stages, a.stages[0]] },
    ...['status', 'dirty', 'head', 'tree', 'inputsDigest', 'manifestDigest'].map(key => ({ stages: a.stages.map((s, i) => i ? s : { ...s, [key]: ({ status: 1, dirty: true, head: 'd'.repeat(40), tree: 'd'.repeat(40), inputsDigest: 'd'.repeat(64), manifestDigest: 'd'.repeat(64) })[key] }) })),
    { stages: [...a.stages, { ...a.stages[0], id: 'unmapped' }] },
  ];
  for (const change of variants) assert.ok(rules([gate({ ...a, ...change })]).includes('incomplete-attestation'), JSON.stringify(change));
});

test('regression compares only enough successful clean observations in the same explicit cohort', () => {
  const a = gate({ wallMs: 1300 });
  const f = report([a]).findings.find(f => f.rule === 'timing-regression');
  assert.equal(f.measurement.baselineMedianWallMs, 1000);
  assert.equal(f.measurement.sampleCount, 5);
  for (const change of [
    { baseline: null }, { baseline: { ...a.baseline, sampleCount: 1 } },
    { baseline: { ...a.baseline, cohortDigest: 'd'.repeat(64) } },
    { baseline: { ...a.baseline, thresholdRatio: null } }, { wallMs: null },
    { dirty: true }, { completed: false }, { status: 1 },
    { inputs: { ...a.inputs, cache: null } },
  ]) {
    const rows = rules([{ ...a, ...change }]);
    assert.ok(rows.includes('baseline-insufficient'));
    assert.equal(rows.includes('timing-regression'), false);
  }
  assert.equal(rules([gate({ wallMs: 1200 })]).includes('timing-regression'), false, 'threshold equality is not a regression');
});

test('timing retains unknown CPU and nested overlapping spans without inventing totals', () => {
  const rows = [gate({ cpuMs: null }), { id: 'child', repo, kind: 'stage', parentId: 'run-1', wallMs: 900, cpuMs: null, startedAt: '2026-10-22T19:00:00Z', endedAt: '2026-10-22T19:00:01Z' }];
  const r = report(rows);
  assert.equal(r.measurements.length, 2);
  assert.ok(r.measurements.every(m => m.cpuMs === null));
  assert.equal(Object.hasOwn(r, 'totalWallMs'), false);
  assert.equal(Object.hasOwn(r, 'savingsMs'), false);
  assert.match(r.limits.join(' '), /overlapping durations are not added/);
  assert.ok(r.findings.some(f => f.rule === 'telemetry-incomplete'));
});

test('stalled setup preserves failure and missing deadline is an explicit gap', () => {
  const setup = { id: 'install', repo, kind: 'setup', startedAt: '2026-10-22T19:50:00Z', heartbeatAt: '2026-10-22T19:51:00Z', timeoutMs: 300000, completed: false };
  const f = report([setup]).findings.find(f => f.rule === 'setup-stalled');
  assert.equal(f.measurement.elapsedMs, 600000);
  assert.equal(f.measurement.heartbeatAgeMs, 540000);
  assert.equal(rules([{ ...setup, completed: true }]).includes('setup-stalled'), false);
  assert.ok(rules([{ ...setup, completed: true, timedOut: true, status: 124 }]).includes('setup-stalled'));
  assert.ok(rules([{ ...setup, timeoutMs: null }]).includes('setup-coverage-gap'));
  assert.equal(rules([{ ...setup, timeoutMs: 900000 }]).includes('setup-stalled'), false);
});

test('completed setup duration and heartbeat stop at the recorded end, never the audit cutoff', () => {
  const setup = { id: 'historical-install', repo, kind: 'setup', startedAt: '2026-10-22T19:00:00Z', endedAt: '2026-10-22T19:05:00Z', heartbeatAt: '2026-10-22T19:04:00Z', timedOut: true, completed: true, status: 124, timeoutMs: 300000 };
  const finding = records => report(records).findings.find(f => f.rule === 'setup-stalled');
  assert.deepEqual(finding([setup]).measurement, { elapsedMs: 300000, timeoutMs: 300000, heartbeatAgeMs: 60000 });
  const later = auditValidation(manifest, { ...input([setup]), observedAt: '2026-10-24T20:00:00Z' }).findings.find(f => f.rule === 'setup-stalled');
  assert.deepEqual(later.measurement, finding([setup]).measurement, 'later audits do not enlarge completed setup spans');
  assert.deepEqual(finding([{ ...setup, endedAt: null }]).measurement, { elapsedMs: null, timeoutMs: 300000, heartbeatAgeMs: null }, 'missing completed end is unknown, not elapsed through collection');
  assert.equal(finding([{ ...setup, timedOut: false, status: 0 }]), undefined, 'historical successful setup is not stalled at the later cutoff');
});

test('review requires complete exact-head input and pinned trusted workflow route', () => {
  const a = review();
  for (const change of [{ reviewedHead: tree }, { reviewedBase: head }, { inputComplete: false }, { base: null }]) assert.ok(rules([{ ...a, review: { ...a.review, ...change } }]).includes('review-input-gap'));
  for (const change of [{ workflow: '.github/workflows/old.yml' }, { event: 'issue_comment' }, { workflowHead: tree }, { expectedWorkflowHead: null }]) assert.ok(rules([{ ...a, review: { ...a.review, ...change } }]).includes('review-workflow-gap'));
});

test('reuse requires clean identical inputs full stages integrity and explicit freshness', () => {
  const a = gate(), u = reuse();
  for (const change of [{ dirty: true }, { tree: 'd'.repeat(40) }, { head: tree }, { inputs: { ...inputs, lock: 'e'.repeat(64) } }, { requiredStages: ['ordinary'] }]) assert.ok(rules([a, { ...u, ...change }]).includes('unsupported-reuse'));
  for (const change of [{ policy: null }, { artifactExpired: true }, { artifactIntegrity: 'unknown' }, { gateId: 'missing' }]) assert.ok(rules([a, { ...u, reuse: { ...u.reuse, ...change } }]).includes('unsupported-reuse'));
  const old = gate({ startedAt: '2026-10-20T19:00:00Z', endedAt: '2026-10-20T19:00:01Z' });
  assert.ok(rules([old, u]).includes('unsupported-reuse'));
  assert.equal(rules([old, { ...u, reuse: { ...u.reuse, policy: 'until-change' } }]).includes('unsupported-reuse'), false);
  assert.ok(rules([gate({ status: 1 }), { ...u, reuse: { ...u.reuse, policy: 'until-change' } }]).includes('unsupported-reuse'), 'freshness cannot rescue failed evidence');
});

test('missing fleet coverage and malformed records fail closed without echoing private data', () => {
  const r = auditValidation([...manifest, { repo: 'acme/forge', role: 'managed' }], input([gate()]));
  assert.ok(r.findings.some(f => f.repo === 'acme/forge' && f.rule === 'project-coverage-gap'));
  assert.ok(r.findings.some(f => f.rule === 'review-coverage-gap'));
  for (const value of [
    { ...input([]), schema: 2 }, { ...input([]), records: Array(AUDIT_LIMITS.records + 1).fill(gate()) },
    input([{ ...gate(), repo: 'acme/source' }]), input([{ ...gate(), repo: 'acme/unlisted' }]),
    input([{ ...gate(), id: '../outside' }]), input([{ ...gate(), wallMs: -1 }]),
    input([{ ...gate(), endedAt: '2026-10-23T00:00:00Z' }]),
    input([{ ...gate(), startedAt: '2026-10-22T19:01:00Z' }]),
    input([{ ...review(), review: { workflow: '../../private' } }]),
  ]) assert.throws(() => auditValidation(manifest, value));
  const secret = 'Acme-private-body-must-not-leak';
  assert.equal(JSON.stringify(report([{ ...gate(), source: '/private/outside', body: secret, inputs: { ...inputs, secret } }])).includes(secret), false);
  assert.equal(JSON.stringify(report([{ ...gate(), id: secret }])).includes(secret), false, 'record IDs are opaque hashes in output');
});

async function fixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'plates-audit-acme-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const mf = join(dir, 'manifest.json'), evidence = join(dir, 'input.json');
  await writeFile(mf, JSON.stringify(manifest)); await writeFile(evidence, JSON.stringify(input([gate(), review()])));
  return { dir, mf, evidence };
}
const cli = resolve('scripts/validation-audit.mjs');
const invoke = args => run(process.execPath, [cli, ...args], { timeout: 10000 });

test('CLI reads only explicit files, makes no writes, and exposes JSON findings and errors', async t => {
  const f = await fixture(t), before = await readdir(f.dir);
  const argv = ['--manifest', f.mf, '--input', f.evidence, '--json'];
  const ok = invoke(argv);
  assert.equal(ok.status, 0, ok.stderr); assert.equal(JSON.parse(ok.stdout).authority, 'advisory-only');
  await writeFile(f.evidence, JSON.stringify(input([{ ...gate(), cpuMs: null, command: 'touch /private/not-authorized', source: '/private/not-authorized' }])));
  const gap = invoke(argv); assert.equal(gap.status, 1, gap.stderr);
  assert.ok(JSON.parse(gap.stdout).findings.length);
  assert.deepEqual(await readdir(f.dir), before);
  assert.equal(invoke(['--help']).status, 0);
  const invalid = invoke([...argv, '--execute']); assert.equal(invalid.status, 2); assert.equal(JSON.parse(invalid.stderr).error, 'invalid arguments; use --help');
  await writeFile(f.evidence, 'Acme-private-invalid-json');
  const bad = invoke(argv); assert.equal(bad.status, 2); assert.equal(bad.stderr.includes('Acme-private'), false);
  const source = await readFile(cli, 'utf8'); const library = await readFile(resolve('lib/validation-audit.mjs'), 'utf8');
  for (const text of [source, library]) assert.doesNotMatch(text, /(?:from\s+['"]node:(?:child_process|http|https|net)|\bfetch\s*\(|\bwriteFile\s*\()/, 'analyzer has no execution, network or write boundary');
});

test('CLI refuses oversized files and symlink input without following evidence paths', async t => {
  const f = await fixture(t), alias = join(f.dir, 'alias.json');
  await symlink(f.evidence, alias);
  const linked = invoke(['--manifest', f.mf, '--input', alias, '--json']);
  assert.equal(linked.status, 2); assert.match(linked.stderr, /symlinks/);
  await writeFile(f.evidence, ' '.repeat(AUDIT_LIMITS.bytes + 1));
  const large = invoke(['--manifest', f.mf, '--input', f.evidence, '--json']);
  assert.equal(large.status, 2); assert.match(large.stderr, /byte limit/);
});
