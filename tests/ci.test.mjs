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
const job = (id, runId = 1, extra = {}) => ({ id, run_id: runId, run_attempt: 1, head_sha: sha, status: 'completed', conclusion: 'success', labels: ['ubuntu-latest'], started_at: stamp(3), completed_at: stamp(2), ...extra });
const page = (key, rows, total = rows.length) => ({ [key]: rows, total_count: total });
const baseApi = (runs = [run(1)], jobs = [job(101)]) => ({
  [`repos/${repo}`]: { private: false, default_branch: 'main', created_at: '2020-01-01T00:00:00Z' },
  [`repos/${repo}/actions/runs`]: page('workflow_runs', runs),
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
    { labels: ['unidentified-runner'] }, { status: 'in_progress', completed_at: null },
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
  const report = await read(t, baseApi(), { days: 28 });
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
  const report = await read(t, api, { days: 28 });
  assert.equal(report.window.days, 28);
  assert.equal(report.window.observedDays, 8);
  assert.equal(report.window.observedSince, api[`repos/${repo}`].created_at);
  assert.equal((await invoke(report)).monthlyWeightedMinutes, 300);
  assert.match((await invoke(report)).workflows[0].assumptions.join(' '), /source per-run runtime; target setup, gate and runtime may differ; not a benchmark/);
  assert.match((await invoke(report)).workflows[0].assumptions.join(' '), /8-day exposure.*requested 28 days/);
  api[`repos/${repo}`].created_at = stamp(7.5 * 1440);
  assert.equal((await invoke(await read(t, api, { days: 28 }))).monthlyWeightedMinutes, 320);
  for (const age of [undefined, 'bad', stamp(-1)]) {
    api[`repos/${repo}`].created_at = age;
    const unknown = await read(t, api, { days: 28 });
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
