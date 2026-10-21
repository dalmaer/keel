import test from 'node:test';
import assert from 'node:assert/strict';
import { runsHarness, runFixture, jobFixture, token } from './helpers/web-runs.mjs';
import { runIdentity, deduplicate, attemptModel } from '../lib/web/run-model.mjs';
import { createRuns } from '../lib/web/runs.mjs';
import { gitBlob } from '../lib/web/decision-github.mjs';
import { createGitHub } from '../lib/web/github.mjs';
import { routineDefinition, mergeWorkflowInventory } from '../lib/web/routines.mjs';
const overview = (h, options) => h.runs.overview(h.access, token, h.project, options);

test('Actions attempts retain tuple identity, first-attempt parentage, original provider status and no acceptance', async () => {
  const h = runsHarness(), model = await overview(h);
  const item = model.items[0];
  assert.deepEqual(JSON.parse(item.id), ['github-actions-attempt', 102, 9001, 1]);
  assert.deepEqual(JSON.parse(item.parentId), ['github-actions-run', 102, 9001]);
  assert.equal(item.retryOf, null); assert.equal(item.provider.conclusion, 'success'); assert.equal(item.state, 'succeeded');
  assert.equal(item.acceptance, 'not-established'); assert.equal(item.cost.actual, null); assert.equal(item.cost.weightedMinutes, null);
  assert.equal(item.detailUrl, '/projects/studio/activity/actions/9001/attempts/1');
  assert.equal(model.routines[0].id, '.github/workflows/check.yml'); assert.equal(model.routines[0].providerId, 501);
  assert.equal(model.routines[0].providerState, 'active'); assert.equal(model.routines[0].revision, h.source.head);
  assert.deepEqual(model.routines[0].schedules, ['23 7 * * *']);
  assert.ok(h.actions.requests.every(r => !r.options.method || r.options.method === 'GET'));
  assert.ok(h.actions.requests.every(r => new URL(r.url).pathname.startsWith('/repositories/102/actions/')));
});

test('old logical runs retain recent retries without sending a created lower filter and newest ten attempts are distinct', async () => {
  const h = runsHarness(); h.actions.runs = [runFixture({ run_attempt: 12 })];
  for (let attempt = 3; attempt < 12; attempt++) h.actions.attempts.set(`9001:${attempt}`, runFixture({ run_attempt: attempt, conclusion: attempt === 11 ? 'failure' : 'success' }));
  const model = await overview(h, { days: 1 });
  assert.equal(model.items.length, 10); assert.deepEqual(model.items.map(i => i.identity.attempt), [12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
  assert.equal(model.items[0].retryOf, runIdentity(102, 9001, 11));
  assert.equal(model.pagination.unreadAttempts, 2); assert.ok(model.coverage.gaps.some(g => g.code === 'attempt-limit'));
  assert.ok(h.actions.requests.every(r => !new URL(r.url).searchParams.has('created')));
  assert.equal((await overview(h, { status: 'failed', routine: '.github/workflows/check.yml' })).items.length, 1);
});

test('same identities deduplicate and conflicting provider facts produce gaps instead of choosing a winner', async () => {
  const h = runsHarness(); h.actions.runs = [runFixture(), runFixture()];
  assert.equal((await overview(h)).items.length, 1);
  h.actions.runs[1].conclusion = 'failure';
  const model = await overview(h); assert.equal(model.items.length, 0); assert.ok(model.coverage.gaps.some(g => g.code === 'conflict'));
  const first = attemptModel(h.project, runFixture());
  assert.equal(deduplicate([first, { ...first, id: runIdentity(103, 9001, 1) }]).items.length, 2);
});

test('detail validates attempt, repository, SHA and optional job attempt identity while showing elapsed stages', async () => {
  const h = runsHarness();
  let detail = await h.runs.detail(h.access, token, h.project, 9001, 1);
  assert.equal(detail.stages.length, 1); assert.equal(detail.stages[0].durationMs, 61000); assert.equal(detail.stages[0].steps[0].durationMs, 59000);
  assert.equal(detail.item.queueMs, null); assert.equal(detail.item.cost.weightedMinutes, 2); assert.equal(detail.item.cost.basis, 'complete-job-estimate');
  h.actions.jobs.set('9001:1', [jobFixture({ run_attempt: 2 }), jobFixture({ id: 8002, run_id: 9002 }), jobFixture({ id: 8003, head_sha: 'e'.repeat(40) })]);
  detail = await h.runs.detail(h.access, token, h.project, 9001, 1);
  assert.equal(detail.stages.length, 0); assert.equal(detail.item.cost.weightedMinutes, null); assert.ok(detail.coverage.gaps.some(g => g.source === 'jobs'));
  h.actions.attempts.set('9001:1', runFixture({ repository: { id: 101 } }));
  await assert.rejects(h.runs.detail(h.access, token, h.project, 9001, 1), { code: 'run_identity_mismatch' });
});

test('requested, waiting and action-required provider observations remain explicit', async () => {
  const h = runsHarness(); h.actions.runs = [runFixture({ id: 1, status: 'requested', conclusion: null }), runFixture({ id: 2, status: 'waiting', conclusion: null }), runFixture({ id: 3, conclusion: 'action_required' })];
  const model = await overview(h); assert.deepEqual(model.items.map(i => i.state), ['requested', 'waiting', 'waiting']);
  assert.equal(model.items[2].provider.conclusion, 'action_required');
  assert.equal((await overview(h, { status: 'waiting' })).items.length, 2);
});

test('only fresh installation Actions grants enable provider history and scoped authorization cannot be bypassed', async () => {
  const h = runsHarness();
  assert.equal((await createGitHub(h.config, h.fetcher).access(token)).actionsPermission, 'read');
  h.actions.permission = null;
  assert.equal((await createGitHub(h.config, h.fetcher).access(token)).actionsPermission, null);
  const model = await h.runs.overview({ ...h.access, actionsPermission: null }, token, h.project);
  assert.equal(model.items.length, 0); assert.equal(model.routines.length, 1); assert.ok(model.coverage.gaps.some(g => g.code === 'permission'));
  assert.equal(h.actions.requests.length, 0);
  await assert.rejects(h.runs.overview({ ...h.access, projects: [] }, token, h.project), e => e.status === 404);
  await assert.rejects(h.runs.overview(h.access, token, { ...h.project, repoId: 101 }), e => e.status === 404);
});

test('workflow declarations disclose unsupported YAML and never infer next run or execution authority', () => {
  const h = runsHarness();
  const model = routineDefinition(h.project, { head: 'b'.repeat(40) }, '.github/workflows/check.yml', 'name: Acme\non: [push, workflow_dispatch]\npermissions:\n  contents: read\nconcurrency: acme-check\n');
  assert.deepEqual(model.triggers, ['push', 'workflow_dispatch']); assert.deepEqual(model.permissions, { contents: 'read' }); assert.equal(model.concurrency, 'acme-check'); assert.equal(model.nextRun, null);
  const unresolved = routineDefinition(h.project, { head: 'b'.repeat(40) }, '.github/workflows/check.yml', 'on: *events\npermissions: ${{ inputs.permissions }}\n');
  assert.deepEqual(unresolved.triggers, []); assert.equal(unresolved.permissions, null); assert.ok(unresolved.gaps.length);
});


test('literal metadata survives unrelated job expressions and a conflicted workflow path never regains a winner', () => {
  const h = runsHarness(), path = '.github/workflows/check.yml';
  const definition = routineDefinition(h.project, { head: h.source.head }, path,
    'on:\n  push:\n  schedule:\n    - cron: "23 7 * * *"\njobs:\n  test:\n    steps:\n      - run: echo ${{github.sha}}\n');
  assert.deepEqual(definition.triggers, ['push', 'schedule']);
  assert.deepEqual(definition.schedules, ['23 7 * * *']);
  const merged = mergeWorkflowInventory(h.project, {}, [definition], [1, 2, 3].map(id => ({id, path, name:'Acme', state:'active'})));
  assert.equal(merged.routines[0].providerId, null);
  assert.equal(merged.routines[0].providerState, null);
  assert.ok(merged.gaps.some(gap => gap.code === 'conflict'));
});

test('active old attempts and finished attempts with recent provider activity remain in the visible window', async () => {
  const h = runsHarness();
  h.actions.runs = [runFixture({id:1,status:'in_progress',conclusion:null,run_started_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T00:00:00Z'}),
    runFixture({id:2,run_started_at:'2026-09-01T00:00:00Z'}),
    runFixture({id:3,run_started_at:'2026-09-01T00:00:00Z',updated_at:'2026-09-01T01:00:00Z'})];
  assert.deepEqual((await overview(h,{days:30})).items.map(item=>item.identity.runId),[1,2]);
});


test('numeric Actions transport never falls back to recycled repository names', async () => {
  const h = runsHarness(); h.actions.status = 404;
  await assert.rejects(overview(h), e => e.status === 404);
  assert.ok(h.actions.requests.every(request => new URL(request.url).pathname.startsWith('/repositories/102/actions/')));
  assert.equal(h.actions.requests.some(request => request.url.includes('/repos/acme/studio/')), false);
});


test('Routines config prefers Plates and reads legacy configuration only on confirmed tree absence', async () => {
  for (const legacy of [false, true]) {
    const h = runsHarness();
    h.source.files['.keel/keel.json'] = JSON.stringify({ ci: { weeklyMinutes: 999 } });
    if (legacy) delete h.source.files['.plates/plates.json'];
    const context = await h.runs.source(h.access, token, h.project);
    assert.equal(context.config.ci.weeklyMinutes, legacy ? 999 : 120);
    assert.equal(context.coverage.gaps.some(g => g.source === 'configuration'), false);
    assert.deepEqual(h.source.writes, []);
  }
});

test('Routines config never substitutes legacy data after malformed or forbidden canonical reads', async () => {
  for (const failure of ['malformed', 403, 404]) {
    const h = runsHarness();
    h.source.files['.keel/keel.json'] = JSON.stringify({ ci: { weeklyMinutes: 999 } });
    if (failure === 'malformed') h.source.files['.plates/plates.json'] = '{broken';
    const canonical = gitBlob(h.source.files['.plates/plates.json']), legacy = gitBlob(h.source.files['.keel/keel.json']);
    let legacyReads = 0;
    const runs = createRuns(h.config, { now: () => h.state.now, fetcher: async (url, options) => {
      if (url.endsWith('/git/blobs/' + legacy)) legacyReads++;
      if (failure !== 'malformed' && url.endsWith('/git/blobs/' + canonical)) return Response.json({}, { status: failure });
      return h.fetcher(url, options);
    } });
    if (failure === 'malformed') {
      const context = await runs.source(h.access, token, h.project);
      assert.equal(context.config.ci, null);
      assert.ok(context.coverage.gaps.some(g => g.source === 'configuration'));
    } else await assert.rejects(runs.source(h.access, token, h.project), { code: 'access_denied' });
    assert.equal(legacyReads, 0);
    assert.deepEqual(h.source.writes, []);
  }
});
