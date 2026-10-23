// Synthetic Acme observations, never live GitHub or private consumer data.
import './helpers/hermetic.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { deflateRawSync, crc32 } from 'node:zlib';
import { run } from './helpers/run.mjs';
import { collectLedger, bridgeLedgerInputs, JOINT_INPUT_KEYS, LEDGER_LIMITS } from '../lib/validation-ledger.mjs';
import { auditValidation } from '../lib/validation-audit.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const published = JSON.parse(await readFile(join(ROOT, 'scripts/validation-manifests/ledger.v1.json'), 'utf8'));
const repo = 'acme/anvil', head = 'a'.repeat(40), tree = 'b'.repeat(40), now = '2026-10-23T12:00:00Z';
const start = '2026-10-23T10:00:00Z', end = '2026-10-23T10:10:00Z';
const digest = value => createHash('sha256').update(value).digest('hex');
const fleet = [{ repo, role: 'managed' }];
const codes = r => r.gaps.map(g => g.code);

function zip(files) {
  const local = [], central = []; let offset = 0;
  for (const { name, body, crc, mode = 0o100644, claimed } of files) {
    const bytes = Buffer.from(body), compressed = deflateRawSync(bytes), n = Buffer.from(name);
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50); l.writeUInt16LE(20, 4); l.writeUInt16LE(8, 8); l.writeUInt32LE(crc ?? crc32(bytes), 14); l.writeUInt32LE(compressed.length, 18); l.writeUInt32LE(claimed ?? bytes.length, 22); l.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50); c.writeUInt16LE(0x314, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(8, 10); c.writeUInt32LE(crc ?? crc32(bytes), 16); c.writeUInt32LE(compressed.length, 20); c.writeUInt32LE(claimed ?? bytes.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE((mode << 16) >>> 0, 38); c.writeUInt32LE(offset, 42);
    local.push(l, n, compressed); central.push(c, n); offset += l.length + n.length + compressed.length;
  }
  const directory = Buffer.concat(central), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(directory.length, 12); e.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, e]);
}
const child = (dir, clock, change = {}) => ({ commit: head, tree, dirty: false, dir, workflow: 'AcmeTests', date: '2026-10-23T10:05:00Z', wallMs: 1000, completed: true, node: 'v26.12.1', config: 'c'.repeat(12), commandHash: 'd'.repeat(12), setting: { env: { LEDGE_CLOCK_SHIFT_DAYS: String(clock) } }, tests: [{ name: 'private Acme test body must stay private', outcome: 'pass', ms: 10 }], ...change });
function fixture() {
  const profile = structuredClone(published); profile.repo = repo; profile.workflowName = 'AcmeTests'; profile.privateData.repo = 'acme/anvil-data';
  const routes = {}, archives = {}, calls = [], downloads = [];
  const base = `repos/${repo}`, runPath = `${base}/actions/runs/7`;
  routes[runPath] = { id: 7, run_attempt: 1, head_sha: head, workflow_id: 9, path: profile.workflow, name: profile.workflowName, status: 'completed', conclusion: 'success', repository: { id: 11, full_name: repo }, head_repository: { id: 11, full_name: repo }, head_commit: { id: head, tree_id: tree }, run_started_at: start, updated_at: end };
  routes[base] = { id: 11, full_name: repo };
  routes[`${base}/actions/workflows/9`] = { id: 9, path: profile.workflow, name: profile.workflowName };
  routes[`${base}/git/commits/${head}`] = { sha: head, tree: { sha: tree } };
  for (const source of profile.sources) {
    const bytes = Buffer.from(`Acme reviewed bytes: ${source.path}\n${source.path.endsWith('test-ledger.mjs') ? 'x'.repeat(90_000) + String.raw`\u0000`.repeat(13) : ''}`); source.sha256 = digest(bytes);
    routes[`${base}/contents/${source.path}?ref=${head}`] = bytes;
  }
  const jobs = profile.hosted.jobs.map((name, i) => {
    const names = name === 'web' ? profile.hosted.webInstallOrder : [...profile.configured.stages.filter(s => s.hosted?.job === name).map(s => s.hosted.step), ...profile.hosted.extraStages.filter(s => s.job === name).map(s => s.step)];
    return { id: 20 + i, name, run_id: 7, run_attempt: 1, head_sha: head, status: 'completed', conclusion: 'success', started_at: start, completed_at: end, steps: names.map((name, number) => ({ name, number, status: 'completed', conclusion: 'success', started_at: start, completed_at: end })) };
  });
  routes[`${runPath}/attempts/1/jobs?per_page=100&page=1`] = { total_count: jobs.length, jobs };
  const artifacts = profile.lanes.map((lane, i) => ({ id: 30 + i, name: lane.artifact, expired: false, expires_at: '2026-11-20T10:00:00Z', created_at: '2026-10-23T10:08:00Z', updated_at: '2026-10-23T10:09:00Z', workflow_run: { id: 7, repository_id: 11, head_repository_id: 11, head_sha: head } }));
  routes[`${runPath}/artifacts?per_page=100&page=1`] = { total_count: artifacts.length, artifacts };
  const files = profile.lanes.map(l => [0, 400].map(clock => ({ name: `acme-${clock}.json`, body: JSON.stringify(child(l.directory, clock)) })));
  function pack(i) {
    const bytes = zip(files[i]); archives[`${base}/actions/artifacts/${artifacts[i].id}/zip`] = bytes;
    artifacts[i].size_in_bytes = bytes.length; artifacts[i].digest = `sha256:${digest(bytes)}`;
  }
  for (let i = 0; i < artifacts.length; i++) pack(i);
  const request = async (path, bounds) => { calls.push({ path, bounds }); if (!(path in routes)) throw new Error('secret API body'); return Buffer.isBuffer(routes[path]) ? routes[path] : Buffer.from(JSON.stringify(routes[path])); };
  const download = async (path, bounds) => { downloads.push({ path, bounds }); if (!(path in archives)) throw new Error('secret archive failure'); return archives[path]; };
  return { profile, routes, artifacts, jobs, files, pack, archives, calls, downloads, collect: (extra = {}) => collectLedger({ fleet, profile, runId: 7, observedAt: now, request, download, ...extra }) };
}

test('reviewed manifest separates configured local coverage from independent hosted jobs', () => {
  assert.equal(published.configured.stages.length, 13);
  assert.deepEqual(published.configured.stages.filter(s => !s.hosted).map(s => s.id), ['voice', 'perf']);
  assert.deepEqual(published.hosted.needs, { scope: [], test: ['scope'], web: ['scope'] });
  assert.equal(published.equivalenceEstablished, false);
  assert.ok(published.sources.every(s => /^[a-f0-9]{64}$/.test(s.sha256)));
  assert.equal(published.privateData.revision, null);
});

test('healthy retained ingestion stays advisory and exposes valid incomplete audit input', async () => {
  const f = fixture(), r = await f.collect();
  assert.equal(r.configuredGateComplete, false); assert.equal(r.reuseAuthorized, false); assert.equal(r.status, 1);
  assert.equal(r.identity.observation, 'override'); assert.equal(r.identity.executionAuthenticated, false);
  assert.equal(r.children.length, 4); assert.ok(r.artifacts.every(a => a.integrityVerified && !a.providerJobLinkObserved && !a.attemptLinkObserved));
  assert.ok(r.sources.every(s => s.matches));
  const sourceCalls = f.calls.filter(c => c.path.includes('/contents/'));
  assert.ok(sourceCalls.every(c => c.bounds.accept === 'application/vnd.github.raw'));
  assert.ok(f.routes[`repos/${repo}/contents/scripts/plates/test-ledger.mjs?ref=${head}`].length > 86_442);
  assert.equal(r.sources.find(s => s.path === 'scripts/plates/test-ledger.mjs').observedSha256, digest(f.routes[`repos/${repo}/contents/scripts/plates/test-ledger.mjs?ref=${head}`]));
  assert.doesNotMatch(JSON.stringify(r), /Acme reviewed bytes|xxxxx/);
  assert.ok(codes(r).includes('configured_gate_unobserved')); assert.ok(codes(r).includes('local_stage_unobserved'));
  assert.ok(codes(r).includes('private_data_unobserved')); assert.ok(codes(r).includes('input_harness_unobserved'));
  assert.ok(!codes(r).includes('child_clock_missing_or_duplicate'));
  assert.ok(r.auditInput.records.every(row => row.cpuMs === null));
  assert.equal(r.runObservation.executionWallMeasured, false); assert.equal(r.runObservation.metadataIntervalMs, 600_000); assert.equal(r.auditInput.records[0].wallMs, null);
  assert.match(r.coverageManifest.digestSemantics, /parsed-profile-property-order-preserved/);
  const audit = auditValidation(fleet, r.auditInput);
  assert.ok(audit.findings.some(x => x.rule === 'incomplete-attestation'));
  assert.doesNotMatch(JSON.stringify(r), /private Acme test body|secret API body|secret archive failure/);
  assert.ok(f.calls.every(c => c.path.startsWith('repos/acme/anvil') && c.bounds.maxBytes === LEDGER_LIMITS.jsonBytes));
  assert.equal(f.downloads.length, 2);
});

test('cache and harness retain separate joint values and separate legacy projections', async () => {
  const inputs = Object.fromEntries(JOINT_INPUT_KEYS.map((k, i) => [k, (i + 1).toString(16).repeat(64)]));
  const bridge = bridgeLedgerInputs({ inputs, commandHash: 'a'.repeat(12), config: 'b'.repeat(12), privateData: { revision: head, tree } });
  assert.equal(bridge.inputs.harness, inputs.harness); assert.equal(bridge.inputs.cache, inputs.cache); assert.notEqual(inputs.harness, inputs.cache);
  assert.equal(bridge.projections.auditSchema1.cache, inputs.cache); assert.ok(!('harness' in bridge.projections.auditSchema1));
  assert.equal(bridge.projections.shadowSchema1.harness, inputs.harness); assert.ok(!('cache' in bridge.projections.shadowSchema1));
  assert.equal(bridge.legacy.commandHash.length, 12); assert.equal(bridge.comparisonSupported, false);
  const f = fixture(); f.files[0][0].body = JSON.stringify(child('.', 0, { inputs, privateData: { revision: head, tree } })); f.pack(0);
  const r = await f.collect(); assert.equal(r.children[0].bridge.inputs.harness, inputs.harness); assert.ok(codes(r).includes('private_data_expected_revision_unbound'));
  const missing = bridgeLedgerInputs({ inputs: { harness: 'a'.repeat(12), cache: null } });
  assert.equal(missing.inputs.harness, null); assert.equal(missing.inputs.cache, null);
});

test('large immutable source bytes bypass reporter JSON limits but retain exact hashes and byte caps', async () => {
  const f = fixture(), path = `repos/${repo}/contents/scripts/plates/test-ledger.mjs?ref=${head}`;
  assert.ok(f.routes[path].length > 86_442);
  assert.equal(f.routes[path].toString('utf8').split(String.raw`\u0000`).length - 1, 13);
  assert.equal(f.routes[path].includes(Buffer.from([0])), false);
  let r = await f.collect();
  assert.equal(r.sources.find(s => s.path === 'scripts/plates/test-ledger.mjs').observedSha256, digest(f.routes[path]));
  assert.ok(!codes(r).includes('coverage_source_changed_or_unavailable'));
  const transformed = Buffer.from(f.routes[path].toString('utf8').replaceAll(String.raw`\u0000`, '^@'));
  assert.equal(f.routes[path].length - transformed.length, 52);
  assert.notEqual(digest(transformed), digest(f.routes[path]));
  f.routes[path] = transformed;
  r = await f.collect(); assert.ok(codes(r).includes('coverage_source_changed_or_unavailable'));
  assert.equal(r.sources.find(s => s.path === 'scripts/plates/test-ledger.mjs').observedSha256, digest(transformed));
  f.routes[path] = Buffer.alloc(LEDGER_LIMITS.jsonBytes + 1, 120);
  r = await f.collect(); assert.ok(codes(r).includes('coverage_source_changed_or_unavailable'));
  assert.equal(r.sources.find(s => s.path === 'scripts/plates/test-ledger.mjs').observedSha256, null);
  assert.doesNotMatch(JSON.stringify(r), /xxxxxxxx/);
});

test('actual redacted harness setting shape is retained without decoding hash into clock', async () => {
  const f = fixture();
  for (let i = 0; i < f.files.length; i++) {
    f.files[i][0].body = JSON.stringify(child(i ? 'web' : '.', 0, { setting: { env: { LEDGE_CLOCK_SHIFT_DAYS: { name: 'LEDGE_CLOCK_SHIFT_DAYS', set: false, hash: null } } } }));
    f.files[i][1].body = JSON.stringify(child(i ? 'web' : '.', 400, { setting: { env: { LEDGE_CLOCK_SHIFT_DAYS: { name: 'LEDGE_CLOCK_SHIFT_DAYS', set: true, hash: digest('400').slice(0, 12) } } } })); f.pack(i);
  }
  const r = await f.collect(); assert.equal(r.children[0].clockShiftDays, 0); assert.equal(r.children[1].clockShiftDays, null);
  assert.equal(r.children[1].clockObservation.valueHash12, digest('400').slice(0, 12)); assert.ok(codes(r).includes('child_clock_unobserved'));
  for (const value of ['unknown', '17', { name: 'LEDGE_CLOCK_SHIFT_DAYS', set: true, hash: 'a'.repeat(12) }]) {
    f.files[0][0].body = JSON.stringify(child('.', 0, { setting: { env: { LEDGE_CLOCK_SHIFT_DAYS: value } } })); f.pack(0);
    assert.equal((await f.collect()).children[0].clockShiftDays, null);
  }
});

test('corrupt, unsafe, duplicate and oversized ZIP entries fail before child ingestion', async t => {
  for (const [label, change] of [
    ['crc', files => { files[0].crc = 1; }], ['traversal', files => { files[0].name = '../acme.json'; }],
    ['duplicate', files => { files[1].name = files[0].name; }], ['symlink', files => { files[0].mode = 0o120777; }],
    ['inflated bound', files => { files[0].claimed = LEDGER_LIMITS.expandedBytes + 1; }],
    ['entry JSON bound', files => { files[0].body = 'a'.repeat(LEDGER_LIMITS.jsonBytes + 1); }],
  ]) await t.test(label, async () => { const f = fixture(); change(f.files[0]); f.pack(0); const r = await f.collect(); assert.ok(codes(r).includes('archive_unsafe_or_corrupt')); assert.equal(r.children.filter(c => c.lane === 'core').length, 0); });
  const f = fixture(); f.archives['repos/acme/anvil/actions/artifacts/30/zip'][0] ^= 1;
  assert.ok(codes(await f.collect()).includes('archive_digest_mismatch'));
});

test('foreign, expired, missing digest and oversized artifacts never download', async t => {
  for (const [label, change, code] of [
    ['foreign run', a => { a.workflow_run.id = 99; }, 'artifact_identity_mismatch'],
    ['foreign head', a => { a.workflow_run.head_sha = 'c'.repeat(40); }, 'artifact_identity_mismatch'],
    ['expired', a => { a.expired = true; }, 'artifact_expired_or_unknown'],
    ['missing digest', a => { delete a.digest; }, 'artifact_digest_unavailable'],
    ['too large', a => { a.size_in_bytes = LEDGER_LIMITS.archiveBytes + 1; }, 'archive_size_bound'],
    ['older attempt', a => { a.created_at = '2026-10-22T10:00:00Z'; }, 'artifact_attempt_interval_mismatch'],
  ]) await t.test(label, async () => { const f = fixture(); change(f.artifacts[0]); const r = await f.collect(); assert.ok(codes(r).includes(code)); assert.equal(f.downloads.length, 1); });
});

test('missing and duplicate lanes or hosted stages remain gaps', async t => {
  for (const label of ['missing', 'duplicate', 'wrong name']) await t.test(label, async () => {
    const f = fixture(); if (label === 'missing') { f.artifacts.pop(); f.routes['repos/acme/anvil/actions/runs/7/artifacts?per_page=100&page=1'].total_count--; }
    if (label === 'duplicate') f.artifacts[1].name = f.artifacts[0].name;
    if (label === 'wrong name') f.artifacts[1].name = 'acme-unrelated';
    assert.ok(codes(await f.collect()).includes('artifact_missing_or_duplicate'));
  });
  const f = fixture(); f.jobs[1].steps[0].conclusion = 'skipped'; f.jobs[2].steps.reverse();
  const r = await f.collect(); assert.ok(codes(r).includes('hosted_stage_missing_or_failed')); assert.ok(codes(r).includes('web_install_order_mismatch'));
});

test('run identity is unusable while workflow, tree, job attempt and changed sources stay explicit', async () => {
  const f = fixture(), run = f.routes['repos/acme/anvil/actions/runs/7']; run.repository.full_name = 'acme/foreign';
  await assert.rejects(f.collect(), { code: 'run_identity_unusable' }); run.repository.full_name = repo;
  f.routes['repos/acme/anvil/actions/workflows/9'].path = '.github/workflows/other.yml';
  f.routes[`repos/acme/anvil/git/commits/${head}`].tree.sha = 'c'.repeat(40); f.jobs[1].run_attempt = 2;
  f.routes[`repos/acme/anvil/contents/package.json?ref=${head}`] = Buffer.from('changed');
  const r = await f.collect(); for (const code of ['workflow_identity_mismatch', 'head_tree_mismatch', 'job_identity_mismatch', 'coverage_source_changed_or_unavailable']) assert.ok(codes(r).includes(code), code);
  assert.equal(r.identity.tree, null); assert.equal(r.configuredGateComplete, false);
});

test('dirty, failed, filtered, missing and foreign child inventories never become complete', async () => {
  const f = fixture(); f.files[1][0].body = JSON.stringify(child('web', 0, { dirty: true, filtered: true, tests: [{ outcome: 'fail', name: 'private failure' }], privateData: { revision: 'e'.repeat(40), tree: 'f'.repeat(40) } })); f.pack(1);
  let r = await f.collect(); const dirty = r.children.find(c => c.lane === 'web'); assert.equal(dirty.dirty, true);
  assert.ok(codes(r).includes('child_dirty_tree')); assert.ok(codes(r).includes('child_failed_incomplete_or_filtered')); assert.ok(codes(r).includes('private_data_expected_revision_unbound'));
  assert.equal(r.auditInput.records.find(c => c.id === dirty.id).status, 1); assert.doesNotMatch(JSON.stringify(r), /private failure/);
  f.files[0] = [{ name: 'acme.json', body: JSON.stringify(child('.', 0, { tests: [] })) }]; f.pack(0);
  r = await f.collect(); assert.ok(codes(r).includes('lane_child_inventory_missing')); assert.ok(codes(r).includes('child_inventory_unavailable'));
  f.files[0][0].body = JSON.stringify(child('web', 0)); f.pack(0); assert.ok(codes(await f.collect()).includes('child_identity_mismatch'));
});

test('failed/cancelled jobs and incomplete pagination retain outcomes and original spans', async () => {
  const f = fixture(); f.jobs[1].conclusion = 'cancelled'; f.jobs[1].status = 'completed';
  f.routes['repos/acme/anvil/actions/runs/7/attempts/1/jobs?per_page=100&page=1'].total_count = 4;
  const r = await f.collect(); assert.ok(codes(r).includes('pagination_incomplete')); assert.ok(codes(r).includes('job_not_successful'));
  assert.equal(r.jobs.find(j => j.job === 'test').conclusion, 'cancelled'); assert.equal(r.jobs[0].startedAt, start); assert.equal(r.jobs[0].endedAt, end);
  assert.equal(r.jobs[0].wallMs, 600_000); assert.equal(r.jobs[0].cpuMs, null);
  assert.ok(!('totalWallMs' in r.coverage));
});

test('listing page bounds and duplicate IDs are explicit and requests stay bounded', async () => {
  const f = fixture(), base = 'repos/acme/anvil/actions/runs/7/attempts/1/jobs';
  for (let page = 1; page <= LEDGER_LIMITS.pages; page++) f.routes[`${base}?per_page=100&page=${page}`] = { total_count: 501, jobs: Array.from({ length: 100 }, (_, i) => ({ id: (page - 1) * 100 + i + 100, name: 'acme-extra' })) };
  assert.ok(codes(await f.collect()).includes('pagination_bound'));
  assert.ok(f.calls.length <= LEDGER_LIMITS.requests);
  const d = fixture(); d.jobs[1].id = d.jobs[0].id; assert.ok(codes(await d.collect()).includes('pagination_duplicate_or_invalid'));
});

test('strict child JSON, interval and missing clock controls preserve audit compatibility', async () => {
  const f = fixture(); f.files[0][0].body = '{"tests":[],"tests":[]}'; f.files[0][1].body = JSON.stringify(child('.', 400, { date: '2026-11-23T12:00:00Z', setting: {} })); f.pack(0);
  const r = await f.collect(); assert.ok(codes(r).includes('child_json_invalid_or_bound')); assert.ok(codes(r).includes('child_interval_mismatch'));
  assert.ok(codes(r).includes('child_clock_unobserved')); assert.doesNotThrow(() => auditValidation(fleet, r.auditInput));
});

test('request failures are safe gaps and invalid fleet/run/profile input performs no reads', async () => {
  const f = fixture(); delete f.routes['repos/acme/anvil/actions/workflows/9'];
  const r = await f.collect(); assert.ok(codes(r).includes('api_request_failed')); assert.doesNotMatch(JSON.stringify(r), /secret API/);
  for (const extra of [{ fleet: [{ repo, role: 'source' }] }, { runId: 0 }, { runId: '7' }, { profile: { ...f.profile, workflow: '../secret' } }]) {
    const before = f.calls.length; await assert.rejects(f.collect(extra)); assert.equal(f.calls.length, before);
  }
  await assert.rejects(f.collect({ request: async () => { throw new Error('credential-secret'); } }), { code: 'run_identity_unusable' });
});

test('CLI rejects invalid flags, unmanaged files and symlinks before gh; no transport bodies leak', async t => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'plates-acme-ledger-'))); t.after(() => rm(dir, { recursive: true, force: true }));
  const manifest = join(dir, 'fleet.json'), script = join(ROOT, 'scripts/validation-ledger.mjs');
  await writeFile(manifest, JSON.stringify(fleet));
  const cli = args => run(process.execPath, [script, ...args], { cwd: ROOT, env: { ...process.env, PLATES_GH: '/acme/no-network-executable' } });
  for (const args of [[], ['--run', '0', '--manifest', manifest], ['--run', '7', '--run', '8', '--manifest', manifest], ['--run', '7', '--manifest', manifest], ['--latest'], ['--run', '7', '--manifest', dir]]) {
    const r = cli([...args, '--json']); assert.equal(r.status, 2, r.stderr); assert.equal(JSON.parse(r.stderr).reuseAuthorized, false); assert.doesNotMatch(r.stderr, new RegExp(dir));
  }
  await symlink(manifest, join(dir, 'link.json')); assert.equal(cli(['--manifest', join(dir, 'link.json'), '--run', '7', '--json']).status, 2);
  assert.equal(cli(['--help']).status, 0);
  // The CLI's real reviewed repository metadata is used only to reach a local
  // executable stub; no real consumer observations are fabricated by this test.
  await writeFile(manifest, JSON.stringify([{ repo: published.repo, role: 'managed' }]));
  const stub = join(dir, 'acme-gh'), argsFile = join(dir, 'args.json');
  await writeFile(stub, `#!${process.execPath}\nimport fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(argsFile)},JSON.stringify(process.argv.slice(2))); process.stdout.write('secret transport body');\n`, { mode: 0o755 });
  const r = run(process.execPath, [script, '--manifest', manifest, '--run', '7', '--json'], { cwd: ROOT, env: { ...process.env, PLATES_GH: stub, GH_HOST: 'acme.invalid' } });
  assert.equal(r.status, 2); assert.doesNotMatch(r.stderr + r.stdout, /secret transport body/);
  assert.deepEqual(JSON.parse(await readFile(argsFile, 'utf8')), ['api', '--hostname', 'github.com', '--method', 'GET', `repos/${published.repo}/actions/runs/7`]);
});
