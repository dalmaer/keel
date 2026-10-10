import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, link, readdir, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';
import { recoverTestHistory, readTestHistory } from '../practices/night/files/scripts/keel/test-history.mjs';
import { stallsEvidence } from '../practices/night/files/scripts/keel/time-receipts.mjs';
import { readRuns, readStalls } from '../practices/night/files/scripts/keel/test-ledger.mjs';
import { run } from './helpers/run.mjs';
import { runBlocks } from './helpers/workflows.mjs';
import { improve, MEASURES } from '../practices/night/files/scripts/keel/improve.mjs';
import { parseTimeProposal, withTimeProposal } from '../practices/night/files/scripts/keel/time-proposals.mjs';
import { timeEvidence } from './fixtures/improve/time-evidence.mjs';
const source = resolve('practices/night/files/scripts/keel/test-history.mjs');
const workflow = resolve('practices/night/files/.github/workflows/keel-night.yml');
const at = '2026-10-10T12:00:00Z', repo = 'acme/app', branch = 'main', head = 'a'.repeat(40);
async function project(t) {
  const root = await mkdtemp(join(tmpdir(), 'keel-history-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.keel')); await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ ci: { gateWorkflow: 'check.yml' } }));
  return root;
}
// Real ZIP records (stored/deflated), allowing deliberate hostile metadata.
function zip(files) {
  const locals = [], centrals = []; let offset = 0;
  for (const { name, body = '{}', mode = 0o100644, claimed, method = 8 } of files) {
    const data = Buffer.from(body), packed = method === 8 ? deflateRawSync(data) : data, n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc32(data), 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(claimed ?? data.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc32(data), 16); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(claimed ?? data.length, 24); central.writeUInt16LE(n.length, 28); central.writeUInt32LE((mode << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, n, packed); centrals.push(central, n); offset += local.length + n.length + packed.length;
  }
  const directory = Buffer.concat(centrals), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
function fixture(items = [{ id: 1, kind: 'night' }, { id: 2, kind: 'ci' }]) {
  const routes = { 'repos/acme/app': { id: 7, full_name: repo, default_branch: branch },
    'repos/acme/app/actions/workflows/keel-night.yml': { id: 10, path: '.github/workflows/keel-night.yml' },
    'repos/acme/app/actions/workflows/check.yml': { id: 11, path: '.github/workflows/check.yml' } };
  const archives = {}, artifacts = [], calls = [], downloads = [];
  for (const item of items) {
    const date = item.date ?? '2026-10-09T01:00:00Z', runId = item.runId ?? item.id + 100;
    const artifact = { id: item.id, name: 'keel-test-runs', expired: false, created_at: date, size_in_bytes: 100,
      workflow_run: { id: runId, repository_id: 7, head_repository_id: 7, head_branch: branch, head_sha: head } };
    const run = { id: runId, workflow_id: item.kind === 'night' ? 10 : 11, path: `.github/workflows/${item.kind === 'night' ? 'keel-night' : 'check'}.yml`, repository: { id: 7, full_name: repo }, head_repository: { id: 7, full_name: repo }, head_branch: branch, head_sha: head, status: 'completed', updated_at: date, event: item.kind === 'night' ? 'schedule' : 'push', pull_requests: [] };
    artifacts.push(artifact); routes[`repos/acme/app/actions/artifacts/${item.id}`] = artifact; routes[`repos/acme/app/actions/runs/${runId}`] = run;
    archives[item.id] = zip([{ name: `acme-${item.id}.json`, body: JSON.stringify({ date, tests: [], acme: item.id }) }]);
  }
  for (let i = 0; i < Math.ceil(artifacts.length / 100) || i === 0; i++) routes[`repos/acme/app/actions/artifacts?name=keel-test-runs&per_page=100&page=${i + 1}`] = { total_count: artifacts.length, artifacts: artifacts.slice(i * 100, i * 100 + 100) };
  return { routes, archives, artifacts, calls, downloads,
    github: async path => { calls.push(path); if (!(path in routes)) throw new Error(`unexpected API ${path}`); return structuredClone(routes[path]); },
    download: async id => { downloads.push(id); return archives[id]; } };
}
const recover = (root, f, extra = {}) => recoverTestHistory({ root, repo, branch, at, github: f.github, download: f.download, ...extra });
test('history recovers one newest night plus two distinct CI runs per UTC week, preserving sampling gaps', async t => {
  const items = [{ id: 1, kind: 'night' }, { id: 2, kind: 'night', date: '2026-10-08T01:00:00Z' }];
  for (let week = 0; week < 8; week++) for (let n = 0; n < 3; n++) items.push({ id: 10 + week * 3 + n, kind: 'ci', date: new Date(Date.parse('2026-10-09T01:00:00Z') - week * 7 * 86400000 + n * 1000).toISOString() });
  const root = await project(t), f = fixture(items), result = await recover(root, f);
  assert.equal(result.selected.length, 17); assert.equal(result.imported, 17); assert.equal(f.downloads.length, 17);
  assert.equal(result.selected.filter(x => x.kind === 'night')[0].artifactId, 1);
  assert.equal(result.gaps.filter(x => x.code === 'ci-sampled').length, 8); assert.equal(result.complete, false);
  assert.deepEqual(await readTestHistory(root), result);
});
test('history never overwrites existing ledger records and identical recovery is deduplicated', async t => {
  const root = await project(t), f = fixture();
  const first = await recover(root, f); assert.equal(first.imported, 2);
  const again = await recover(root, f); assert.equal(again.imported, 0);
  f.archives[2] = zip([{ name: 'acme-1.json', body: '{"different":true}' }]);
  const conflict = await recover(root, f); assert.ok(conflict.gaps.some(g => g.code === 'record-conflict'));
  assert.equal(JSON.parse(await readFile(join(root, '.keel/test-runs/acme-1.json'))).acme, 1);
});
test('history rejects traversal, links, duplicate/local paths, corrupt archives and byte bombs before any record write', async t => {
  const hostile = [
    [{ name: '../escape.json' }], [{ name: '/escape.json' }], [{ name: 'dir/escape.json' }], [{ name: 'acme.json', mode: 0o120777 }],
    [{ name: 'acme.json' }, { name: 'acme.json' }], [{ name: 'acme.json', claimed: 256 * 1024 * 1024 + 1 }],
  ];
  for (const files of hostile) await t.test(files.map(f => f.name).join(','), async t => {
    const root = await project(t), f = fixture([{ id: 1, kind: 'night' }]); f.archives[1] = zip([{ name: 'first.json' }, ...files]);
    const result = await recover(root, f); assert.equal(result.imported, 0); assert.ok(result.gaps.some(g => g.code === 'archive-rejected'));
    assert.deepEqual((await readdir(join(root, '.keel/test-runs'))).filter(n => n.endsWith('.json')), []);
  });
  for (const mutation of ['local', 'crc', 'truncated']) await t.test(mutation, async t => {
    const root = await project(t), f = fixture([{ id: 1, kind: 'night' }]);
    if (mutation === 'local') f.archives[1][30] = 120;
    if (mutation === 'crc') f.archives[1][40] ^= 255;
    if (mutation === 'truncated') f.archives[1] = f.archives[1].subarray(0, -1);
    assert.equal((await recover(root, f)).imported, 0);
  });
});
test('history validates repository, default branch, workflow, run and artifact bindings before download', async t => {
  const changes = [
    f => { f.routes['repos/acme/app'].default_branch = 'other'; },
    f => { f.routes['repos/acme/app/actions/workflows/keel-night.yml'].path = '.github/workflows/other.yml'; },
    f => { f.routes['repos/acme/app/actions/runs/101'].head_repository.id = 8; },
    f => { f.routes['repos/acme/app/actions/runs/101'].event = 'pull_request_target'; },
    f => { f.routes['repos/acme/app/actions/runs/101'].head_sha = 'b'.repeat(40); },
    f => { f.routes['repos/acme/app/actions/runs/101'].path = '.github/workflows/other.yml'; },
    f => { f.artifacts[0].workflow_run.repository_id = 8; },
    f => { f.artifacts[0].expired = true; },
    f => { f.artifacts[0].created_at = '2026-10-11T00:00:00Z'; },
  ];
  for (const [i, change] of changes.entries()) await t.test(String(i), async t => {
    const root = await project(t), f = fixture([{ id: 1, kind: 'night' }]); change(f);
    const result = await recover(root, f); assert.equal(result.imported, 0); assert.equal(f.downloads.length, 0); assert.equal(result.complete, false);
  });
});
test('history caps discovery at 500 and reports gaps rather than hiding older artifacts', async t => {
  const root = await project(t), f = fixture(Array.from({ length: 501 }, (_, i) => ({ id: i + 1, kind: 'ci' })));
  const result = await recover(root, f);
  assert.ok(result.gaps.some(g => g.code === 'discovery-limit')); assert.equal(f.calls.filter(p => p.includes('?name=')).length, 5);
  assert.equal(result.selected.length, 2);
});
test('history enforces aggregate uncompressed bytes and record bounds, and inherits cumulative gaps', async t => {
  const root = await project(t), f = fixture();
  f.archives[1] = zip([{ name: 'acme.json', body: '{}' }, { name: 'recovery/status.json', body: JSON.stringify({ version: 1, repo, branch, complete: false, gaps: [{ code: 'old-loss' }] }) }]);
  const result = await recover(root, f, { limits: { bytes: 150, records: 1 } });
  assert.equal(result.imported, 1); assert.ok(result.bytes <= 150);
  assert.ok(result.gaps.some(g => g.code === 'inherited-gap')); assert.ok(result.gaps.some(g => g.code === 'archive-rejected'));
});
test('history refuses symlinked ledger destinations and preserves outside content', async t => {
  const root = await project(t), outside = await project(t), f = fixture();
  await symlink(outside, join(root, '.keel/test-runs'));
  await assert.rejects(recover(root, f), /unsafe ledger/);
  assert.deepEqual(await readdir(outside), ['.keel']);
});
test('history inherits only relevant gaps without renewing their original observation or week', async t => {
  const root = await project(t), f = fixture([{ id: 1, kind: 'night' }]);
  const prior = { version: 1, repo, branch, at: '2026-10-09T00:00:00Z', complete: false, gaps: [
    { code: 'expired-week', week: '2026-08-10', observedAt: '2026-10-08T00:00:00Z' },
    { code: 'old-unknown', observedAt: '2026-08-01T00:00:00Z' },
    { code: 'download-failed', observedAt: '2026-09-20T00:00:00Z', detail: 'Acme missing history', sourceArtifactId: 90 },
    { code: 'ci-week-missing', week: '2026-09-21', observedAt: '2026-09-23T00:00:00Z' },
  ] };
  const archive = status => zip([{ name: 'acme.json' }, { name: 'recovery/status.json', body: JSON.stringify(status) }]);
  f.archives[1] = archive(prior);
  const first = await recover(root, f), inherited = first.gaps.filter(g => g.code === 'inherited-gap');
  assert.equal(inherited.length, 2);
  assert.equal(inherited[0].observedAt, '2026-09-20T00:00:00Z'); assert.equal(inherited[0].sourceArtifactId, 90);
  f.archives[1] = archive({ ...first, gaps: inherited });
  const second = await recover(root, f);
  assert.deepEqual(second.gaps.filter(g => g.code === 'inherited-gap'), inherited);
  f.archives[1] = archive({ ...first, gaps: inherited });
  // Advance the artifact itself: copying history into a new artifact does not
  // refresh the age of a gap carried inside it.
  f.artifacts[0].created_at = '2026-12-09T00:00:00Z';
  f.routes['repos/acme/app/actions/runs/101'].updated_at = f.artifacts[0].created_at;
  const later = await recover(root, f, { at: '2026-12-10T00:00:00Z' });
  assert.equal(later.gaps.filter(g => g.code.startsWith('inherited')).length, 0);
});
test('history refuses existing symlinked records and status destinations', async t => {
  const root = await project(t), f = fixture(); await mkdir(join(root, '.keel/test-runs/recovery'), { recursive: true });
  const sentinel = join(root, 'sentinel'); await writeFile(sentinel, 'Acme safe');
  await symlink(sentinel, join(root, '.keel/test-runs/acme-1.json'));
  assert.ok((await recover(root, f)).gaps.some(g => g.code === 'archive-rejected'));
  await rm(join(root, '.keel/test-runs/recovery/status.json'));
  await symlink(sentinel, join(root, '.keel/test-runs/recovery/status.json'));
  await assert.rejects(recover(root, f)); assert.equal(await readFile(sentinel, 'utf8'), 'Acme safe');
});
test('history absent diagnostics are explicitly unavailable', async t => {
  assert.equal((await readTestHistory(await project(t))).complete, false);
});
test('issue #91: history recovers from the project\'s own gate workflow (pages.yml, no check.yml), found as improve finds it', async t => {
  // An Acme project that gates in pages.yml: no check.yml, no gateWorkflow named; pages.yml runs the check.
  const pages = f => {
    delete f.routes['repos/acme/app/actions/workflows/check.yml'];
    f.routes['repos/acme/app/actions/workflows/pages.yml'] = { id: 11, path: '.github/workflows/pages.yml' };
    for (const [path, value] of Object.entries(f.routes)) if (path.startsWith('repos/acme/app/actions/runs/') && value.workflow_id === 11) value.path = '.github/workflows/pages.yml';
    return f;
  };
  const root = await project(t);
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ repo, check: 'npm run check:all' }));
  await mkdir(join(root, '.github/workflows'), { recursive: true });
  await writeFile(join(root, '.github/workflows/pages.yml'), 'name: Acme pages\non: push\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npm run check:all\n');
  await writeFile(join(root, '.github/workflows/deploy.yml'), 'name: Acme deploy\non: push\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo Acme\n');
  const f = pages(fixture());
  const result = await recover(root, f);
  assert.ok(!f.calls.includes('repos/acme/app/actions/workflows/check.yml'), 'never asks for a check.yml the project does not have');
  assert.deepEqual(result.gaps.filter(g => g.code === 'workflow-unavailable' || g.code === 'artifact-rejected'), [], JSON.stringify(result.gaps));
  assert.deepEqual(result.selected.map(s => s.kind).sort(), ['ci', 'night']);
  assert.equal(result.imported, 2, 'pages.yml\'s artifact is accepted as the gate\'s');
  // The gate named as GitHub shows it (not a file) is found by that name, among the repository's workflows.
  const named = await project(t), g = pages(fixture());
  await writeFile(join(named, '.keel/keel.json'), JSON.stringify({ repo, gateWorkflow: 'Acme pages' }));
  g.routes['repos/acme/app/actions/workflows?per_page=100'] = { total_count: 3, workflows: [{ id: 10, name: 'keel night', path: '.github/workflows/keel-night.yml' }, { id: 11, name: 'Acme pages', path: '.github/workflows/pages.yml' }, { id: 12, name: 'Acme deploy', path: '.github/workflows/deploy.yml' }] };
  const byName = await recover(named, g);
  assert.equal(byName.imported, 2, JSON.stringify(byName.gaps));
  // Nothing runs the gate: said as a gap, never a guess at check.yml.
  const none = await project(t), n = pages(fixture());
  await writeFile(join(none, '.keel/keel.json'), JSON.stringify({ repo }));
  const missing = await recover(none, n);
  assert.ok(missing.gaps.some(gap => gap.code === 'workflow-unavailable' && /no workflow .* runs the gate/.test(gap.detail)), JSON.stringify(missing.gaps));
  assert.ok(!n.calls.includes('repos/acme/app/actions/workflows/check.yml'));
});
const receipt = () => stallsEvidence({ identity: { commit: head, dirty: false }, plain: { tests: [{ file: 'tests/acme.test.mjs', name: 'Acme timing', outcome: 'pass' }], exitCode: 0 }, stalled: { tests: [{ file: 'tests/acme.test.mjs', name: 'Acme timing', outcome: 'fail' }], exitCode: 1, seed: 42, stalls: [1], paused: 10 }, pinned: false, startedAt: '2026-10-09T00:00:00Z', completedAt: '2026-10-09T00:01:00Z', configHash: 'acme-config', flagsHash: 'acme-flags' })[0];
const wrapper = r => ({ kind: 'stalls', version: 1, date: r.completedAt, completed: true, tests: [], stallsReceipts: [r], dir: r.identity.scope, config: r.identity.configHash, flagsHash: r.identity.flagsHash, commit: r.revision });
test('history round-trips producer stalls wrappers and inconclusive records through actual ledger readers', async t => {
  const root = await project(t), f = fixture([{ id: 1, kind: 'night' }]), r = receipt();
  const inconclusive = { date: r.completedAt, tests: [{ file: 'tests/acme.test.mjs', name: 'Acme timing', outcome: 'inconclusive', ms: 20, inconclusive: 'Acme bounded sample' }] };
  const retention = { version: 1, sampled: true, retained: 2, considered: 3, omitted: 1, pressureLosses: 0, laneLosses: 0, bytes: 1000, at: r.completedAt };
  f.archives[1] = zip([{ name: 'acme-stalls.json', body: JSON.stringify(wrapper(r)) }, { name: 'acme-inconclusive.json', body: JSON.stringify(inconclusive) }, { name: 'retention', body: JSON.stringify(retention) }]);
  const result = await recover(root, f);
  assert.equal(result.imported, 2); assert.ok(result.gaps.some(g => g.code === 'retention-loss'));
  assert.deepEqual((await readStalls(root)).receipts, [r]);
  const runs = await readRuns(root); assert.equal(runs.runs.length, 1); assert.equal(runs.runs[0].tests[0].outcome, 'inconclusive');
  assert.deepEqual(JSON.parse(await readFile(join(root, '.keel/test-runs/retention'))), retention);
});
test('history omits malformed or oversized stalls wrappers with gaps while retaining valid ledger data', async t => {
  const changes = [v => { v.version = 2; }, v => { v.stallsReceipts[0].seed = -1; }, v => { v.stallsReceipts = Array(2001).fill(receipt()); }, v => { v.stallsReceipts = Array(1900).fill({ ...receipt(), identity: { ...receipt().identity, target: { file: 'tests/acme.test.mjs', name: 'x'.repeat(1000) } } }); }, v => { v.stallsReceipts[0].transcript = 'Acme private'; }, v => { v.transcript = 'Acme private'; }];
  for (const [i, change] of changes.entries()) await t.test(String(i), async t => {
    const root = await project(t), f = fixture([{ id: 1, kind: 'night' }]), value = wrapper(receipt()); change(value);
    f.archives[1] = zip([{ name: 'acme-bad.json', body: JSON.stringify(value) }, { name: 'acme-good.json' }]);
    const result = await recover(root, f); assert.equal(result.imported, 1); assert.ok(result.gaps.some(g => g.code === 'stalls-rejected'));
    assert.deepEqual((await readStalls(root)).receipts, []);
  });
});
test('history excludes local workaround evidence and upload selects only final ledger telemetry paths', async t => {
  const root = await project(t), f = fixture([{ id: 1, kind: 'night' }]);
  f.archives[1] = zip([{ name: 'local.json', body: JSON.stringify({ kind: 'local-workaround', transcript: 'Acme private' }) }]);
  const result = await recover(root, f); assert.equal(result.imported, 0); assert.ok(result.gaps.some(g => g.code === 'local-evidence-rejected'));
  const keep = (await readFile(workflow, 'utf8')).split('- name: Keep the test ledger')[1].split('\n      # Porcelain')[0];
  assert.match(keep, /\.keel\/test-runs\/\*\.json/); assert.match(keep, /\.keel\/test-runs\/retention/);
  assert.doesNotMatch(keep, /stalls\/|transcripts\/|path: \.keel\/test-runs\//);
});
test('history status never truncates a hardlinked outside file and repo aliases are supported', async t => {
  const root = await project(t), f = fixture(), aliasRoot = await project(t);
  await symlink(root, join(aliasRoot, 'alias'));
  assert.equal((await recover(join(aliasRoot, 'alias'), f)).imported, 2);
  const sentinel = join(root, 'sentinel'); await writeFile(sentinel, 'Acme safe');
  await rm(join(root, '.keel/test-runs/recovery/status.json'));
  await link(sentinel, join(root, '.keel/test-runs/recovery/status.json'));
  await assert.rejects(recover(root, f), /unsafe recovery status/);
  assert.equal(await readFile(sentinel, 'utf8'), 'Acme safe');
});
test('history byte preflight covers the whole archive before writing and corrupt late JSON cannot partially import', async t => {
  for (const kind of ['aggregate bytes', 'late JSON']) await t.test(kind, async t => {
    const root = await project(t), f = fixture([{ id: 1, kind: 'night' }]);
    f.archives[1] = zip([{ name: 'first.json', body: '{}' }, { name: 'second.json', body: kind === 'late JSON' ? 'invalid' : '{"second":true}' }]);
    const result = await recover(root, f, { limits: { bytes: kind === 'aggregate bytes' ? 4 : 1024 } });
    assert.equal(result.imported, 0); assert.ok(result.gaps.some(g => g.code === 'archive-rejected'));
  });
});
test('night extracted Gather shell recovers real system ZIP via synthetic gh endpoints only', async t => {
  const root = await project(t), f = fixture([{ id: 1, kind: 'night', date: new Date(Date.now() - 3600000).toISOString() }]);
  const inputs = join(root, 'inputs'); await mkdir(inputs); await writeFile(join(inputs, 'acme.json'), '{"acme":"real zip"}');
  const zipped = join(root, 'history.zip'); const z = run('zip', ['-q', zipped, 'acme.json'], { cwd: inputs }); assert.equal(z.status, 0, z.stderr);
  await mkdir(join(root, 'scripts/keel'), { recursive: true }); await writeFile(join(root, 'scripts/keel/test-history.mjs'), await readFile(source));
  await writeFile(join(root, 'scripts/keel/time-receipts.mjs'), await readFile(resolve('practices/night/files/scripts/keel/time-receipts.mjs')));
  await writeFile(join(root, 'scripts/keel/lib.mjs'), await readFile(resolve('practices/night/files/scripts/keel/lib.mjs')));
  const gh = join(root, 'gh'); await writeFile(gh, `#!${process.execPath}\nconst fs=require('node:fs');const routes=${JSON.stringify(f.routes)};const p=process.argv[3];if(p==='repos/acme/app/actions/artifacts/1/zip')process.stdout.write(fs.readFileSync(${JSON.stringify(zipped)}));else if(routes[p])console.log(JSON.stringify(routes[p]));else process.exit(1);\n`); await chmod(gh, 0o755);
  const script = runBlocks(await readFile(workflow, 'utf8')).find(b => b.step === 'Gather the test ledger').script;
  assert.doesNotMatch(script, /unzip|gh api/);
  const result = run('bash', ['-e', '-o', 'pipefail', '-c', script], { cwd: root, env: { ...process.env, KEEL_GH: gh, REPO: repo, BASE: branch } });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(JSON.parse(result.stdout).imported, 1);
  assert.equal(JSON.parse(await readFile(join(root, '.keel/test-runs/acme.json'))).acme, 'real zip');
});

async function stagingFixture(t, production = false) {
  const root = await project(t), remote = await project(t), health = 'docs/Acme-health', day = '2026-10-10';
  const git = (...args) => { const r = run('git', args, { cwd: root }); assert.equal(r.status, 0, r.stdout + r.stderr); return r.stdout.trim(); };
  assert.equal(run('git', ['init', '--bare', '-q', remote]).status, 0);
  git('init', '-q', '-b', 'main'); git('remote', 'add', 'origin', remote);
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ health, name: 'Acme', repo: 'acme/app' }));
  await mkdir(join(root, health), { recursive: true }); await mkdir(join(root, 'scripts/keel'), { recursive: true });
  await writeFile(join(root, 'scripts/keel/lib.mjs'), await readFile(resolve('practices/night/files/scripts/keel/lib.mjs')));
  await writeFile(join(root, 'scripts/keel/pr-body.mjs'), 'console.log("Acme synthetic PR body");\n');
  const earlier = `${health}/2026-10-08.md`, unrelated = `${health}/2026-10-07.md`, today = `${health}/${day}.md`;
  await writeFile(join(root, earlier), 'Acme accepted proposal; awaiting remeasurement.\n');
  await writeFile(join(root, unrelated), 'Acme owner notes.\n');
  const measures = MEASURES.filter(m => m.id === 'time_creep');
  if (production) {
    await mkdir(join(root, '.keel/test-runs'), { recursive: true });
    await writeFile(join(root, '.gitignore'), '.keel/test-runs/\n');
    for (const r of timeEvidence(Date.now()).runs) await writeFile(join(root, '.keel/test-runs', r.id + '.json'), JSON.stringify(r));
    await improve({ root, report: true, date: '2026-10-08' }, { env: { CI: 'true' }, measures });
    const initial = parseTimeProposal(await readFile(join(root, earlier), 'utf8')).proposal;
    assert.ok(initial);
    await withTimeProposal({ root, path: earlier, expectedInstance: initial.instanceId }, ({ proposal, saveLifecycle }) => saveLifecycle({ ...proposal.lifecycle, state: 'accepted', decidedAt: '2026-10-08T12:00:00Z', issue: { repo: 'acme/app', number: 7, url: 'https://github.com/acme/app/issues/7' } }));
  }
  git('add', '.'); git('commit', '-qm', 'Acme initial'); const before = git('rev-parse', 'HEAD');
  let produced;
  if (production) produced = await improve({ root, report: true, date: day }, { env: { CI: 'true' }, measures, remeasure: async () => ({ state: 'unavailable', observedAt: '2026-10-10T12:00:00Z', value: null, coverage: null, delivery: null, reasons: ['Acme awaits observations'] }) });
  else {
    await writeFile(join(root, earlier), 'Acme accepted proposal; remeasured inside.\n');
    await writeFile(join(root, today), 'Acme current report.\n');
  }
  await writeFile(join(root, unrelated), 'Acme unrelated owner edit.\n');
  git('add', '--', unrelated); // Existing index content must not sneak into the night commit.
  await writeFile(join(root, health, 'human-draft.md'), 'Acme untracked human draft.\n');
  const temp = await project(t), commands = join(temp, 'commands'); await mkdir(commands);
  await writeFile(join(commands, 'gh'), '#!/bin/sh\nprintf "3\\n"\n'); await chmod(join(commands, 'gh'), 0o755);
  const report = produced?.data ?? { date: day, report: today, changedHistoricalHealthPaths: [earlier] };
  await writeFile(join(temp, 'improve.json'), JSON.stringify(report)); await writeFile(join(temp, 'pr.json'), '{}');
  const script = runBlocks(await readFile(workflow, 'utf8')).find(b => b.step === "Open the night's pull request").script;
  const execute = () => run('bash', ['-e', '-o', 'pipefail', '-c', script], { cwd: root, env: { ...process.env, DAY: day, BASE: 'main', HEALTH: health, RUNNER_TEMP: temp, PATH: `${commands}:${process.env.PATH}` } });
  return { root, temp, report, git, before, earlier, unrelated, today, execute };
}
test('night historical health staging commits the earlier remeasurement and today only, preserving unrelated staged and untracked files', async t => {
  assert.equal(await readFile(resolve('.github/workflows/keel-night.yml'), 'utf8'), await readFile(workflow, 'utf8'), 'managed night matches source');
  const f = await stagingFixture(t, true);
  assert.deepEqual(f.report.changedHistoricalHealthPaths, [f.earlier]);
  assert.equal(f.report.report, f.today);
  const result = f.execute();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(f.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').sort(), [f.earlier, f.today].sort());
  assert.equal(parseTimeProposal(f.git('show', `HEAD:${f.earlier}`)).proposal.lifecycle.remeasurement.state, 'unavailable');
  assert.equal(f.git('show', `HEAD:${f.unrelated}`), 'Acme owner notes.');
  assert.equal(f.git('diff', '--cached', '--name-only'), f.unrelated);
  assert.match(f.git('status', '--porcelain'), /human-draft\.md/);
  assert.equal(f.git('rev-parse', 'refs/remotes/origin/keel-night/2026-10-10'), f.git('rev-parse', 'HEAD'));
});
test('night historical health staging rejects unvalidated metadata and paths before any staging or commit', async t => {
  const cases = ['missing', 'object', 'outside', 'absolute', 'traversal', 'glob', 'newline', 'duplicate', 'today', 'directory', 'symlink', 'ignored', 'wrong-date', 'wrong-report', 'too-many', 'missing-file'];
  for (const kind of cases) await t.test(kind, async t => {
    const f = await stagingFixture(t);
    if (kind === 'missing') delete f.report.changedHistoricalHealthPaths;
    if (kind === 'object') f.report.changedHistoricalHealthPaths = [{ path: f.earlier }];
    if (kind === 'outside') f.report.changedHistoricalHealthPaths = ['README.md'];
    if (kind === 'absolute') f.report.changedHistoricalHealthPaths = [join(f.root, f.earlier)];
    if (kind === 'traversal') f.report.changedHistoricalHealthPaths = ['docs/Acme-health/../2026-10-08.md'];
    if (kind === 'glob') f.report.changedHistoricalHealthPaths = ['docs/Acme-health/*.md'];
    if (kind === 'newline') f.report.changedHistoricalHealthPaths = [f.earlier + '\nREADME.md'];
    if (kind === 'duplicate') f.report.changedHistoricalHealthPaths.push(f.earlier);
    if (kind === 'today') f.report.changedHistoricalHealthPaths = [f.today];
    if (kind === 'directory') { await rm(join(f.root, f.earlier)); await mkdir(join(f.root, f.earlier)); }
    if (kind === 'symlink') { await rm(join(f.root, f.earlier)); await symlink(join(f.root, f.unrelated), join(f.root, f.earlier)); }
    if (kind === 'ignored') { await writeFile(join(f.root, '.gitignore'), '/docs/Acme-health/2026-10-09.md\n'); await writeFile(join(f.root, 'docs/Acme-health/2026-10-09.md'), 'Acme ignored'); f.report.changedHistoricalHealthPaths = ['docs/Acme-health/2026-10-09.md']; }
    if (kind === 'wrong-date') f.report.date = '2026-10-09';
    if (kind === 'wrong-report') f.report.report = f.earlier;
    if (kind === 'too-many') f.report.changedHistoricalHealthPaths = Array(513).fill(f.earlier);
    if (kind === 'missing-file') f.report.changedHistoricalHealthPaths = ['docs/Acme-health/2026-10-06.md'];
    await writeFile(join(f.temp, 'improve.json'), JSON.stringify(f.report));
    const result = f.execute(); assert.notEqual(result.status, 0, `${kind}: ${result.stdout}${result.stderr}`);
    assert.equal(f.git('rev-parse', 'HEAD'), f.before); assert.equal(f.git('diff', '--cached', '--name-only'), f.unrelated);
  });
});
