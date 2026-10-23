// Synthetic Acme evidence: shadow consistency is never execution or reuse authority.
import './helpers/hermetic.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, rm, symlink, realpath, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { run } from './helpers/run.mjs';
import { validateEvidence, manifestDigest, parseEvidenceJson, bytesDigest, INPUT_KEYS, EVIDENCE_LIMITS } from '../lib/validation-evidence.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value));
const clone = value => structuredClone(value);
const cli = resolve('scripts/validation-evidence.mjs');
const repo = 'acme/anvils', head = 'a'.repeat(40), tree = 'b'.repeat(40), changed = 'd'.repeat(64);
const at = second => `2026-10-23T01:00:${String(second).padStart(2, '0')}.000Z`;
function fixture() {
  const candidate = { repo, head, tree, dirty: false, gateSource: 'configured-check', inputs: Object.fromEntries(INPUT_KEYS.map(k => [k, hash(k)])) };
  const manifest = { schema: 1, repo, gateCommandDigest: candidate.inputs.command, stages: [{ id: 'ordinary', commandDigest: hash('ordinary command') }, { id: 'generated', commandDigest: hash('generated command') }] };
  const expected = { schema: 1, candidate, manifest, evaluatedAt: at(30), freshness: { mode: 'max-age', maxAgeMs: 10000 } };
  const source = { provider: 'github-actions', repo, workflow: '.github/workflows/acme.yml', runId: '123', attempt: 1, artifactId: '456', expiresAt: '2026-10-24T01:00:00.000Z' };
  const executionSource = Object.fromEntries(['provider', 'repo', 'workflow', 'runId', 'attempt'].map(k => [k, source[k]]));
  const artifact = { schema: 1, candidate: clone(candidate), manifestDigest: manifestDigest(manifest), invocationId: 'outer-1', source: clone(executionSource), startedAt: at(0), endedAt: at(20), completed: true, status: 0,
    stages: manifest.stages.map((s, i) => ({ ...s, candidate: clone(candidate), manifestDigest: manifestDigest(manifest), invocationId: `child-${i}`, parentInvocationId: 'outer-1', source: clone(executionSource), startedAt: at(i), endedAt: at(19), completed: true, status: 0 })) };
  return { expected, source, artifact };
}
function report(f = fixture()) { const bytes = json(f.artifact); return validateEvidence(f.expected, { ...f.source, sha256: hash(bytes) }, bytes); }
function rejectArtifact(mutator, code) {
  const f = fixture(), before = json(f.artifact).toString(); mutator(f.artifact);
  assert.notEqual(json(f.artifact).toString(), before, 'mutation must change evidence');
  const r = report(f); assert.equal(r.status, 1); assert.equal(r.coverageComplete, false); assert.equal(r.reuseAuthorized, false);
  assert.ok(r.findings.some(f => f.code === code), `${code}: ${JSON.stringify(r.findings)}`);
}

test('complete single-invocation evidence has structural coverage and no authority', () => {
  const r = report(); assert.equal(r.status, 0); assert.equal(r.coverageComplete, true);
  assert.equal(r.authority, 'advisory-only'); assert.equal(r.reuseAuthorized, false);
  assert.equal(Object.hasOwn(r, 'canReuse'), false); assert.deepEqual(r.findings, []);
  assert.match(r.limits.join(' '), /not origin authentication or truthful execution proof/);
});

test('manifest digest is canonical, stage-order independent, and binds requirements', () => {
  const m = fixture().expected.manifest;
  const canonicalText = JSON.stringify({ gateCommandDigest: m.gateCommandDigest, repo, schema: 1, stages: [...m.stages].reverse().map(s => ({ commandDigest: s.commandDigest, id: s.id })) });
  assert.equal(manifestDigest(m), hash(canonicalText), 'independently spelled canonical representation');
  assert.equal(manifestDigest({ stages: [...m.stages].reverse(), repo, schema: 1, gateCommandDigest: m.gateCommandDigest }), manifestDigest(m));
  for (const change of [n => n.stages.pop(), n => n.stages[0].commandDigest = changed, n => n.repo = 'acme/other', n => n.gateCommandDigest = changed]) {
    const n = clone(m); change(n); assert.notEqual(manifestDigest(n), manifestDigest(m));
  }
  for (const change of [n => n.stages = [], n => n.stages.push(clone(n.stages[0])), n => n.schema = 2, n => n.stages[0].id = '../secret', n => n.stages[0].commandDigest = null]) {
    const n = clone(m); change(n); assert.throws(() => manifestDigest(n), /invalid_manifest/);
  }
});

test('artifact bytes are checked before parsing and a self-asserted integrity flag is useless', () => {
  const f = fixture(), bytes = json(f.artifact), source = { ...f.source, sha256: hash(bytes) };
  assert.equal(bytesDigest(bytes), hash(bytes));
  for (const corrupt of [Buffer.concat([bytes, Buffer.from(' ')]), Buffer.from('not json')]) {
    const r = validateEvidence(f.expected, source, corrupt); assert.deepEqual(r.findings, [{ code: 'artifact_digest_mismatch' }]);
  }
  rejectArtifact(a => a.integrityVerified = true, 'outer_fields');
  assert.throws(() => validateEvidence(f.expected, { ...source, sha256: null }, bytes), /invalid_source/);
});

test('every immutable candidate axis must match both outer and child evidence', () => {
  const mutations = [c => c.repo = 'acme/other', c => c.head = 'e'.repeat(40), c => c.tree = 'f'.repeat(40), c => c.dirty = true, c => c.gateSource = 'explicit-command', ...INPUT_KEYS.map(k => c => c.inputs[k] = changed), ...INPUT_KEYS.map(k => c => delete c.inputs[k])];
  for (const mutate of mutations) {
    rejectArtifact(a => mutate(a.candidate), 'candidate_mismatch');
    rejectArtifact(a => mutate(a.stages[0].candidate), 'stage_candidate_mismatch');
  }
  rejectArtifact(a => a.candidate.inputs.extra = changed, 'candidate_mismatch');
  rejectArtifact(a => a.stages[0].candidate.head = null, 'stage_candidate_mismatch');
});

test('requirements come from the separate manifest and every required stage must occur once', () => {
  rejectArtifact(a => a.stages = [], 'stage_missing');
  rejectArtifact(a => a.stages.pop(), 'stage_missing');
  rejectArtifact(a => a.stages.push(clone(a.stages[0])), 'stage_duplicate');
  rejectArtifact(a => a.stages.push({ ...clone(a.stages[0]), id: 'unmapped' }), 'stage_unexpected');
  rejectArtifact(a => a.manifestDigest = changed, 'manifest_mismatch');
  rejectArtifact(a => a.stages[0].manifestDigest = changed, 'stage_manifest_mismatch');
  rejectArtifact(a => a.stages[0].commandDigest = changed, 'stage_command_mismatch');
  const f = fixture(); f.expected.manifest.stages.push({ id: 'required-security', commandDigest: hash('security') });
  const r = report(f); assert.ok(r.findings.some(f => f.code === 'stage_missing' && f.stage === 'required-security'));
  const reordered = fixture(); reordered.artifact.stages.reverse(); assert.equal(report(reordered).status, 0);
});

test('a false wrapper cannot hide failed partial or unlinked children', () => {
  for (const value of [false, null, 'true']) {
    rejectArtifact(a => a.completed = value, 'outer_failed_or_incomplete');
    rejectArtifact(a => a.stages[0].completed = value, 'stage_failed_or_incomplete');
  }
  for (const value of [1, null, '0']) {
    rejectArtifact(a => a.status = value, 'outer_failed_or_incomplete');
    rejectArtifact(a => a.stages[0].status = value, 'stage_failed_or_incomplete');
  }
  rejectArtifact(a => a.invocationId = null, 'invocation_missing');
  rejectArtifact(a => a.stages[0].parentInvocationId = 'another-parent', 'stage_parent_mismatch');
  rejectArtifact(a => a.stages[0].invocationId = 'outer-1', 'stage_invocation_invalid');
  rejectArtifact(a => a.stages[1].invocationId = a.stages[0].invocationId, 'stage_invocation_invalid');
});

test('all source identities bind outer and every child; retries are unsupported', () => {
  const mutations = [s => s.provider = 'other', s => s.repo = 'acme/other', s => s.workflow = '.github/workflows/other.yml', s => s.runId = '124', s => s.attempt = 2];
  for (const mutate of mutations) {
    rejectArtifact(a => mutate(a.source), 'source_mismatch');
    rejectArtifact(a => mutate(a.stages[0].source), 'stage_source_mismatch');
  }
  rejectArtifact(a => a.source.artifactId = '457', 'source_mismatch');
  rejectArtifact(a => a.stages[0].source.expiresAt = '2026-10-25T01:00:00.000Z', 'stage_source_mismatch');
  rejectArtifact(a => a.retryOf = 'prior-attempt', 'outer_fields');
  rejectArtifact(a => a.stages[0].retryOf = 'prior-stage', 'stage_fields');
  const f = fixture(); f.source.attempt = 2; assert.throws(() => report(f), /invalid_source/);
});

test('post-upload artifact identity and expiry remain external to producer bytes', () => {
  const f = fixture(), bytes = json(f.artifact);
  assert.deepEqual(Object.keys(f.artifact.source).sort(), ['attempt', 'provider', 'repo', 'runId', 'workflow']);
  f.source.artifactId = '789';
  const r = report(f); assert.equal(r.status, 0); assert.equal(r.artifact.id, '789');
  assert.equal(r.artifact.provenance, 'caller-supplied'); assert.deepEqual(json(f.artifact), bytes);
  for (const mutate of [s => s.artifactId = null, s => s.expiresAt = null, s => s.sha256 = null]) {
    const source = { ...f.source, sha256: hash(bytes) }; mutate(source);
    assert.throws(() => validateEvidence(f.expected, source, bytes), /invalid_source/);
  }
  f.source.expiresAt = f.expected.evaluatedAt;
  assert.ok(report(f).findings.some(f => f.code === 'artifact_expired'));
});

test('canonical timestamps, bounded child intervals and explicit freshness fail closed', () => {
  for (const value of ['2026-02-30T01:00:00.000Z', '2026-10-23T01:00:00Z', '2026-10-23T01:00:00.000+00:00', null]) {
    rejectArtifact(a => a.startedAt = value, 'outer_chronology');
    rejectArtifact(a => a.stages[0].startedAt = value, 'stage_chronology');
  }
  rejectArtifact(a => a.startedAt = at(21), 'outer_chronology');
  rejectArtifact(a => a.endedAt = at(31), 'outer_chronology');
  rejectArtifact(a => a.stages[0].startedAt = '2026-10-23T00:59:59.000Z', 'stage_chronology');
  rejectArtifact(a => a.stages[0].endedAt = at(21), 'stage_chronology');
  rejectArtifact(a => a.stages[0].endedAt = '2026-10-23T00:59:59.000Z', 'stage_chronology');
  const f = fixture(); f.expected.evaluatedAt = at(31); assert.ok(report(f).findings.some(f => f.code === 'evidence_stale'));
  f.expected.freshness = { mode: 'until-change' }; assert.equal(report(f).status, 0);
  f.expected.evaluatedAt = f.source.expiresAt; assert.ok(report(f).findings.some(f => f.code === 'artifact_expired'), 'until-change never overrides artifact expiry');
  f.expected.freshness = {}; assert.throws(() => report(f), /invalid_expectation/);
});

test('malformed or unsupported expectations are input errors, never permissive defaults', () => {
  const mutations = [e => e.schema = 2, e => e.candidate.dirty = true, e => e.manifest.repo = 'acme/other', e => e.manifest.gateCommandDigest = changed, e => delete e.evaluatedAt, e => e.freshness.maxAgeMs = 0, e => e.freshness.mode = 'forever', e => e.extra = true];
  for (const mutate of mutations) { const f = fixture(); mutate(f.expected); assert.throws(() => report(f), /invalid_expectation/); }
  for (const value of [null, [], {}, { schema: 2 }]) { const f = fixture(); f.artifact = value; assert.throws(() => report(f), /unsupported_artifact_schema/); }
  rejectArtifact(a => delete a.stages, 'outer_fields');
});

test('UTF-8, duplicate keys, nesting, bytes, node counts and field sizes are bounded', () => {
  for (const bad of [Buffer.from('{'), Buffer.from([0x22, 0xff, 0x22])]) assert.throws(() => parseEvidenceJson(bad), /invalid_json/);
  for (const text of ['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"nested":{"x":1,"x":2}}']) assert.throws(() => parseEvidenceJson(Buffer.from(text)), /duplicate_json_key/);
  assert.deepEqual(parseEvidenceJson(Buffer.from('{"x":{"a":1},"y":{"a":2}}')), { x: { a: 1 }, y: { a: 2 } });
  assert.throws(() => parseEvidenceJson(Buffer.from('['.repeat(14) + '0' + ']'.repeat(14))), /input_limits/);
  assert.throws(() => parseEvidenceJson(Buffer.alloc(EVIDENCE_LIMITS.bytes + 1, 32)), /input_bytes/);
  assert.throws(() => parseEvidenceJson(json('x'.repeat(EVIDENCE_LIMITS.string + 1))), /input_limits/);
  assert.throws(() => parseEvidenceJson(json(Array(20001).fill(0))), /input_limits/);
  const f = fixture(); f.artifact.stages = Array(129).fill(f.artifact.stages[0]);
  assert.ok(report(f).findings.some(f => f.code === 'invalid_stage_union'));
});

async function cliFixture(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'plates-evidence-acme-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = fixture(), artifact = json(f.artifact), paths = { expected: join(dir, 'expected.json'), source: join(dir, 'source.json'), artifact: join(dir, 'artifact.json') };
  await writeFile(paths.expected, json(f.expected)); await writeFile(paths.source, json({ ...f.source, sha256: hash(artifact) })); await writeFile(paths.artifact, artifact);
  const execute = (changes = {}, extras = []) => run(process.execPath, [cli, ...Object.entries({ ...paths, ...changes }).flatMap(([k, p]) => [`--${k}`, p]), '--json', ...extras]);
  return { f, dir, paths, execute };
}

test('CLI reads explicit bytes, retains files, emits JSON and distinguishes exit 0/1/2', async t => {
  const { f, dir, paths, execute } = await cliFixture(t), before = await readdir(dir);
  let r = execute(); assert.equal(r.status, 0, r.stderr); assert.equal(JSON.parse(r.stdout).reuseAuthorized, false);
  assert.deepEqual(await readdir(dir), before); assert.deepEqual(JSON.parse(await readFile(paths.expected, 'utf8')), f.expected);
  await writeFile(paths.artifact, Buffer.concat([json(f.artifact), Buffer.from(' ')]));
  r = execute(); assert.equal(r.status, 1); assert.equal(JSON.parse(r.stdout).findings[0].code, 'artifact_digest_mismatch');
  await writeFile(paths.expected, '{'); r = execute(); assert.equal(r.status, 2); assert.equal(JSON.parse(r.stderr).error, 'invalid_json');
  const help = run(process.execPath, [cli, '--help', '--json']); assert.equal(help.status, 0); assert.match(JSON.parse(help.stdout).usage, /No exit authorizes reuse/);
});

test('CLI rejects invalid UTF-8 and duplicate escaped keys after exact byte verification', async t => {
  const { f, paths, execute } = await cliFixture(t);
  for (const [bytes, code] of [[Buffer.from([0x22, 0xff, 0x22]), 'invalid_json'], [Buffer.from(String.raw`{"schema":1,"\u0073chema":1}`), 'duplicate_json_key']]) {
    await writeFile(paths.artifact, bytes);
    await writeFile(paths.source, json({ ...f.source, sha256: hash(bytes) }));
    const r = execute(); assert.equal(r.status, 2, r.stdout + r.stderr); assert.equal(JSON.parse(r.stderr).error, code);
  }
});

test('CLI refuses noncanonical symlink directory missing oversized paths and duplicate flags safely', async t => {
  const { dir, paths, execute } = await cliFixture(t);
  const alias = join(dir, 'alias.json'); await symlink(paths.artifact, alias);
  const aliasDir = join(dir, 'alias-dir'); await symlink(dir, aliasDir);
  const cases = [alias, join(aliasDir, 'artifact.json'), dir, join(dir, 'acme-secret-token-missing'), `${dir}/../${dir.split('/').at(-1)}/artifact.json`, 'artifact.json'];
  for (const artifact of cases) {
    const r = execute({ artifact }); assert.equal(r.status, 2, artifact);
    assert.doesNotMatch(r.stderr, /acme-secret-token|plates-evidence-acme/);
  }
  const large = join(dir, 'large.json'); await writeFile(large, Buffer.alloc(EVIDENCE_LIMITS.bytes + 1, 32));
  assert.equal(execute({ artifact: large }).status, 2);
  assert.equal(execute({}, ['--json']).status, 2);
  assert.equal(execute({}, ['--unknown']).status, 2);
  const nested = join(dir, 'nested'); await mkdir(nested); assert.equal(execute({ artifact: `${nested}/../artifact.json` }).status, 2);
});

test('shadow source has no subprocess, network, write, or active gate imports', async () => {
  const sources = await Promise.all(['lib/validation-evidence.mjs', 'scripts/validation-evidence.mjs'].map(f => readFile(resolve(f), 'utf8')));
  for (const s of sources) {
    assert.doesNotMatch(s, /node:(?:child_process|https?|net)|\bfetch\s*\(|\b(?:writeFile|appendFile|mkdir|unlink|rename)\s*\(/);
    assert.doesNotMatch(s, /from\s+['"][^'"]*(?:gate\.mjs|test-ledger|validation-budget)/);
  }
});
