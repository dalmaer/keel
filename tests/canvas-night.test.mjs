import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, chmod, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { night } from '../lib/canvas-night.mjs';
import { run } from './helpers/run.mjs';

const binding = { provider: 'isocan', projectKey: 'acme', home: 'https://acme.test', canvasId: 'canvas_acme', actorId: 'actor_acme', audience: 'owner-only', privacy: 'summary', mode: 'immutable', spaceId: null };
const initialManifest = () => ({ schema: 1, projectKey: binding.projectKey, home: binding.home, canvasId: binding.canvasId, items: {}, groups: {}, receipts: [], pending: null });
const template = resolve('practices/night/files/.github/workflows/keel-night.yml');
const report = { date: '2026-10-08', measures: [
  { id: 'gate', value: 0, state: 'ok', detail: 'fake-secret-private-command' },
  { id: 'ci', value: 0, state: 'n/a', detail: 'offline' },
], proposal: 'fake-secret-private-proposal' };
async function fixture(t, canvas = { enabled: true, cadence: 'nightly' }) {
  const root = await mkdtemp(join(tmpdir(), 'acme-canvas-night-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.keel'));
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ name: 'Acme', canvas }));
  return root;
}
function pipeline({ dirty = false, failure = false } = {}) {
  const calls = [];
  return { calls,
    snapshot: async options => {
      calls.push(['snapshot', options]);
      return { schema: 1, project: { key: 'acme', name: 'Acme', repo: null }, revision: { commit: 'a'.repeat(40), dirty },
        generatedAt: '2026-10-08T07:23:00Z', coverage: [{ source: 'github', status: 'unavailable', reason: 'offline' }],
        entities: [], relations: [], observations: [], metrics: [], warnings: [], complete: false };
    },
    render: async options => { calls.push(['render', options]); return { cards: [] }; },
    sync: async options => {
      calls.push(['sync', options]);
      if (failure) throw new Error('fake-secret-expired-auth');
      return { data: { state: 'published', exitCode: 0 }, exitCode: 0 };
    },
  };
}
test('night off and manual make no pipeline calls, even with an unreadable report', async t => {
  for (const config of [undefined, { enabled: false, cadence: 'nightly' }, { enabled: true, cadence: 'manual' }, { enabled: 'true', cadence: 'nightly' }]) {
    const root = await fixture(t, config ?? {}), deps = pipeline();
    const out = await night({ root, report: '/does-not-exist', yes: true, ...deps });
    assert.equal(out.data.skipped, true);
    assert.deepEqual(deps.calls, []);
  }
});
test('one existing report, offline gaps, no remote call without yes; raw details excluded', async t => {
  const root = await fixture(t), deps = pipeline(), output = join(root, 'artifacts');
  const out = await night({ root, report, output, ...deps });
  assert.equal(out.exitCode, 0);
  assert.deepEqual(deps.calls.map(x => x[0]), ['snapshot', 'render']);
  assert.equal(deps.calls[0][1].github, false);
  const bytes = await readFile(join(output, 'snapshot.json'), 'utf8');
  assert.ok(!bytes.includes('fake-secret'));
  const saved = JSON.parse(bytes);
  assert.equal(saved.coverage[0].status, 'unavailable');
  assert.equal(deps.calls[0][1].report.measures[1].value, null);
  assert.equal(out.data.complete, false);
});
test('publishes once, preserving report and using the supplied environment', async t => {
  const root = await fixture(t), deps = pipeline(), before = JSON.stringify(report);
  const env = { KEEL_CANVAS_OUTPUT: join(root, 'artifacts') };
  const out = await night({ root, report, env, yes: true, ...deps });
  assert.equal(out.exitCode, 0);
  assert.deepEqual(deps.calls.map(x => x[0]), ['snapshot', 'render', 'sync']);
  assert.equal(deps.calls[2][1].env, env);
  assert.equal(JSON.stringify(report), before);
  assert.equal(JSON.parse(await readFile(join(env.KEEL_CANVAS_OUTPUT, 'receipt.json'))).state, 'published');
});
test('dirty revision and failed transport retain local output without retry or leaked errors', async t => {
  for (const opts of [{ dirty: true }, { failure: true }]) {
    const root = await fixture(t), deps = pipeline(opts), output = join(root, 'artifacts');
    const out = await night({ root, report, output, yes: true, ...deps });
    assert.equal(out.exitCode, 1);
    assert.ok(await readFile(join(output, 'snapshot.json')));
    assert.ok(!JSON.stringify(out).includes('fake-secret'));
    assert.equal(deps.calls.filter(c => c[0] === 'sync').length, opts.dirty ? 0 : 1);
  }
});
test('missing or invalid report fails instead of rerunning measurements', async t => {
  const root = await fixture(t), deps = pipeline();
  const out = await night({ root, report: {}, ...deps });
  assert.equal(out.exitCode, 2);
  assert.deepEqual(deps.calls, []);
});

function shell(yaml) {
  const block = yaml.split('      - name: Project the night onto its canvas\n')[1].split('\n      - name:')[0];
  return block.split('        run: |\n')[1].split('\n').map(l => l.startsWith('          ') ? l.slice(10) : l).join('\n');
}
async function workflow(t, { enabled = true, creds = true, missing = false, mismatch = false, fail = false, runs = [], artifacts = [], bundle, local = true, disabledShas = [], attempt = 1, priorAttempt, event = 'schedule', neverRan = {} } = {}) {
  const root = await fixture(t, { ...binding, enabled, cadence: 'nightly' });
  if (local) { await mkdir(join(root, '.keel/canvas')); await writeFile(join(root, '.keel/canvas/manifest.json'), JSON.stringify(initialManifest())); }
  const bin = join(root, 'bin'); await mkdir(bin);
  const log = join(root, 'calls.jsonl');
  for (const tool of ['keel', 'isocan']) {
    if (missing && tool === 'isocan') continue;
    const file = join(bin, tool);
    await writeFile(file, `#!${process.execPath}\nconst fs=require('node:fs'); const a=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)},JSON.stringify([${JSON.stringify(tool)},...a])+'\\n'); if(a[0]==='--version') console.log('acme-pinned'); else {if(a[0]!=='canvas'||a[1]!=='night') process.exit(90); const r=JSON.parse(fs.readFileSync(a[a.indexOf('--report')+1])); if(r.date!=='2026-10-08') process.exit(91); process.exit(${fail ? 1 : 0});}`);
    await chmod(file, 0o755);
  }
  const ghlog = join(root, 'gh.jsonl');
  const gh = join(bin, 'gh');
  await writeFile(gh, `#!${process.execPath}
const fs=require('node:fs'), path=require('node:path'), a=process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(ghlog)}, JSON.stringify(a)+'\\n');
if(a[0]==='api') {
 let out;
 if(a[1].includes('/workflows/')) out={workflow_runs:${JSON.stringify(runs)}};
 else if(a[1].includes('/contents/')) { const enabled=!${JSON.stringify(disabledShas)}.includes(a[1].split('ref=')[1]); const c=JSON.stringify({canvas:{enabled,cadence:'nightly'}}); out={encoding:'base64',content:Buffer.from(c).toString('base64'),size:c.length}; }
 else if(a[1].includes('/attempts/')) out=${JSON.stringify(priorAttempt ?? null)};
 else if(a[1].includes('/artifacts')) out={artifacts:${JSON.stringify(artifacts)}};
 else process.exit(92);
 console.log(JSON.stringify(out));
} else if(a[0]==='run'&&a[1]==='download') {
 const never=${JSON.stringify(neverRan)}[a[2]+'-'+a[a.indexOf('--name')+1].split('-').pop()];
 if(never) fs.writeFileSync(path.join(a[a.indexOf('--dir')+1],'never-ran.json'),JSON.stringify({neverRan:true,provenance:never}));
 else fs.writeFileSync(path.join(a[a.indexOf('--dir')+1],'recovery.json'),JSON.stringify(${JSON.stringify(bundle ?? {})}));
} else process.exit(93);
`); await chmod(gh, 0o755);
  // Isolate PATH completely, so a developer's isocan can never satisfy the test.
  const node = join(bin, 'node');
  await writeFile(node, `#!/bin/sh\nexec '${process.execPath}' "$@"\n`); await chmod(node, 0o755);
  await writeFile(join(root, 'improve.json'), JSON.stringify(report));
  const home = join(root, 'identity'); await mkdir(home);
  const env = { ...process.env, PATH: bin, RUNNER_TEMP: root, GITHUB_OUTPUT: join(root, 'outputs'),
    REPO: 'Acme/app', BASE: 'main', GITHUB_REPOSITORY: 'Acme/app', GITHUB_REF_NAME: 'main', GITHUB_RUN_ID: '200', GITHUB_RUN_ATTEMPT: String(attempt), GITHUB_EVENT_NAME: event, GITHUB_SHA: 'b'.repeat(40),
    KEEL_CANVAS_KEEL_VERSION: mismatch ? 'wrong-pin' : 'acme-pinned', KEEL_CANVAS_ISOCAN_VERSION: 'acme-pinned', KEEL_CANVAS_ISOCAN_HOME: creds ? home : '' };
  const yaml = await readFile(template, 'utf8');
  const out = run('/bin/bash', ['-e', '-o', 'pipefail', '-c', shell(yaml)], { cwd: root, env });
  let calls = []; try { calls = (await readFile(log, 'utf8')).trim().split('\n').map(JSON.parse); } catch {}
  let ghCalls = []; try { ghCalls = (await readFile(ghlog, 'utf8')).trim().split('\n').map(JSON.parse); } catch {}
  return { ...out, calls, ghCalls, yaml, root };
}
test('actual workflow shell: off has no CLI calls; on consumes report exactly once', async t => {
  const off = await workflow(t, { enabled: false }); assert.equal(off.status, 0); assert.deepEqual(off.calls, []);
  const on = await workflow(t); assert.equal(on.status, 0, on.stderr);
  assert.deepEqual(on.calls.map(a => a.slice(0, 3)), [['keel', '--version'], ['isocan', '--version'], ['keel', 'canvas', 'night']]);
  assert.ok(on.calls[2].includes('--yes'));
  assert.ok(on.yaml.indexOf("- name: Open the night's pull request") < on.yaml.indexOf('- name: Project the night'));
  assert.match(on.yaml, /CANVAS_OUTCOME.*steps.canvas.outcome/);
  assert.match(on.yaml, /retention-days: 90/);
  assert.equal(on.yaml, await readFile(resolve('.github/workflows/keel-night.yml'), 'utf8'));
});
test('actual workflow shell fails visibly for missing tools, pins, credentials and sync failure', async t => {
  for (const options of [{ missing: true }, { mismatch: true }, { creds: false }, { fail: true }]) {
    const out = await workflow(t, options);
    assert.notEqual(out.status, 0, JSON.stringify(options));
    if (!options.fail) { assert.match(out.stdout, /::error::/); assert.ok(!out.calls.some(c => c[1] === 'canvas')); }
  }
});

test('real collector: original measured report publishes after data commit, arbitrary dirty files still refuse', async t => {
  const root = await fixture(t), artifacts = await realpath(await mkdtemp(join(tmpdir(), 'acme-canvas-output-')));
  t.after(() => rm(artifacts, { recursive: true, force: true }));
  const git = (...args) => { const r = run('git', args, { cwd: root }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git('init', '-q'); git('add', '.keel/keel.json'); git('-c', 'user.name=Acme', '-c', 'user.email=acme@example.invalid', 'commit', '-qm', 'Acme baseline');
  await mkdir(join(root, 'docs/health'), { recursive: true });
  await writeFile(join(root, 'docs/health/2026-10-08.md'), '# Health — 2026-10-08\n');
  await writeFile(join(root, '.keel/bounds.json'), '{}\n');
  let writes = 0, failure;
  const deps = {
    snapshot: async options => { try { return await (await import('../lib/canvas-snapshot.mjs')).snapshot(options); } catch (e) { failure = e.stack; throw e; } },
    render: async options => { try { return await (await import('../lib/canvas-render.mjs')).render(options); } catch (e) { failure = e.stack; throw e; } },
    sync: async () => { writes++; return { data: { state: 'published' }, exitCode: 0 }; } };
  const dirty = await night({ root, report, output: join(artifacts, 'before'), yes: true, ...deps });
  assert.equal(dirty.exitCode, 1, JSON.stringify(dirty)); assert.equal(writes, 0);
  git('add', 'docs/health/2026-10-08.md', '.keel/bounds.json');
  git('-c', 'user.name=Acme', '-c', 'user.email=acme@example.invalid', 'commit', '-qm', 'Acme measured data');
  const clean = await night({ root, report, output: join(artifacts, 'after'), yes: true, ...deps });
  assert.equal(clean.exitCode, 0, failure ?? JSON.stringify(clean)); assert.equal(writes, 1);
  const saved = JSON.parse(await readFile(join(artifacts, 'after/snapshot.json')));
  assert.equal(saved.revision.dirty, false);
  assert.ok(saved.entities.some(e => e.kind === 'health' && e.measures.some(m => m.id === 'gate')));
  await writeFile(join(root, 'unrelated.txt'), 'Acme unfinished work');
  const unrelated = await night({ root, report, output: join(artifacts, 'unrelated'), yes: true, ...deps });
  assert.equal(unrelated.exitCode, 1, JSON.stringify(unrelated)); assert.equal(writes, 1);
});

test('actual verdict shell makes a continued canvas failure visible after healthy measurements', async () => {
  const yaml = await readFile(template, 'utf8');
  const verdict = yaml.split('      - name: Verdict\n')[1].split('        run: |\n')[1]
    .split('\n').map(l => l.startsWith('          ') ? l.slice(10) : l).join('\n');
  const out = run('/bin/bash', ['-e', '-c', verdict], { env: { ...process.env, CANVAS_OUTCOME: 'failure', CODE: '0', GATE: 'ok' } });
  assert.equal(out.status, 1);
  assert.match(out.stdout, /::error::Canvas projection failed/);
});

const trustedRun = (extra = {}) => ({ id: 100, run_attempt: 1, head_sha: 'a'.repeat(40), head_repository: { full_name: 'Acme/app' }, repository: { full_name: 'Acme/app' }, head_branch: 'main', path: '.github/workflows/keel-night.yml', event: 'schedule', pull_requests: [], status: 'completed', conclusion: 'success', ...extra });
const artifactFor = r => ({ name: `keel-canvas-night-${r.run_attempt}`, expired: false, size_in_bytes: 500, workflow_run: { id: r.id, head_sha: r.head_sha } });
const provenanceFor = r => ({ repo: 'Acme/app', workflow: r.path, runId: String(r.id), attempt: r.run_attempt, headSha: r.head_sha });

test('workflow recovery selects the latest trusted enabled attempt, including failure, never a PR artifact', async t => {
  const latest = trustedRun({ id: 150, conclusion: 'failure', run_attempt: 2 });
  const runs = [trustedRun({ id: 190, event: 'pull_request', pull_requests: [{}] }), trustedRun({ id: 180, head_repository: { full_name: 'Other/app' } }), latest, trustedRun()];
  const out = await workflow(t, { runs, local: false, artifacts: [artifactFor(latest)], bundle: { provenance: provenanceFor(latest) } });
  assert.equal(out.status, 0, out.stderr);
  const downloads = out.ghCalls.filter(a => a[0] === 'run');
  assert.equal(downloads.length, 1);
  assert.deepEqual(downloads[0].slice(0, 3), ['run', 'download', '150']);
  assert.equal(downloads[0][downloads[0].indexOf('--name') + 1], 'keel-canvas-night-2');
  assert.ok(!out.ghCalls.some(a => a[1]?.includes('/runs/100/artifacts')));
});
test('workflow refuses missing latest artifact, mismatched provenance, live attempt and PR execution', async t => {
  const latest = trustedRun({ id: 150, conclusion: 'cancelled' });
  for (const options of [
    { runs: [latest, trustedRun()], artifacts: [artifactFor(trustedRun())] },
    { runs: [latest], artifacts: [artifactFor(latest)], bundle: { provenance: provenanceFor(trustedRun()) } },
    { runs: [trustedRun({ status: 'in_progress' })] },
    { event: 'pull_request' },
    { local: false },
  ]) {
    const out = await workflow(t, options);
    assert.notEqual(out.status, 0, JSON.stringify(options));
    assert.ok(!out.calls.some(a => a[1] === 'canvas'));
  }
});
test('workflow skips a committed disabled night and restores the previous attempt on a rerun', async t => {
  const disabled = trustedRun({ id: 150, head_sha: 'd'.repeat(40) }), previous = trustedRun();
  const off = await workflow(t, { runs: [disabled, previous], disabledShas: [disabled.head_sha], artifacts: [artifactFor(previous)], bundle: { provenance: provenanceFor(previous) } });
  assert.equal(off.status, 0, off.stderr);
  assert.equal(off.ghCalls.find(a => a[0] === 'run')[2], '100');
  const first = trustedRun({ id: 200, conclusion: 'failure' });
  const rerun = await workflow(t, { runs: [trustedRun({ id: 200, run_attempt: 2, status: 'in_progress' })], attempt: 2, priorAttempt: first, artifacts: [artifactFor(first)], bundle: { provenance: provenanceFor(first) } });
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.ok(rerun.ghCalls.some(a => a[1]?.endsWith('/attempts/1')));
});

test('a night queued behind this one is never the one recovered from (duo#90)', async t => {
  const queued = trustedRun({ id: 250, status: 'queued', conclusion: null }), previous = trustedRun();
  const out = await workflow(t, { runs: [queued, previous], artifacts: [artifactFor(previous)], bundle: { provenance: provenanceFor(previous) } });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.ghCalls.find(a => a[0] === 'run')[2], '100');
  assert.ok(!out.ghCalls.some(a => a[1]?.includes('ref=' + queued.head_sha) && a[1]?.includes('/runs/250')));
});
test('a preflight failure leaves a never-ran receipt, and the next night recovers from the attempt before it (duo#90)', async t => {
  const failed = await workflow(t, { creds: false });
  assert.notEqual(failed.status, 0);
  const receipt = JSON.parse(await readFile(join(failed.root, 'keel-canvas-night/never-ran.json'), 'utf8'));
  assert.deepEqual(receipt, { neverRan: true, provenance: { repo: 'Acme/app', workflow: '.github/workflows/keel-night.yml', runId: '200', attempt: 1, headSha: 'b'.repeat(40) } });
  const broken = trustedRun({ id: 150, conclusion: 'failure', head_sha: 'c'.repeat(40) }), previous = trustedRun();
  const out = await workflow(t, { runs: [broken, previous], artifacts: [artifactFor(broken), artifactFor(previous)], neverRan: { '150-1': provenanceFor(broken) }, bundle: { provenance: provenanceFor(previous) } });
  assert.equal(out.status, 0, out.stderr);
  assert.deepEqual(out.ghCalls.filter(a => a[0] === 'run').map(a => a[2]), ['150', '100']);
  assert.ok(out.calls.some(a => a[1] === 'canvas'));
  // A never-ran receipt for another attempt is refused, never skipped.
  const forged = await workflow(t, { runs: [broken, previous], artifacts: [artifactFor(broken), artifactFor(previous)], neverRan: { '150-1': provenanceFor(previous) }, bundle: { provenance: provenanceFor(previous) } });
  assert.notEqual(forged.status, 0);
  assert.ok(!forged.calls.some(a => a[1] === 'canvas'));
});
test('a rerun asks for its own earlier attempt only, never a newer run\'s (duo#91, cajones#63)', async t => {
  const queued = trustedRun({ id: 250, status: 'queued', conclusion: null });
  const first = trustedRun({ id: 200, conclusion: 'failure' });
  const out = await workflow(t, { runs: [queued, trustedRun({ id: 200, run_attempt: 2, status: 'in_progress' })], attempt: 2, priorAttempt: first, artifacts: [artifactFor(first)], bundle: { provenance: provenanceFor(first) } });
  assert.equal(out.status, 0, out.stderr);
  assert.ok(!out.ghCalls.some(a => a[1]?.includes('/runs/250/')), 'the queued run is never read');
  assert.equal(out.ghCalls.find(a => a[0] === 'run')[2], '200');
});
test('a rerun whose preflight failed falls back to that run\'s earlier attempt before any older run (cajones#63)', async t => {
  const rerun = trustedRun({ id: 150, run_attempt: 2, conclusion: 'failure' }), first = trustedRun({ id: 150, run_attempt: 1 }), older = trustedRun();
  const out = await workflow(t, { runs: [rerun, older], priorAttempt: first, artifacts: [artifactFor(rerun), artifactFor(first), artifactFor(older)], neverRan: { '150-2': provenanceFor(rerun) }, bundle: { provenance: provenanceFor(first) } });
  assert.equal(out.status, 0, out.stderr);
  assert.ok(out.ghCalls.some(a => a[1]?.endsWith('/runs/150/attempts/1')));
  assert.deepEqual(out.ghCalls.filter(a => a[0] === 'run').map(a => [a[2], a[a.indexOf('--name') + 1]]), [['150', 'keel-canvas-night-2'], ['150', 'keel-canvas-night-1']]);
});
test('recovery follows when each attempt ran, not run ids: an old night rerun later is the newest state (duo#92)', async t => {
  // This run (200) is an old night rerun after night 250 ran: 250 is the state to recover.
  const later = trustedRun({ id: 250, run_started_at: '2026-10-08T03:00:00Z' }), first = trustedRun({ id: 200, run_started_at: '2026-10-01T03:00:00Z' });
  const rerun = await workflow(t, { runs: [later, trustedRun({ id: 200, run_attempt: 2, status: 'in_progress' })], attempt: 2, priorAttempt: first, artifacts: [artifactFor(later), artifactFor(first)], bundle: { provenance: provenanceFor(later) } });
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.equal(rerun.ghCalls.find(a => a[0] === 'run')[2], '250');
  // The next night: the rerun (attempt 2 of 150, ran 10-09) is newer than night 180 (ran 10-08), whatever their ids.
  const old = trustedRun({ id: 150, run_attempt: 2, run_started_at: '2026-10-09T03:00:00Z' }), mid = trustedRun({ id: 180, run_started_at: '2026-10-08T03:00:00Z' });
  const next = await workflow(t, { runs: [mid, old], artifacts: [artifactFor(old), artifactFor(mid)], bundle: { provenance: provenanceFor(old) } });
  assert.equal(next.status, 0, next.stderr);
  assert.equal(next.ghCalls.find(a => a[0] === 'run')[2], '150');
});
test('a recovery that stops before the canvas leaves a never-ran receipt too (cajones#64)', async t => {
  const out = await workflow(t, { runs: [trustedRun({ id: 150, conclusion: 'cancelled' })], artifacts: [] });
  assert.notEqual(out.status, 0);
  assert.ok(!out.calls.some(a => a[1] === 'canvas'));
  const receipt = JSON.parse(await readFile(join(out.root, 'keel-canvas-night/never-ran.json'), 'utf8'));
  assert.equal(receipt.provenance.runId, '200');
});
async function recoveryFixture(t, { seed = true, manifest = initialManifest() } = {}) {
  const root = await realpath(await fixture(t, { ...binding, enabled: true, cadence: 'nightly' }));
  const output = await realpath(await mkdtemp(join(tmpdir(), 'acme-night-state-')));
  t.after(() => rm(output, { recursive: true, force: true }));
  if (seed) {
    await mkdir(join(root, '.keel/canvas'));
    await writeFile(join(root, '.keel/canvas/manifest.json'), JSON.stringify(manifest));
    await writeFile(join(root, '.keel/canvas/credentials.json'), '{"token":"fake-secret-not-for-artifacts"}');
  }
  return { root, output, env: { KEEL_CANVAS_PERSISTENCE: 'artifact-v1' } };
}
const syntheticSnapshot = at => ({ schema: 1, project: { key: 'acme', name: 'Acme', repo: null }, revision: { commit: 'a'.repeat(40), dirty: false }, generatedAt: at, coverage: [{ source: 'github', status: 'disabled', reason: 'offline', observedAt: at }], entities: [], relations: [], observations: [], metrics: [], warnings: [], complete: false });
const localPipeline = { snapshot: async ({ now }) => syntheticSnapshot(new Date(now).toISOString()), render: async () => ({ cards: [] }), sync: async () => ({ data: { state: 'unchanged' }, exitCode: 0 }) };

test('failed write exports pending receipt; a fresh checkout restores it and real sync reconciles without another add', async t => {
  const { createHash } = await import('node:crypto');
  const { canvasSync, REGIONS } = await import('../lib/canvas-sync.mjs');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const source = '# Acme snapshot\n', sourceHash = hash(source);
  const pending = { kind: 'add', operationId: 'acme_operation', key: 'snapshot', title: 'Acme snapshot', sourceHash, visualHash: null, hash: hash(JSON.stringify(['snapshot', 'Acme snapshot', sourceHash, null])), state: 'pending', at: '2026-10-08T07:00:00Z' };
  const base = initialManifest(), groups = new Map();
  for (const region of REGIONS) {
    const r = { kind: 'group', operationId: `op_${region.key}`, key: region.key, title: region.title, note: `Acme ${region.key}`, sourceHash: hash(`Acme ${region.key}`), at: pending.at, state: 'acknowledged', itemId: `group_${region.key}`, versionId: `version_${region.key}` };
    base.groups[region.key] = r;
    groups.set(r.itemId, { id: r.itemId, title: r.title, description: r.note, properties: { kind: 'group' }, currentVersionId: r.versionId, versions: [{ id: r.versionId, blobHash: r.sourceHash }] });
  }
  const first = await recoveryFixture(t, { manifest: base });
  const failed = await night({ ...first, report, yes: true, now: '2026-10-08T08:00:00Z', ...localPipeline, sync: async () => {
    await writeFile(join(first.root, '.keel/canvas/manifest.json'), JSON.stringify({ ...base, pending }));
    throw new Error('ambiguous fake transport response');
  } });
  assert.equal(failed.exitCode, 1);
  const path = join(first.output, 'recovery.json'), bytes = await readFile(path, 'utf8');
  assert.ok(!bytes.includes('fake-secret')); assert.equal(JSON.parse(bytes).manifest.pending.operationId, pending.operationId);
  const fresh = await recoveryFixture(t, { seed: false });
  const remote = { id: 'item_acme', title: pending.title, currentVersionId: 'version_acme', properties: { 'keel.project': 'acme', 'keel.operation': pending.operationId, 'keel.hash': pending.hash }, versions: [{ id: 'version_acme', blobHash: sourceHash }] };
  let adds = 0;
  const transport = { capabilities: async () => ({ groups: true, metadataRecovery: true }), canvas: async () => ({ id: binding.canvasId }), list: async () => [remote], show: async (_binding, id) => groups.get(id) ?? remote, add: async () => { adds++; throw Error('must not retry'); } };
  const recovered = await night({ ...fresh, env: { ...fresh.env, KEEL_CANVAS_RECOVERY: path }, report, yes: true, now: '2026-10-09T08:00:00Z', ...localPipeline,
    sync: options => canvasSync({ root: options.root, yes: true, cards: [{ key: 'snapshot', title: pending.title, source, region: 'evidence' }] }, { transport }) });
  assert.equal(recovered.exitCode, 0, JSON.stringify(recovered)); assert.equal(adds, 0);
  const saved = JSON.parse(await readFile(join(fresh.root, '.keel/canvas/manifest.json')));
  assert.equal(saved.pending, null); assert.equal(saved.items.snapshot.itemId, remote.id);
  assert.equal(JSON.parse(await readFile(join(fresh.output, 'recovery.json'))).history.length, 2);
});

test('cold-start refuses missing state, binding mismatch, credential fields, and never overwrites a local journal', async t => {
  const first = await recoveryFixture(t);
  assert.equal((await night({ ...first, report, now: '2026-10-08T08:00:00Z', ...localPipeline })).exitCode, 0);
  const original = JSON.parse(await readFile(join(first.output, 'recovery.json')));
  for (const mutate of [
    b => { b.binding.actorId = 'actor_other'; },
    b => { b.manifest.token = 'fake-secret'; },
    b => { b.manifest.history = [{ path: '../credentials.json' }]; },
  ]) {
    const fresh = await recoveryFixture(t, { seed: false }), b = structuredClone(original);
    mutate(b); const path = join(fresh.output, 'input.json'); await writeFile(path, JSON.stringify(b));
    let calls = 0;
    const out = await night({ ...fresh, env: { ...fresh.env, KEEL_CANVAS_RECOVERY: path }, report, yes: true, now: '2026-10-09T08:00:00Z', ...localPipeline, sync: async () => { calls++; } });
    assert.equal(out.exitCode, 1); assert.equal(calls, 0);
    await assert.rejects(readFile(join(fresh.root, '.keel/canvas/manifest.json')), { code: 'ENOENT' });
  }
  const missing = await recoveryFixture(t, { seed: false });
  assert.equal((await night({ ...missing, report, yes: true, ...localPipeline })).exitCode, 1);
  const local = await recoveryFixture(t, { manifest: { ...initialManifest(), run: { sourceDigest: 'a'.repeat(64), snapshotHash: 'b'.repeat(64), generatedAt: '2026-10-08T00:00:00Z' } } });
  const before = await readFile(join(local.root, '.keel/canvas/manifest.json'), 'utf8');
  const conflict = await night({ ...local, env: { ...local.env, KEEL_CANVAS_RECOVERY: join(first.output, 'recovery.json') }, report, yes: true, now: '2026-10-09T08:00:00Z', ...localPipeline });
  assert.equal(conflict.exitCode, 1);
  assert.equal(await readFile(join(local.root, '.keel/canvas/manifest.json'), 'utf8'), before);
});

test('recovery preserves exact referenced sync history and bounds observation history to 90 days', async t => {
  const { createHash } = await import('node:crypto');
  const saved = syntheticSnapshot('2026-10-07T08:00:00Z');
  const bytes = `${JSON.stringify(saved, null, 2)}\n`, fileHash = createHash('sha256').update(bytes).digest('hex');
  const name = `${'a'.repeat(64)}-${'b'.repeat(64)}.json`;
  const entry = { path: name, sourceDigest: 'a'.repeat(64), snapshotDigest: 'b'.repeat(64), generatedAt: saved.generatedAt, fileHash };
  const manifest = { ...initialManifest(), history: [entry] };
  const first = await recoveryFixture(t, { manifest });
  await mkdir(join(first.root, '.keel/canvas/history'));
  await writeFile(join(first.root, '.keel/canvas/history', name), bytes);
  const out = await night({ ...first, report, now: '2026-10-08T08:00:00Z', ...localPipeline });
  assert.equal(out.exitCode, 0, JSON.stringify(out));
  const bundle = JSON.parse(await readFile(join(first.output, 'recovery.json')));
  assert.equal(bundle.files[name], bytes);
  bundle.history.unshift(syntheticSnapshot('2026-01-01T08:00:00Z'));
  const path = join(first.output, 'with-old-sample.json'); await writeFile(path, JSON.stringify(bundle));
  const fresh = await recoveryFixture(t, { seed: false });
  let observed;
  const restored = await night({ ...fresh, env: { ...fresh.env, KEEL_CANVAS_RECOVERY: path }, report, yes: true, now: '2026-10-09T08:00:00Z', ...localPipeline,
    snapshot: async options => { observed = options.history; return localPipeline.snapshot(options); } });
  assert.equal(restored.exitCode, 0, JSON.stringify(restored));
  assert.equal(await readFile(join(fresh.root, '.keel/canvas/history', name), 'utf8'), bytes);
  assert.deepEqual(observed.map(s => s.generatedAt), ['2026-10-08T08:00:00.000Z']);
  assert.equal(JSON.parse(await readFile(join(fresh.output, 'recovery.json'))).history.length, 2);
  const corrupt = await recoveryFixture(t, { seed: false });
  bundle.files[name] += ' ';
  const bad = join(corrupt.output, 'bad.json'); await writeFile(bad, JSON.stringify(bundle));
  assert.equal((await night({ ...corrupt, env: { ...corrupt.env, KEEL_CANVAS_RECOVERY: bad }, report, yes: true, now: '2026-10-09T08:00:00Z', ...localPipeline })).exitCode, 1);
});

test('actual connect and full sync journal survives night export and fresh-root restore', async t => {
  const { canvasConnect, sync } = await import('../lib/canvas-sync.mjs');
  const { createHash } = await import('node:crypto');
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const root = await realpath(await fixture(t));
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ name: 'Acme', practices: [] }));
  const remote = new Map(); let sequence = 0;
  const transport = {
    capabilities: async () => ({ groups: true, metadataRecovery: true, createInSpace: true }),
    identity: async home => ({ id: 'actor_acme', home }),
    access: async () => ({ owner: 'actor_acme', grants: [] }),
    canvas: async target => ({ id: target.canvasId, groupMode: 'groups' }),
    show: async (_target, id) => structuredClone(remote.get(id)),
    list: async () => [...remote.values()],
    groups: async () => [...remote.values()].filter(item => item.properties.kind === 'group'),
    groupNew: async (_target, group) => {
      const id = `group_${++sequence}`, version = `version_${sequence}`;
      remote.set(id, { id, title: group.title, description: group.note, properties: { kind: 'group' }, currentVersionId: version, versions: [{ id: version, blobHash: hash(group.note) }] });
      return { itemId: id };
    },
    add: async (_target, card) => {
      const id = `item_${++sequence}`, version = `version_${sequence}`;
      const source = await readFile(card.sourcePath), visual = card.visualPath ? await readFile(card.visualPath) : null;
      remote.set(id, { id, title: card.title, properties: card.properties, currentVersionId: version, versions: [{ id: version, blobHash: hash(source), ...(visual ? { visual: { blobHash: hash(visual) } } : {}) }] });
      return { itemId: id };
    },
  };
  const connected = await canvasConnect({ root, canvasId: 'canvas_acme', home: 'https://acme.test', audience: 'owner-only', yes: true }, { transport });
  assert.equal(connected.exitCode, 0);
  const config = JSON.parse(await readFile(join(root, '.keel/keel.json')));
  config.canvas.cadence = 'nightly'; await writeFile(join(root, '.keel/keel.json'), JSON.stringify(config));
  const git = (cwd, ...args) => { const r = run('git', args, { cwd }); assert.equal(r.status, 0, r.stderr); };
  const commit = cwd => { git(cwd, 'init', '-q'); git(cwd, 'add', '.keel/keel.json'); git(cwd, '-c', 'user.name=Acme', '-c', 'user.email=acme@example.invalid', 'commit', '-qm', 'Acme approved binding'); };
  commit(root);
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'acme-real-night-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const env = { KEEL_CANVAS_PERSISTENCE: 'artifact-v1' };
  let syncError;
  const actualSync = async options => { try { return await sync(options, { transport }); } catch (e) { syncError = e.stack; throw e; } };
  const first = await night({ root, report, env, output: join(directory, 'first'), now: '2026-10-08T08:00:00Z', yes: true, sync: actualSync });
  assert.equal(first.exitCode, 0, syncError ?? JSON.stringify(first));
  const bundle = JSON.parse(await readFile(join(directory, 'first/recovery.json')));
  assert.ok(bundle.manifest.run.snapshotHash);
  assert.ok(bundle.manifest.lastSuccess.snapshot.fileHash);
  assert.ok(bundle.manifest.history.length);
  assert.equal(Object.keys(bundle.files).length, bundle.manifest.history.length);
  assert.ok(bundle.manifest.receipts.some(r => r.kind === 'attach'));
  const fresh = await realpath(await fixture(t, config.canvas)); commit(fresh);
  const second = await night({ root: fresh, report, env: { ...env, KEEL_CANVAS_RECOVERY: join(directory, 'first/recovery.json') }, output: join(directory, 'second'), now: '2026-10-09T08:00:00Z', yes: true, sync: actualSync });
  assert.equal(second.exitCode, 0, syncError ?? JSON.stringify(second));
  const after = JSON.parse(await readFile(join(directory, 'second/recovery.json')));
  assert.ok(after.manifest.history.length >= bundle.manifest.history.length);
  for (const entry of bundle.manifest.history) assert.equal(await readFile(join(fresh, '.keel/canvas/history', entry.path), 'utf8'), bundle.files[entry.path]);
});
