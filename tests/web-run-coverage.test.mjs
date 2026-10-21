import test from 'node:test';
import assert from 'node:assert/strict';
import { runsHarness, runFixture, jobFixture, artifactFixture, token } from './helpers/web-runs.mjs';
import { createRunBudget, createRuns } from '../lib/web/runs.mjs';
import { RUN_LIMITS, matchesWindow } from '../lib/web/run-model.mjs';
const overview = (h, options = {}, shared = {}) => h.runs.overview(h.access, token, h.project, options, shared);
const detail = (h, options = {}, shared = {}) => h.runs.detail(h.access, token, h.project, 9001, 1, options, shared);

test('retained run pagination stays explicit even when every observed item is filtered out', async () => {
  const h = runsHarness(); h.actions.runs = Array.from({ length: 25 }, (_, i) => runFixture({ id: i + 1 }));
  const model = await overview(h, { status: 'failed', days: 1 });
  assert.equal(model.items.length, 0); assert.equal(model.pagination.nextPage, 2); assert.equal(model.pagination.totalCount, 25);
  assert.ok(model.coverage.gaps.some(g => /recent retries of old runs/.test(g.reason)));
  assert.equal((await overview(h, { page: 2 })).items.length, 5);
  assert.equal((await overview(h, { page: 2 })).pagination.nextPage, null);
});

test('mid-read private denial fails closed while proven quota exhaustion preserves explicit unavailable coverage', async () => {
  const h = runsHarness(); h.actions.onRequest = url => { if (new URL(url).pathname.endsWith('/actions/runs')) h.actions.denied = true; };
  await assert.rejects(overview(h), e => e.code === 'access_denied' && e.status === 404);
  h.actions.onRequest = null; h.actions.denied = false; h.actions.status = 403; h.actions.headers = { 'x-ratelimit-remaining': '0' };
  const model = await overview(h);
  assert.equal(model.items.length, 0); assert.ok(model.coverage.gaps.some(g => g.code === 'run_quota'));
  assert.equal(model.coverage.state, 'unavailable');
  h.actions.status = 401; h.actions.headers = {};
  await assert.rejects(overview(h), e => e.status === 404);
});

test('expired run-level artifacts remain visible without invented attempt assignment or download URLs', async () => {
  const h = runsHarness(); h.actions.artifacts.set(9001, [artifactFixture({ expired: true }), artifactFixture({ id: 7002, workflow_run: { id: 9002 } })]);
  const model = await detail(h);
  assert.equal(model.evidence.length, 1); assert.equal(model.evidence[0].expired, true);
  assert.equal(model.evidence[0].attempt, null); assert.equal(model.evidence[0].scope, 'logical-run');
  assert.ok(model.coverage.gaps.some(g => g.code === 'expired'));
  assert.doesNotMatch(JSON.stringify(model), /signed-secret|archive_download_url|\/logs/);
  assert.ok(h.actions.requests.every(r => !/\/logs|\/zip/.test(r.url)));
});

test('bounded job and artifact pages expose continuation and incomplete usage while older-page detail is reachable', async () => {
  const h = runsHarness();
  h.actions.jobs.set('9001:1', Array.from({ length: 201 }, (_, i) => jobFixture({ id: i + 1 })));
  h.actions.artifacts.set(9001, Array.from({ length: 201 }, (_, i) => artifactFixture({ id: i + 1 })));
  const model = await detail(h);
  assert.equal(model.stages.length, 200); assert.equal(model.evidence.length, 200);
  assert.equal(model.pagination.jobs.nextPage, 3); assert.equal(model.pagination.artifacts.nextPage, 3);
  assert.equal(model.item.cost.weightedMinutes, null); assert.equal(model.item.cost.observedWeightedMinutes, 400);
  const tail = await detail(h, { jobsPage: 3, artifactsPage: 3 });
  assert.equal(tail.stages.length, 1); assert.equal(tail.item.cost.weightedMinutes, null);
  assert.equal(tail.item.cost.basis, 'observed-job-subtotal'); assert.equal(tail.pagination.jobs.nextPage, null);
});

test('provider drift, conflicting duplicated jobs and missing evidence never establish full cost', async () => {
  const h = runsHarness();
  h.actions.pages['/repos/acme/studio/actions/runs/9001/attempts/1/jobs?per_page=100&page=1'] = { total_count: 2, jobs: [jobFixture(), jobFixture({ conclusion: 'failure' })] };
  const model = await detail(h); assert.equal(model.stages.length, 0); assert.equal(model.item.cost.weightedMinutes, null);
  assert.ok(model.coverage.gaps.some(g => g.code === 'conflict'));
  h.actions.pages = {}; h.actions.jobs.set('9001:1', []); h.actions.artifacts.set(9001, []);
  const absent = await detail(h); assert.equal(absent.item.cost.observedWeightedMinutes, null);
  assert.ok(absent.coverage.gaps.some(g => g.source === 'jobs' && g.code === 'absent'));
  assert.ok(absent.coverage.gaps.some(g => g.source === 'artifacts' && g.code === 'absent'));
});

test('unknown runner weights, unfinished work and invalid timing keep complete totals unavailable', async () => {
  const h = runsHarness();
  h.actions.jobs.set('9001:1', [jobFixture(), jobFixture({ id: 2, labels: ['acme-custom'] }), jobFixture({ id: 3, status: 'in_progress', conclusion: null, completed_at: null }), jobFixture({ id: 4, started_at: '2026-10-22T10:00:00Z' })]);
  const model = await detail(h); assert.equal(model.item.cost.weightedMinutes, null); assert.equal(model.item.cost.observedWeightedMinutes, 2);
  assert.equal(model.item.cost.actual, null); assert.equal(model.item.completedAt, null); assert.equal(model.item.queueMs, null);
  assert.equal(model.item.cost.basis, 'observed-job-subtotal');
});

test('older absent attempts disclose retention only after current Actions access is confirmed', async () => {
  const h = runsHarness(); h.actions.runs = [runFixture({ run_attempt: 2 })];
  const model = await overview(h); assert.equal(model.items.length, 1); assert.equal(model.pagination.unreadAttempts, 1);
  assert.ok(model.coverage.gaps.some(g => g.code === 'run_not_found'));
  assert.ok(h.actions.requests.some(r => r.url.endsWith('/actions/runs?per_page=1&page=1')));
  await assert.rejects(h.runs.detail(h.access, token, h.project, 9001, 1), { code: 'run_not_found' });
  h.actions.onRequest = url => { if (new URL(url).pathname.endsWith('/attempts/1')) h.actions.status = 404; };
  await assert.rejects(overview(h), { code: 'access_denied' });
});

test('shared request, byte and elapsed bounds stop transport and retain unobserved attempt gaps', async () => {
  const h = runsHarness(); h.actions.runs = Array.from({ length: 20 }, (_, i) => runFixture({ id: i + 1, run_attempt: 10 }));
  for (let id = 1; id <= 20; id++) for (let attempt = 1; attempt < 10; attempt++) h.actions.attempts.set(`${id}:${attempt}`, runFixture({ id, run_attempt: attempt }));
  const budget = createRunBudget(h.fetcher, { now: () => h.state.now }), model = await overview(h, {}, { budget });
  assert.equal(budget.requests, 80); assert.ok(model.pagination.unreadAttempts > 0); assert.ok(model.coverage.gaps.some(g => g.code === 'run_limit'));
  let calls = 0;
  const large = createRunBudget(async () => { calls++; return new Response('x'.repeat(RUN_LIMITS.bytes + 1)); });
  await assert.rejects(large.fetcher('https://api.github.com/acme'), { code: 'run_limit' });
  await assert.rejects(large.fetcher('https://api.github.com/acme'), { code: 'run_limit' }); assert.equal(calls, 1);
  let clock = 0; const elapsed = createRunBudget(async () => { throw Error('Must not fetch'); }, { now: () => clock }); clock = 25000;
  await assert.rejects(elapsed.fetcher('https://api.github.com/acme'), { code: 'run_limit' });
});

test('source inventory is reused and bounded; unrecognized source and malformed pages remain gaps', async () => {
  const h = runsHarness();
  for (let i = 0; i < 35; i++) h.source.files[`.github/workflows/acme-${i}.yml`] = 'on: push\n';
  const budget = createRunBudget(h.fetcher, { now: () => h.state.now }), source = await h.runs.source(h.access, token, h.project, { budget });
  assert.equal(source.routines.length, 30); assert.ok(source.coverage.gaps.some(g => g.code === 'limit'));
  const count = budget.requests;
  h.actions.pages['/repos/acme/studio/actions/runs?per_page=20&page=1'] = { total_count: 100, workflow_runs: [] };
  const model = await overview(h, {}, { budget, source });
  assert.equal(budget.requests - count, 2, 'source snapshot is reused, only Actions inventory and run page read');
  assert.ok(model.coverage.gaps.some(g => g.code === 'pagination-drift'));
  assert.equal(model.pagination.nextPage, 2);
  await assert.rejects(overview(h, {}, { budget, source: { ...source, snapshot: { ...source.snapshot, source: { ...source.snapshot.source, repoId: 101 } } } }), e => e.status === 404);
});

test('filters and detail coordinates accept only bounded supported values', async () => {
  const h = runsHarness();
  for (const options of [{page:0},{days:91},{routine:'https://private.acme.test/'},{status:'approved'},{after:'https://private.acme.test/'}]) await assert.rejects(overview(h,options),e=>e.status===400);
  for (const id of [[9001], '9e3', '9001/../../secret', Number.MAX_SAFE_INTEGER + 1]) await assert.rejects(h.runs.detail(h.access,token,h.project,id,1),e=>e.status===400);
  await assert.rejects(detail(h,{jobsPage:10001}),e=>e.status===400);
  assert.equal(h.actions.requests.length,0);
});


test('old uncertain private effects stay visible without asserting active execution', () => {
  const now = Date.parse('2026-10-21T19:00:00Z'), filters = {days:30,routine:null,status:null};
  for (const kind of ['web-operation','web-migration','media-receipt']) {
    const item = {kind,provider:{status:kind==='media-receipt'?'delete-uncertain':'uncertain'},state:'unknown',updatedAt:'2026-01-01T00:00:00Z'};
    assert.equal(matchesWindow(item,filters,now),true);
    assert.equal(item.state,'unknown');
    assert.equal(matchesWindow({...item,provider:{status:'committed'}},filters,now),false);
    assert.equal(matchesWindow(item,{...filters,status:'running'},now),false);
  }
});
