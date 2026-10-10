// Synthetic Acme API shapes, exercised through the same gh transport and pagers
// used by the production night and adoption preview. No real project data.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readCiUsage, readCiGate, ciOptions } from '../practices/night/files/scripts/keel/ci.mjs';
import { gateWorkflowOf } from '../practices/night/files/scripts/keel/lib.mjs';
import { MEASURES, measure } from '../practices/night/files/scripts/keel/improve.mjs';
import { ghStub, scratch, ENV } from './helpers/improve.mjs';
const repo = 'acme/anvils', sha = 'a'.repeat(40), now = Date.parse('2026-10-10T12:00:00Z');
const stamp = minutes => new Date(now - minutes * 60000).toISOString();
const run = (id, extra = {}) => ({ id, run_attempt: 1, path: '.github/workflows/check.yml', name: 'Acme check', head_sha: sha, status: 'completed', conclusion: 'success', event: 'push', head_branch: 'main', head_repository: { full_name: repo }, created_at: stamp(20), updated_at: stamp(1), workflow_id: 7, ...extra });
const job = (id, runId = 1, extra = {}) => ({ id, run_id: runId, run_attempt: 1, name: 'Acme test', head_sha: sha, status: 'completed', conclusion: 'success', labels: ['ubuntu-latest'], started_at: stamp(3), completed_at: stamp(2), ...extra });
const page = (key, rows, total = rows.length) => ({ [key]: rows, total_count: total });
const baseApi = (runs = [run(1)], jobs = [job(101)]) => ({
  [`repos/${repo}`]: { private: false, default_branch: 'main', created_at: '2020-01-01T00:00:00Z' },
  [`repos/${repo}/actions/runs`]: page('workflow_runs', runs),
  [`repos/${repo}/actions/workflows/check.yml`]: { id: 7, path: '.github/workflows/check.yml', created_at: '2020-01-01T00:00:00Z' },
  [`repos/${repo}/actions/workflows/check.yml/runs`]: page('workflow_runs', runs),
  [`repos/${repo}/actions/runs/1/attempts/1/jobs`]: page('jobs', jobs),
});
const read = async (t, api, opts = {}) => readCiUsage({ repo, now, env: { ...ENV, KEEL_GH: await ghStub(t, { api }) }, ...opts });

test('CI reader pages runs and attempt jobs, rounds each runtime, includes old reruns and deduplicates jobs', async t => {
  const api = baseApi();
  delete api[`repos/${repo}/actions/runs`];
  api[`repos/${repo}/actions/runs?per_page=2&page=1`] = page('workflow_runs', [run(1), run(2, { run_attempt: 2, created_at: '2020-01-01T00:00:00Z' })], 3);
  api[`repos/${repo}/actions/runs?per_page=2&page=2`] = page('workflow_runs', [run(3, { path: '.github/workflows/keel-night.yml' })], 3);
  delete api[`repos/${repo}/actions/runs/1/attempts/1/jobs`];
  api[`repos/${repo}/actions/runs/1/attempts/1/jobs?per_page=2&page=1`] = page('jobs', [job(101, 1, { started_at: stamp(2.1), conclusion: 'failure' }), job(102, 1, { labels: ['windows-latest'], started_at: stamp(3.1), conclusion: 'cancelled' })], 3);
  api[`repos/${repo}/actions/runs/1/attempts/1/jobs?per_page=2&page=2`] = page('jobs', [job(103, 1, { labels: ['macos-latest'] }), job(101)], 3);
  api[`repos/${repo}/actions/runs/2/attempts/1/jobs`] = page('jobs', [job(201, 2, { started_at: '2020-01-01T00:00:00Z', completed_at: '2020-01-01T00:01:00Z' })]);
  api[`repos/${repo}/actions/runs/2/attempts/2/jobs`] = page('jobs', [job(202, 2, { run_attempt: 2 })]);
  api[`repos/${repo}/actions/runs/3/attempts/1/jobs`] = page('jobs', [job(301, 3)]);
  const result = await read(t, api, { limits: { perPage: 2 }, ownedWorkflows: ['.github/workflows/keel-night.yml'] });
  assert.equal(result.weightedMinutes, 17); // 1 + (2*2) + 10 + 1 + 1
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.runPages, 2);
  assert.equal(result.coverage.jobPages, 5);
  assert.equal(result.coverage.excludedJobs, 1);
  assert.equal(result.workflows.find(w => w.keel).weightedMinutes, 1);
  assert.equal(result.workflows[0].jobs[0].runner.billing, 'public-standard-free');
  assert.ok(result.workflows[0].jobs.some(j => j.conclusion === 'cancelled' && j.weightedMinutes === 4));
});

test('CI reader discloses pagination truncation, failed pages and unknown cost rather than zero', async t => {
  const capped = await read(t, { ...baseApi(), [`repos/${repo}/actions/runs`]: page('workflow_runs', [run(1)], 2) }, { limits: { perPage: 1, runPages: 1 } });
  assert.equal(capped.weightedMinutes, null);
  assert.equal(capped.workflows[0].weightedMinutes, null);
  assert.equal(capped.workflows[0].complete, false);
  assert.equal(capped.observedWeightedMinutes, 1);
  for (const bad of [
    { labels: ['unidentified-runner'] }, { completed_at: null },
    { status: 'in_progress', completed_at: null }, // contradictory success conclusion
    { completed_at: stamp(-1) }, { started_at: null, conclusion: 'cancelled' },
    { run_id: 99 }, { run_attempt: 2 }, { head_sha: 'b'.repeat(40) },
  ]) {
    const result = await read(t, baseApi([run(1)], [job(101, 1, bad)]));
    assert.equal(result.weightedMinutes, null, JSON.stringify(bad));
    assert.ok(result.coverage.unknownJobs > 0);
  }
  for (const api of [{}, baseApi([run(1)], []), { ...baseApi(), [`repos/${repo}/actions/runs/1/attempts/1/jobs`]: null }]) {
    const result = await read(t, api);
    assert.equal(result.weightedMinutes, null);
    assert.equal(result.coverage.complete, false);
  }
});

test('CI reader attributes crossing jobs by completion and separates weighting from billing', async t => {
  const start = new Date(now - 8 * 86400000).toISOString();
  const result = await read(t, baseApi([run(1)], [job(101, 1, { started_at: start, completed_at: new Date(now - 6 * 86400000).toISOString(), labels: ['self-hosted', 'linux'] })]), { config: { ci: { weights: { linux: 3 } } } });
  assert.equal(result.weightedMinutes, 2 * 24 * 60 * 3);
  assert.equal(result.workflows[0].jobs[0].runner.billing, 'self-hosted-no-hosted-charge');
  const skipped = await read(t, baseApi([run(1)], [job(101, 1, { started_at: null, completed_at: null, conclusion: 'skipped', labels: [] })]));
  assert.equal(skipped.weightedMinutes, 0);
  const custom = await read(t, baseApi([run(1)], [job(101, 1, { labels: ['acme-large'] })]), { config: { ci: { runnerWeights: { 'acme-large': 4 } } } });
  assert.equal(custom.weightedMinutes, 4);
  assert.equal(custom.workflows[0].jobs[0].runner.billing, 'unknown');
});

test('CI configuration rejects malformed weights and conflicting workflow aliases', () => {
  for (const ci of [null, [], 'bad', { weights: null }, { weights: 'linux' }, { weights: [] }, { weights: { linux: -1 } }, { weeklyMinutes: -1 }]) assert.throws(() => ciOptions({ ci }));
  assert.deepEqual(gateWorkflowOf({ ci: { gateWorkflow: 'check.yml' } }), { name: 'check.yml' });
  assert.deepEqual(gateWorkflowOf({ gateWorkflow: 'check.yml', ci: { gateWorkflow: 'check.yml' } }), { name: 'check.yml' });
  assert.ok(gateWorkflowOf({ gateWorkflow: 'other', ci: { gateWorkflow: 'check.yml' } }).problem);
});

function gateApi(row = run(1), jobs = [job(101)]) {
  return { ...baseApi(), [`repos/${repo}/actions/workflows`]: page('workflows', [{ id: 7, name: 'Acme check', path: '.github/workflows/check.yml' }]), [`repos/${repo}/actions/workflows/7/runs`]: page('workflow_runs', [row]), [`repos/${repo}/actions/runs/1/attempts/1/jobs`]: page('jobs', jobs) };
}
test('CI reuse requires exact clean main-push revision and actual recent job completion', async t => {
  const invoke = async (api, extra = {}) => readCiGate({ repo, workflow: 'check.yml', sha, clean: true, now, env: { ...ENV, KEEL_GH: await ghStub(t, { api }) }, ...extra });
  const oldCreated = await invoke(gateApi(run(1, { created_at: '2020-01-01T00:00:00Z' })));
  assert.equal(oldCreated.reused, true);
  assert.equal(oldCreated.ms, null);
  assert.equal(oldCreated.ageMs, 120000);
  assert.equal((await invoke(gateApi(run(1, { conclusion: 'failure' })))).status, 1);
  for (const row of [run(1, { head_sha: 'b'.repeat(40) }), run(1, { status: 'in_progress' }), run(1, { conclusion: 'skipped' }), run(1, { conclusion: 'cancelled' }), run(1, { event: 'pull_request' }), run(1, { head_repository: { full_name: 'other/anvils' } }), run(1, { head_branch: 'feature' })]) assert.equal((await invoke(gateApi(row))).reused, false);
  assert.equal((await invoke(gateApi(), { clean: false })).reused, false);
  for (const extra of [{ workflow_id: 8 }, { updated_at: stamp(-1) }, { updated_at: stamp(30) }, { updated_at: null }]) assert.equal((await invoke(gateApi(run(1, extra)))).reused, false);
  const tied = gateApi();
  tied[`repos/${repo}/actions/workflows/7/runs`] = page('workflow_runs', [run(2), run(1, { conclusion: 'failure' })]);
  assert.equal((await invoke(tied)).reused, false, 'same update timestamps cannot establish latest attempt');
  for (const bad of [{ completed_at: stamp(1500) }, { completed_at: stamp(-1) }, { run_id: 4 }, { run_attempt: 2 }, { head_sha: 'b'.repeat(40) }]) assert.equal((await invoke(gateApi(run(1), [job(101, 1, bad)]))).reused, false);
  assert.equal((await invoke({})).reused, false);
});

test('CI reuse needs evidence that tests ran: a run whose test jobs were all skipped falls back to the local gate (keel#93)', async t => {
  const invoke = async api => readCiGate({ repo, workflow: 'check.yml', sha, clean: true, now, env: { ...ENV, KEEL_GH: await ghStub(t, { api }) } });
  const lint = job(101, 1, { name: 'lint', steps: [{ name: 'Set up', conclusion: 'success' }, { name: 'Lint', conclusion: 'success' }] });
  const skippedTests = job(102, 1, { name: 'test', conclusion: 'skipped', started_at: stamp(2), completed_at: stamp(2) });
  for (const conclusion of ['success', 'failure']) {
    const none = await invoke(gateApi(run(1, { conclusion }), [lint, skippedTests]));
    assert.equal(none.reused, false, `${conclusion}: only lint ran`);
    assert.match(none.reason, /no test job or test-ledger run executed/);
  }
  const named = await invoke(gateApi(run(1), [lint, job(102, 1, { name: 'test' })]));
  assert.deepEqual([named.reused, named.testEvidence], [true, { kind: 'job', job: 'test' }], 'an executed test job');
  const step = await invoke(gateApi(run(1), [job(101, 1, { name: 'build', steps: [{ name: 'Install', conclusion: 'success' }, { name: 'Run tests', conclusion: 'failure' }] })]));
  assert.equal(step.reused, false, 'a step\'s name is not evidence (#95): only a test job whose steps all ran, or the ledger\'s artifact');
  // #95: the shipped check workflow's job, its tests skipped and its upload step (named for the ledger) successful, no artifact.
  const upload = await invoke(gateApi(run(1), [job(101, 1, { name: 'check', steps: [{ name: 'Run tests', conclusion: 'skipped' }, { name: 'Keep the test ledger', conclusion: 'success' }] })]));
  assert.equal(upload.reused, false, 'an upload step named for the ledger is not evidence that tests ran');
  const skippedStep = await invoke(gateApi(run(1), [job(101, 1, { name: 'build', steps: [{ name: 'Run tests', conclusion: 'skipped' }] })]));
  assert.equal(skippedStep.reused, false, 'a skipped test step is not evidence');
  // #95: a successful job named `test` whose `Run tests` step a condition skipped ran no tests.
  const skippedInTestJob = await invoke(gateApi(run(1), [job(102, 1, { name: 'test', steps: [{ name: 'Check out', conclusion: 'success' }, { name: 'Install', conclusion: 'success' }, { name: 'Run tests', conclusion: 'skipped' }] })]));
  assert.equal(skippedInTestJob.reused, false, 'a test job whose test step was skipped is not evidence');
  // A test job whose test step failed: GitHub skips the steps after it, and the failure is kept, never rerun locally.
  const failedTests = await invoke(gateApi(run(1, { conclusion: 'failure' }), [job(102, 1, { name: 'test', conclusion: 'failure', steps: [{ name: 'Check out', conclusion: 'success' }, { name: 'Run tests', conclusion: 'failure' }, { name: 'Upload', conclusion: 'skipped' }] })]));
  assert.deepEqual([failedTests.reused, failedTests.testEvidence], [true, { kind: 'job', job: 'test' }], 'a failed test job ran its tests: its failure is kept');
  assert.equal(failedTests.status, 1, 'and the reused gate failed');
  // #98: in a run that succeeded, a test job allowed to fail (its tests failed or never ran, the rest skipped) is no evidence.
  for (const steps of [[{ name: 'Run tests', conclusion: 'failure' }, { name: 'Upload', conclusion: 'skipped' }], [{ name: 'Install', conclusion: 'failure' }, { name: 'Run tests', conclusion: 'skipped' }]]) {
    const allowed = await invoke(gateApi(run(1, { conclusion: 'success' }), [job(102, 1, { name: 'test', conclusion: 'failure', steps })]));
    assert.equal(allowed.reused, false, `a successful run with an allowed-to-fail test job: ${JSON.stringify(steps)}`);
  }
  // A skip before any failure still means tests may not have run.
  const skipThenFail = await invoke(gateApi(run(1, { conclusion: 'failure' }), [job(102, 1, { name: 'test', conclusion: 'failure', steps: [{ name: 'Run tests', conclusion: 'skipped' }, { name: 'Lint', conclusion: 'failure' }] })]));
  assert.equal(skipThenFail.reused, false, 'tests skipped before the failing step');
  const wholeTestJob = await invoke(gateApi(run(1), [job(102, 1, { name: 'test', steps: [{ name: 'Check out', conclusion: 'success' }, { name: 'npm run check', conclusion: 'success' }] })]));
  assert.deepEqual([wholeTestJob.reused, wholeTestJob.testEvidence], [true, { kind: 'job', job: 'test' }], 'a test job whose every step ran');
  // #95, #96: the ledger's artifact is not evidence until its contents are read: the gate's own timing record is
  // uploaded even when no tests ran (keel's own check: job "check", step "Run the configured gate").
  const check = job(101, 1, { name: 'check', steps: [{ name: 'Run the configured gate', conclusion: 'success' }] });
  const kept = (extra = {}) => { const api = gateApi(run(1), [check]); api[`repos/${repo}/actions/runs/1/artifacts`] = page('artifacts', [{ id: 9, name: 'keel-test-runs', size_in_bytes: 4096, created_at: stamp(2.5), workflow_run: { id: 1, head_sha: sha }, ...extra }]); return api; };
  const ledger = await invoke(kept());
  assert.equal(ledger.reused, false, 'a fresh ledger artifact alone is not evidence that tests ran');
  assert.match(ledger.reason, /no test job or test-ledger run executed/);
  assert.equal((await invoke(gateApi(run(1), [check]))).reused, false, 'no artifact, no test-named job: not reused');
  // The night runs its own gate instead.
  const root = await scratch(t);
  const git = (...args) => execFileSync('git', args, { cwd: root, env: ENV, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  await writeFile(join(root, 'source'), 'Acme'); git('add', 'source'); git('commit', '-qm', 'Acme');
  const commit = git('rev-parse', 'HEAD');
  const config = { repo, ci: { gateWorkflow: 'check.yml' }, check: "node -e \"require('fs').writeFileSync('ran','yes')\"" };
  const api = gateApi(run(1, { head_sha: commit }), [{ ...lint, head_sha: commit }, { ...skippedTests, head_sha: commit }]);
  const [gate] = await measure({ root, config, now, env: { ...ENV, KEEL_GH: await ghStub(t, { api }) }, measures: MEASURES.filter(m => m.id === 'gate') });
  assert.equal(gate.facts.source, 'local-command');
  assert.match(gate.facts.reuseUnavailable, /no test job or test-ledger run executed/);
  assert.equal(await readFile(join(root, 'ran'), 'utf8'), 'yes');
});

test('night reuses explicit clean CI without local timing, preserves failure, and falls back safely', async t => {
  const root = await scratch(t);
  const git = (...args) => execFileSync('git', args, { cwd: root, env: ENV, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  await writeFile(join(root, 'source'), 'Acme'); git('add', 'source'); git('commit', '-qm', 'Acme');
  const commit = git('rev-parse', 'HEAD');
  const config = { repo, ci: { gateWorkflow: 'check.yml' }, check: "node -e \"require('fs').writeFileSync('ran','yes')\"" };
  const selected = MEASURES.filter(m => m.id === 'gate');
  const invoke = async (api, c = config) => (await measure({ root, config: c, now, env: { ...ENV, KEEL_GH: await ghStub(t, { api }) }, measures: selected }))[0];
  for (const conclusion of ['success', 'failure']) {
    const result = await invoke(gateApi(run(1, { head_sha: commit, conclusion }), [job(101, 1, { head_sha: commit })]));
    assert.equal(result.value, conclusion === 'success' ? 0 : 1);
    assert.equal(result.facts.source, 'github-actions');
    assert.match(result.detail, /not run locally/);
    assert.deepEqual(await readdir(root), ['.git', 'source']);
  }
  const fallback = await invoke({});
  assert.equal(fallback.facts.source, 'local-command');
  assert.equal(await readFile(join(root, 'ran'), 'utf8'), 'yes');
  const conflict = await invoke({}, { ...config, gateWorkflow: 'other.yml' });
  assert.equal(conflict.state, 'broken');
});

test('ci_minutes preserves incomplete coverage and confirmed over-bound usage', async t => {
  const root = await scratch(t);
  const api = baseApi([run(1)], [job(101), job(102, 1, { labels: ['unknown'] })]);
  const env = { ...ENV, KEEL_GH: await ghStub(t, { api }) };
  const selected = MEASURES.filter(m => m.id === 'ci_minutes');
  const invoke = async weeklyMinutes => (await measure({ root, now, config: { repo, ci: { weeklyMinutes } }, env, measures: selected }))[0];
  const low = await invoke(0);
  assert.equal(low.state, 'outside');
  assert.equal(low.value, 1);
  assert.equal(low.facts.coverage.complete, false);
  const high = await invoke(100);
  assert.equal(high.state, 'n/a');
  assert.ok(high.facts.coverage.gaps.length);
});

test('CI reuse never hides a recent failed or pending rerun behind an older green result', async t => {
  for (const status of ['completed', 'in_progress']) {
    const older = run(1, { created_at: stamp(100), updated_at: stamp(1), run_attempt: 2, status, conclusion: status === 'completed' ? 'failure' : null });
    const newerGreen = run(2, { created_at: stamp(30), updated_at: stamp(20) });
    const api = gateApi();
    api[`repos/${repo}/actions/workflows/7/runs`] = page('workflow_runs', [newerGreen, older]);
    api[`repos/${repo}/actions/runs/1/attempts/2/jobs`] = page('jobs', [job(201, 1, { run_attempt: 2, conclusion: 'failure' })]);
    const result = await readCiGate({ repo, workflow: 'check.yml', sha, clean: true, now, env: { ...ENV, KEEL_GH: await ghStub(t, { api }) } });
    if (status === 'completed') { assert.equal(result.reused, true); assert.equal(result.status, 1); assert.equal(result.attempt, 2); }
    else assert.equal(result.reused, false);
  }
});

test('CI reader discloses job-page, attempt and request ceilings and API visibility gaps', async t => {
  const api = baseApi([run(1, { run_attempt: 2 })], [job(101)]);
  api[`repos/${repo}/actions/runs/1/attempts/1/jobs`] = page('jobs', [job(101)], 2);
  const capped = await read(t, api, { limits: { perPage: 1, jobPages: 1, attempts: 1 } });
  assert.equal(capped.weightedMinutes, null);
  assert.ok(capped.coverage.gaps.some(x => x.includes('job') && x.includes('page limit')));
  assert.ok(capped.coverage.gaps.includes('run attempt limit reached'));
  const budget = await read(t, baseApi(), { limits: { requests: 2 } });
  assert.equal(budget.weightedMinutes, null);
  assert.equal(budget.coverage.requests, 2);
  assert.match(budget.coverage.gaps.join(' '), /request budget/);
  const noBilling = baseApi(); delete noBilling[`repos/${repo}`];
  const unknown = await read(t, noBilling);
  assert.equal(unknown.weightedMinutes, 1);
  assert.equal(unknown.visibility, 'unknown');
  assert.equal(unknown.coverage.billingUnavailable, true);
  assert.equal(unknown.workflows[0].jobs[0].runner.billing, 'unknown');
  const skip = await read(t, baseApi([run(1)], [job(101, 1, { labels: [], conclusion: 'skipped', started_at: stamp(2), completed_at: stamp(2), runner_id: null })]));
  assert.equal(skip.weightedMinutes, 0);
  const badApi = baseApi(); badApi[`repos/${repo}/actions/runs`] = { total_count: 1, workflow_runs: {} };
  assert.equal((await read(t, badApi)).weightedMinutes, null);
});

test('CI adoption validates cached units weights and shapes, then refetches or stays unavailable', async t => {
  const { adoptionCost } = await import('../lib/ci-adoption.mjs');
  const root = await scratch(t);
  await mkdir(join(root, '.keel'));
  const path = '.github/workflows/check.yml';
  const report = await read(t, baseApi(), { days: 28, workflow: 'check.yml' });
  const config = { ci: { historyRepo: repo } };
  const workflows = [{ path, triggers: ['push'], text: 'on: [push]' }];
  const cache = async history => writeFile(join(root, '.keel/ci-history.json'), JSON.stringify({ version: 1, repo, workflows: { [path]: history } }));
  const invoke = (env = { KEEL_CI_OFFLINE: '1' }, c = config) => adoptionCost({ root, config: c, workflows, env, now });
  await cache(report);
  assert.equal((await invoke()).monthlyWeightedMinutes, 1.07);
  const mutations = [
    r => { r.assumptions.runnerWeights = { 'ubuntu-latest': 1 }; },
    r => { r.window.days = 1; },
    r => { r.window.until = stamp(-1); },
    r => { r.workflows = {}; },
    r => { r.workflows[0].runs[0].weightedMinutes = -1; },
    r => { r.workflows[0].runs[0].weightedMinutes = null; },
    r => { r.observedWeightedMinutes = -1; },
  ];
  for (const mutate of mutations) {
    const bad = structuredClone(report); mutate(bad); await cache(bad);
    assert.equal((await invoke()).monthlyWeightedMinutes, null);
  }
  await cache(report);
  assert.equal((await invoke(undefined, { ci: { historyRepo: repo, runnerWeights: { 'ubuntu-latest': 10 } } })).monthlyWeightedMinutes, null);
  const bad = structuredClone(report); bad.window.days = 1; await cache(bad);
  const api = { ...baseApi(), [`repos/${repo}/actions/workflows/check.yml/runs`]: page('workflow_runs', [run(1)]) };
  const refetched = await invoke({ ...ENV, KEEL_CI_OFFLINE: '0', KEEL_GH: await ghStub(t, { api }) });
  assert.equal(refetched.monthlyWeightedMinutes, 1.07);
  assert.equal(refetched.workflows[0].source.kind, 'GitHub Actions API');
});

test('CI ownership follows lock paths rather than workflow names', async t => {
  const root = await scratch(t);
  const paths = ['check.yml', 'claude.yml', 'keel-custom.yml'].map(p => `.github/workflows/${p}`);
  const api = baseApi(paths.map((path, i) => run(i + 1, { path })));
  paths.forEach((_, i) => { api[`repos/${repo}/actions/runs/${i + 1}/attempts/1/jobs`] = page('jobs', [job(101 + i, i + 1)]); });
  const env = { ...ENV, KEEL_GH: await ghStub(t, { api }) };
  const invoke = async () => (await measure({ root, now, config: { repo }, env, measures: MEASURES.filter(m => m.id === 'ci_minutes') }))[0];
  assert.ok((await invoke()).facts.workflows.every(w => !w.keel), 'project-owned names are not ownership');
  await mkdir(join(root, '.keel'));
  await writeFile(join(root, '.keel/lock.json'), JSON.stringify({ files: { [paths[0]]: { practice: 'ci' }, [paths[1]]: { practice: 'claude' } } }));
  const result = await invoke();
  assert.deepEqual(result.facts.workflows.map(w => [w.keel, w.keelNamed]), [[true, false], [true, false], [false, true]]);
  assert.match(result.detail, /keel-owned:.*check.yml/);
  assert.match(result.detail, /keel-named:.*keel-custom.yml/);
});

test('CI adoption uses repository exposure including quiet days and validates cached age', async t => {
  const { adoptionCost } = await import('../lib/ci-adoption.mjs');
  const root = await scratch(t); await mkdir(join(root, '.keel'));
  const path = '.github/workflows/check.yml';
  const config = { ci: { historyRepo: repo } };
  const invoke = async (report, triggers = ['push']) => {
    await writeFile(join(root, '.keel/ci-history.json'), JSON.stringify({ version: 1, repo, workflows: { [path]: report } }));
    return adoptionCost({ root, config, workflows: [{ path, triggers, text: "cron: '0 2 * * *'" }], env: { KEEL_CI_OFFLINE: '1' }, now });
  };
  const api = baseApi([run(1)], [job(101, 1, { started_at: stamp(82) })]);
  api[`repos/${repo}`].created_at = stamp(8 * 1440);
  const report = await read(t, api, { days: 28, workflow: 'check.yml' });
  assert.equal(report.window.days, 28);
  assert.equal(report.window.observedDays, 8);
  assert.equal(report.window.observedSince, api[`repos/${repo}`].created_at);
  assert.equal((await invoke(report)).monthlyWeightedMinutes, 300);
  assert.match((await invoke(report)).workflows[0].assumptions.join(' '), /source per-run runtime; target setup, gate and runtime may differ; not a benchmark/);
  assert.match((await invoke(report)).workflows[0].assumptions.join(' '), /8-day workflow exposure.*requested 28 days/);
  api[`repos/${repo}`].created_at = stamp(7.5 * 1440);
  assert.equal((await invoke(await read(t, api, { days: 28, workflow: 'check.yml' }))).monthlyWeightedMinutes, 320);
  for (const age of [undefined, 'bad', stamp(-1)]) {
    api[`repos/${repo}`].created_at = age;
    const unknown = await read(t, api, { days: 28, workflow: 'check.yml' });
    assert.equal(unknown.window.observedDays, null);
    assert.equal((await invoke(unknown)).monthlyWeightedMinutes, null);
    unknown.workflows[0].runs[0].event = 'schedule';
    assert.equal((await invoke(unknown, ['schedule'])).monthlyWeightedMinutes, 2400, 'schedule uses mean and cadence without event exposure');
  }
  for (const mutate of [r => { r.window.observedDays = 28; }, r => { r.window.repoCreatedAt = stamp(-1); }, r => { r.window.observedSince = r.window.since; }, r => { delete r.window.repoCreatedAt; }]) {
    const bad = structuredClone(report); mutate(bad);
    assert.equal((await invoke(bad)).monthlyWeightedMinutes, null, 'malformed cached exposure is unavailable offline');
  }
});

test('ci_minutes counts completed history while excluding the running night and queued jobs', async t => {
  const root = await scratch(t);
  const night = run(2, { path: '.github/workflows/keel-night.yml', status: 'in_progress', conclusion: null });
  const api = baseApi([run(1), night]);
  api[`repos/${repo}/actions/runs/2/attempts/1/jobs`] = page('jobs', [
    job(201, 2, { status: 'in_progress', conclusion: null, completed_at: null }),
    job(202, 2, { status: 'queued', conclusion: null, started_at: null, completed_at: null }),
  ]);
  const invoke = async data => (await measure({ root, now, config: { repo, ci: { weeklyMinutes: 100 } }, env: { ...ENV, KEEL_GH: await ghStub(t, { api: data }) }, measures: MEASURES.filter(m => m.id === 'ci_minutes') }))[0];
  const result = await invoke(api);
  assert.equal(result.state, 'ok');
  assert.equal(result.value, 1);
  assert.equal(result.facts.coverage.complete, true);
  assert.equal(result.facts.coverage.unfinishedJobs, 2);
  assert.equal(result.facts.coverage.excludedJobs, 2);
  assert.equal(result.facts.coverage.unfinishedWeightedMinutes, null);
  assert.match(result.what, /completed-job/);
  assert.match(result.detail, /completed jobs only; 2 queued\/in-progress jobs excluded; 0 current queued attempts with no jobs excluded; unfinished usage not estimated/);
  for (const bad of [{ status: 'completed', conclusion: 'success', completed_at: null }, { status: 'completed', conclusion: 'failure', completed_at: stamp(-1) }]) {
    const malformed = structuredClone(api);
    Object.assign(malformed[`repos/${repo}/actions/runs/2/attempts/1/jobs`].jobs[0], bad);
    const unavailable = await invoke(malformed);
    assert.equal(unavailable.state, 'n/a', 'malformed completed timing remains a coverage gap');
    assert.equal(unavailable.facts.weightedMinutes, null);
    assert.equal(unavailable.facts.coverage.unknownJobs, 1);
  }
});

test('ci_minutes excludes only authoritative empty current queued attempts', async t => {
  const root = await scratch(t);
  const queued = run(1, { run_attempt: 2, status: 'queued', conclusion: null });
  const api = baseApi([queued]);
  const latest = `repos/${repo}/actions/runs/1/attempts/2/jobs`;
  api[latest] = page('jobs', []);
  const invoke = async data => (await measure({ root, now, config: { repo, ci: { weeklyMinutes: 100 } }, env: { ...ENV, KEEL_GH: await ghStub(t, { api: data }) }, measures: MEASURES.filter(m => m.id === 'ci_minutes') }))[0];
  const result = await invoke(api);
  assert.equal(result.state, 'ok');
  assert.equal(result.value, 1, 'older completed attempt is still accounted');
  assert.equal(result.facts.coverage.complete, true);
  assert.equal(result.facts.coverage.attempts, 2);
  assert.equal(result.facts.coverage.queuedAttemptsWithoutJobs, 1);
  assert.equal(result.facts.coverage.unfinishedJobs, 0, 'no job count invented for an empty attempt');
  assert.equal(result.facts.coverage.unfinishedWeightedMinutes, null);
  assert.match(result.detail, /1 current queued attempts with no jobs excluded/);
  for (const mutate of [
    a => { a[`repos/${repo}/actions/runs`].workflow_runs[0] = run(1, { run_attempt: 2 }); },
    a => { a[`repos/${repo}/actions/runs/1/attempts/1/jobs`] = page('jobs', []); },
    a => { delete a[latest]; },
    a => { a[latest] = { jobs: [] }; },
    a => { a[latest] = page('jobs', [], 1); },
  ]) {
    const incomplete = structuredClone(api); mutate(incomplete);
    const unknown = await invoke(incomplete);
    assert.equal(unknown.state, 'n/a', 'empty completed/older attempts and non-authoritative responses remain unknown');
    assert.equal(unknown.facts.weightedMinutes, null);
    assert.ok(unknown.facts.coverage.gaps.length);
  }
});

test('CI adoption excludes every attempt of unfinished logical runs and rejects legacy cache completion', async t => {
  const { adoptionCost } = await import('../lib/ci-adoption.mjs');
  const root = await scratch(t); await mkdir(join(root, '.keel'));
  const path = '.github/workflows/check.yml';
  const config = { ci: { historyRepo: repo } };
  const estimate = async report => {
    await writeFile(join(root, '.keel/ci-history.json'), JSON.stringify({ version: 1, repo, workflows: { [path]: report } }));
    return adoptionCost({ root, config, workflows: [{ path, triggers: ['schedule'], text: "cron: '0 2 * * *'" }], env: { KEEL_CI_OFFLINE: '1' }, now });
  };
  for (const status of ['queued', 'in_progress']) {
    const api = baseApi([run(1, { event: 'schedule', run_attempt: 2, status, conclusion: null })]);
    api[`repos/${repo}/actions/runs/1/attempts/2/jobs`] = page('jobs', status === 'queued' ? [] : [job(102, 1, { run_attempt: 2, status, conclusion: null, completed_at: null })]);
    const unfinished = await read(t, api, { days: 28 });
    assert.equal(unfinished.coverage.complete, true);
    assert.equal(unfinished.weightedMinutes, 1, 'completed attempt still contributes to window total');
    assert.equal((await estimate(unfinished)).monthlyWeightedMinutes, null, 'earlier attempt is not a whole-run sample');
    assert.equal(unfinished.workflows[0].runs[0].runComplete, false);
    api[`repos/${repo}/actions/runs`].workflow_runs.push(run(2, { event: 'schedule' }));
    api[`repos/${repo}/actions/runs/2/attempts/1/jobs`] = page('jobs', [job(201, 2, { started_at: stamp(6) })]);
    const mixed = await read(t, api, { days: 28 });
    assert.equal(mixed.weightedMinutes, 5);
    const cost = await estimate(mixed);
    assert.equal(cost.monthlyWeightedMinutes, 120, 'daily mean uses only the completed four-minute logical run');
    assert.equal(cost.workflows[0].excludedLogicalRuns, 1);
    assert.match(cost.workflows[0].assumptions.join(' '), /1 incomplete logical runs excluded with all their attempts/);
    for (const missing of [undefined, 'true', null]) {
      const legacy = structuredClone(mixed);
      legacy.workflows[0].runs[0].runComplete = missing;
      assert.equal((await estimate(legacy)).monthlyWeightedMinutes, null, 'cache cannot infer logical completion from attempt completion');
    }
  }
});

test('CI adoption rejects window-truncated logical runs across attempts and jobs', async t => {
  const { adoptionCost } = await import('../lib/ci-adoption.mjs');
  const root = await scratch(t); await mkdir(join(root, '.keel'));
  const path = '.github/workflows/check.yml';
  const estimate = async report => {
    await writeFile(join(root, '.keel/ci-history.json'), JSON.stringify({ version: 1, repo, workflows: { [path]: report } }));
    return adoptionCost({ root, config: { ci: { historyRepo: repo } }, workflows: [{ path, triggers: ['schedule'], text: "cron: '0 2 * * *'" }], env: { KEEL_CI_OFFLINE: '1' }, now });
  };
  const old = job(101, 1, { started_at: stamp(29 * 1440 + 100), completed_at: stamp(29 * 1440) });
  for (const split of [true, false]) {
    const api = baseApi([run(1, { event: 'schedule', run_attempt: split ? 2 : 1 })], split ? [old] : [job(102), old]);
    if (split) api[`repos/${repo}/actions/runs/1/attempts/2/jobs`] = page('jobs', [job(102, 1, { run_attempt: 2 })]);
    const report = await read(t, api, { days: 28 });
    assert.equal(report.coverage.complete, true);
    assert.equal(report.weightedMinutes, 1, 'window still contains only the one-minute job');
    assert.equal((await estimate(report)).monthlyWeightedMinutes, null, '100 old minutes cannot disappear from a whole-run mean');
    assert.ok(report.workflows[0].runs.every(r => r.runComplete === false));
    api[`repos/${repo}/actions/runs`].workflow_runs.push(run(2, { event: 'schedule' }));
    api[`repos/${repo}/actions/runs/2/attempts/1/jobs`] = page('jobs', [job(201, 2, { started_at: stamp(6) })]);
    const mixed = await read(t, api, { days: 28 });
    assert.equal(mixed.weightedMinutes, 5);
    assert.equal((await estimate(mixed)).monthlyWeightedMinutes, 120, 'only the complete four-minute logical run supplies the daily mean');
    const legacy = structuredClone(mixed); delete legacy.assumptions.logicalRunBasis;
    assert.equal((await estimate(legacy)).monthlyWeightedMinutes, null, 'older cached runComplete semantics cannot authorize an estimate');
  }
});

test('CI whole-run eligibility propagates missing attempt data and timing gaps to every sample', async t => {
  for (const fault of ['empty', 'page', 'identity', 'future', 'timing', 'weight', 'attempt-cap']) {
    const api = baseApi([run(1, { run_attempt: 2 })]);
    const latest = `repos/${repo}/actions/runs/1/attempts/2/jobs`;
    const bad = { identity: { run_id: 8 }, future: { completed_at: stamp(-1) }, timing: { started_at: null }, weight: { labels: ['acme-unknown'] } }[fault] ?? {};
    api[latest] = page('jobs', fault === 'empty' ? [] : [job(102, 1, { run_attempt: 2, ...bad })]);
    if (fault === 'page') delete api[latest];
    const report = await read(t, api, { days: 28, ...(fault === 'attempt-cap' ? { limits: { attempts: 1 } } : {}) });
    assert.equal(report.coverage.complete, false, fault);
    assert.ok(report.workflows[0].runs.length > 0);
    assert.ok(report.workflows[0].runs.every(r => r.runComplete === false), `${fault}: earlier valid rows cannot claim whole-run eligibility`);
  }
  const skipped = await read(t, baseApi([run(1)], [job(101), job(102, 1, { conclusion: 'skipped', started_at: stamp(29 * 1440), completed_at: stamp(29 * 1440) })]), { days: 28 });
  assert.equal(skipped.workflows[0].runs[0].runComplete, true, 'positively skipped zero execution does not truncate a run cost');
});

test('CI workflow creation bounds event exposure and cached provenance without inventing quiet days', async t => {
  const { adoptionCost } = await import('../lib/ci-adoption.mjs');
  const root = await scratch(t); await mkdir(join(root, '.keel'));
  const path = '.github/workflows/check.yml', metadata = `repos/${repo}/actions/workflows/check.yml`;
  const api = baseApi(); api[`repos/${repo}`].created_at = stamp(7 * 1440); api[metadata].created_at = stamp(7 * 60);
  const estimate = async (report, schedule = false) => {
    await writeFile(join(root, '.keel/ci-history.json'), JSON.stringify({ version: 1, repo, workflows: { [path]: report } }));
    return adoptionCost({ root, config: { ci: { historyRepo: repo } }, workflows: [{ path, triggers: [schedule ? 'schedule' : 'push'], text: "cron: '0 2 * * *'" }], env: { KEEL_CI_OFFLINE: '1' }, now });
  };
  const report = await read(t, api, { days: 28, workflow: 'check.yml' });
  assert.equal(report.window.observedDays, 7 / 24);
  assert.equal(report.window.workflowCreatedAt, stamp(7 * 60));
  assert.equal(report.window.observedSince, stamp(7 * 60));
  assert.equal((await estimate(report)).monthlyWeightedMinutes, 102.86, 'one minute over seven hours, not seven repository days');
  for (const mutate of [r => { delete r.window.workflowCreatedAt; }, r => { r.window.workflowCreatedAt = stamp(-1); }, r => { r.window.observedDays = 7; }, r => { r.window.workflowPath = '.github/workflows/other.yml'; }]) {
    const bad = structuredClone(report); mutate(bad);
    assert.equal((await estimate(bad)).monthlyWeightedMinutes, null);
  }
  for (const bad of [null, { ...api[metadata], created_at: 'bad' }, { ...api[metadata], path: '.github/workflows/other.yml' }]) {
    const missing = { ...api, [metadata]: bad };
    const history = await read(t, missing, { days: 28, workflow: 'check.yml' });
    assert.equal(history.coverage.complete, true);
    assert.equal(history.coverage.exposureUnavailable, true);
    assert.equal((await estimate(history)).monthlyWeightedMinutes, null);
    history.workflows[0].runs[0].event = 'schedule';
    assert.equal((await estimate(history, true)).monthlyWeightedMinutes, 30, 'schedule mean does not require event exposure');
  }
  assert.equal((await estimate(await read(t, api, { days: 28 }))).monthlyWeightedMinutes, null, 'repository-wide history alone cannot establish workflow event exposure');
});

test('CI adoption includes dated known-zero scheduled runs but never infers zero from absent execution evidence', async t => {
  const { adoptionCost } = await import('../lib/ci-adoption.mjs');
  const root = await scratch(t); await mkdir(join(root, '.keel'));
  const path = '.github/workflows/check.yml';
  const estimate = async api => {
    const history = await read(t, api, { days: 28 });
    await writeFile(join(root, '.keel/ci-history.json'), JSON.stringify({ version: 1, repo, workflows: { [path]: history } }));
    const cost = await adoptionCost({ root, config: { ci: { historyRepo: repo } }, workflows: [{ path, triggers: ['schedule'], text: "cron: '0 2 * * *'" }], env: { KEEL_CI_OFFLINE: '1' }, now });
    return { history, cost };
  };
  const zero = job(201, 2, { conclusion: 'skipped', started_at: stamp(2), completed_at: stamp(2), labels: [], runner_id: null });
  const api = baseApi([run(1, { event: 'schedule' }), run(2, { event: 'schedule', conclusion: 'skipped' })], [job(101, 1, { started_at: stamp(12) })]);
  api[`repos/${repo}/actions/runs/2/attempts/1/jobs`] = page('jobs', [zero]);
  const mixed = await estimate(api);
  assert.equal(mixed.history.weightedMinutes, 10);
  assert.equal(mixed.cost.monthlyWeightedMinutes, 150, 'ten-minute and dated zero-minute runs both contribute to the mean');
  api[`repos/${repo}/actions/runs`].workflow_runs.shift();
  api[`repos/${repo}/actions/runs`].total_count = 1;
  const allZero = await estimate(api);
  assert.equal(allZero.cost.monthlyWeightedMinutes, 0);
  assert.equal(allZero.history.workflows[0].runs[0].runComplete, true);
  for (const jobs of [[], [{ ...zero, started_at: null, completed_at: null }], [{ ...zero, started_at: stamp(29 * 1440), completed_at: stamp(29 * 1440) }], [{ ...zero, status: 'queued', conclusion: null, started_at: null, completed_at: null }], [{ ...zero, run_id: 99 }]]) {
    const unknown = structuredClone(api); unknown[`repos/${repo}/actions/runs/2/attempts/1/jobs`] = page('jobs', jobs);
    assert.equal((await estimate(unknown)).cost.monthlyWeightedMinutes, null);
  }
});

test('CI attempt-scoped readers allow absent job attempts but reject present mismatches and foreign identities', async t => {
  const withoutAttempt = (id, extra = {}) => { const value = job(id, 1, extra); delete value.run_attempt; return value; };
  const api = baseApi([run(1, { run_attempt: 2 })], [withoutAttempt(101)]);
  api[`repos/${repo}/actions/runs/1/attempts/2/jobs`] = page('jobs', [withoutAttempt(102)]);
  const usage = await read(t, api);
  assert.equal(usage.coverage.complete, true);
  assert.equal(usage.weightedMinutes, 2);
  assert.deepEqual(usage.workflows[0].jobs.map(j => j.attempt), [1, 2], 'attempt-scoped request paths supply absent response fields');
  const reuse = async (jobs, conclusion = 'success') => {
    const data = gateApi(run(1, { run_attempt: 2, conclusion }));
    data[`repos/${repo}/actions/runs/1/attempts/2/jobs`] = page('jobs', jobs);
    return readCiGate({ repo, workflow: 'check.yml', sha, clean: true, now, env: { ...ENV, KEEL_GH: await ghStub(t, { api: data }) } });
  };
  for (const conclusion of ['success', 'failure']) {
    const result = await reuse([withoutAttempt(102, { conclusion })], conclusion);
    assert.equal(result.reused, true);
    assert.equal(result.attempt, 2);
    assert.equal(result.status, conclusion === 'success' ? 0 : 1);
  }
  for (const extra of [{ run_attempt: null }, { run_attempt: '2' }, { run_attempt: 1 }, { run_attempt: 0 }, { run_attempt: 2.5 }, { run_id: 9 }, { head_sha: 'b'.repeat(40) }]) {
    const invalid = { ...withoutAttempt(102), ...extra };
    const data = structuredClone(api); data[`repos/${repo}/actions/runs/1/attempts/2/jobs`] = page('jobs', [invalid]);
    const unknown = await read(t, data);
    assert.equal(unknown.coverage.complete, false, JSON.stringify(extra));
    assert.equal(unknown.weightedMinutes, null);
    assert.equal((await reuse([invalid])).reused, false, JSON.stringify(extra));
  }
});
