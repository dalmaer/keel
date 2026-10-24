import test from 'node:test';
import assert from 'node:assert/strict';
import { dailyHarness, dailyPlan, token } from './helpers/web-daily.mjs';
import { projectHarness } from './helpers/web-projects.mjs';
import { createProjectReader } from '../lib/web/projects.mjs';
import { createHomeStore } from '../lib/web/home-store.mjs';
import { dailyBudget, draftProblems, planRecord, homeDaily } from '../lib/web/daily-model.mjs';
import { readiness, furthestItems } from '../practices/night/files/scripts/plates/morning.mjs';
import { gitBlob } from '../lib/web/decision-github.mjs';
const inspect = h => h.daily.inspect(h.access, token, h.project, '2026-10-21');
const branch = (h, name, plan, digit) => { h.source.branches[name] = { head: digit.repeat(40), files: { [name === 'keel-night-plan' ? '.keel/night/plan.json' : `docs/night/${plan.date}.json`]: JSON.stringify(plan) } }; };

test('daily config prefers Plates, falls back only on tree absence and preserves configured health paths', async () => {
  for (const legacy of [false, true]) {
    const h = dailyHarness(), cfg = JSON.parse(h.source.files['.plates/plates.json']);
    cfg.health = 'observations/health';
    h.source.files[legacy ? '.keel/keel.json' : '.plates/plates.json'] = JSON.stringify(cfg);
    if (legacy) delete h.source.files['.plates/plates.json'];
    else h.source.files['.keel/keel.json'] = '{invalid legacy';
    for (const date of ['2026-10-21', '2026-10-22']) {
      h.source.files[`observations/health/${date}.md`] = h.source.files[`docs/health/${date}.md`];
      delete h.source.files[`docs/health/${date}.md`];
    }
    const model = await inspect(h);
    assert.equal(model.budget.lanes.find(l => l.id === 'climb').configuredMinutes, 45);
    assert.equal(model.measurements.before.rows[0].value, 30);
    assert.equal(model.measurements.after.rows[0].value, 18);
    assert.equal(model.capabilities.cli, 'plates goodnight');
  }
});

test('daily never falls back from malformed or denied canonical config to a legacy budget', async () => {
  const { createDaily } = await import('../lib/web/daily.mjs');
  for (const failure of ['malformed', 403, 404]) {
    const h = dailyHarness();
    h.source.files['.keel/keel.json'] = JSON.stringify({ climb: { jobs: ['test-time'], budget: { minutes: 999 } } });
    if (failure === 'malformed') h.source.files['.plates/plates.json'] = '{broken';
    const canonical = gitBlob(h.source.files['.plates/plates.json']), legacy = gitBlob(h.source.files['.keel/keel.json']);
    let legacyReads = 0;
    const daily = createDaily(h.config, { now: () => h.state.now, fetcher: (url, options) => {
      if (url.endsWith('/git/blobs/' + legacy)) legacyReads++;
      if (failure !== 'malformed' && url.endsWith('/git/blobs/' + canonical)) return Promise.resolve(Response.json({}, { status: failure }));
      return h.fetcher(url, options);
    } });
    await assert.rejects(daily.inspect(h.access, token, h.project, '2026-10-21'), e => e.code === (failure === 'malformed' ? 'configuration_unavailable' : 'access_denied'));
    assert.equal(legacyReads, 0);
    assert.deepEqual(h.source.writes, []);
  }
});

test('daily reads canonical sources at immutable revisions and preserves overdue work, original ticks and measured values', async () => {
  const h = dailyHarness(), model = await inspect(h);
  assert.deepEqual(model.readiness, readiness(dailyPlan(), new Date(h.state.now)));
  assert.equal(model.readiness.late, true);
  assert.equal(model.items[0].status, 'planned');
  assert.equal(model.sources.length, 8);
  assert.equal(model.sources[0].state, 'absent');
  assert.equal(model.from, 'main:docs/night/2026-10-21.json');
  assert.equal(model.items[0].source.revision, h.source.head);
  assert.equal(model.items[0].source.blob, gitBlob(JSON.stringify(dailyPlan())));
  assert.equal(model.measurements.before.rows[0].value, 30);
  assert.equal(model.measurements.after.rows[0].value, 18);
  assert.equal(model.budget.lanes.find(l => l.id === 'climb').configuredMinutes, 45);
  assert.equal(model.budget.lanes.find(l => l.id === 'climb').allocatedMinutes, 10);
  assert.deepEqual(model.budget.lanes.find(l => l.id === 'climb').targets, ['climb:test-time']);
  assert.deepEqual(model.budget.lanes.find(l => l.id === 'robot').targets, []);
  assert.equal(model.budget.actualMinutes, null);
  assert.equal(model.capabilities.execute, false);
  assert.equal(model.capabilities.runner, 'unavailable');
  assert.match(model.gaps.find(g => g.source === 'execution').reason, /Unresolved receipts remain unresolved/);
  assert.ok(h.source.dailyRequests.every(r => r.method === 'GET' || r.method === 'POST' && JSON.parse(r.body).query.startsWith('query ')));
  assert.deepEqual(h.source.writes, []);
});

test('record base and furthest tick ties match canonical morning while preserving the chosen origin', async () => {
  const h = dailyHarness(), planned = dailyPlan(), final = dailyPlan(), nightly = dailyPlan();
  planned.items[0].status = 'done'; planned.items[0].result = { note: 'Acme source observation, receipt unresolved.', link: 'https://github.com/acme/studio/pull/12' };
  final.items[0].status = 'failed'; final.willNotTouch = ['Acme final boundary'];
  nightly.items[0].status = 'running';
  branch(h, 'keel-night-plan', planned, 'd'); branch(h, 'keel-night/2026-10-21-final', final, 'e'); branch(h, 'keel-night/2026-10-21', nightly, 'f');
  const model = await inspect(h);
  assert.equal(model.from, 'keel-night/2026-10-21-final:docs/night/2026-10-21.json');
  assert.deepEqual(model.plan.items, furthestItems(final.items, [planned, final, nightly, dailyPlan()]));
  assert.deepEqual(model.plan.willNotTouch, ['Acme final boundary']);
  assert.equal(model.items[0].source.branch, 'keel-night-plan');
  assert.equal(model.items[0].source.revision, 'd'.repeat(40));
  assert.equal(model.items[0].resultUrl, 'https://github.com/acme/studio/pull/12');
  assert.equal(model.sources[4].plan.items[0].status, 'failed');
  assert.equal(model.sources[6].plan.items[0].status, 'planned');
});

test('absent, invalid, other-date and unavailable sources stay distinct; missing records do not become plans', async () => {
  const h = dailyHarness();
  delete h.source.files['docs/night/2026-10-21.json'];
  branch(h, 'keel-night-plan', dailyPlan('2026-10-22'), 'd');
  h.source.branches['keel-night/2026-10-21-final'] = { head: 'e'.repeat(40), files: { 'docs/night/2026-10-21.json': '{broken' } };
  const model = await inspect(h);
  assert.deepEqual(model.sources.map(s => s.state), ['absent', 'other-date', 'absent', 'absent', 'invalid', 'absent', 'absent', 'absent']);
  assert.equal(model.plan, null);
  h.source.dailyGraphError = 'INTERNAL';
  const unavailable = await inspect(h);
  assert.equal(unavailable.sources[0].state, 'unavailable');
  assert.equal(unavailable.plan, null);
});

test('current access, immutable repository identity and forbidden source responses fail closed', async () => {
  const h = dailyHarness();
  await assert.rejects(h.daily.inspect({ ...h.access, projects: [] }, token, h.project), e => e.status === 404);
  assert.equal(h.source.dailyRequests.length, 0);
  h.source.wrongDailyRepo = true;
  await assert.rejects(inspect(h), e => e.status === 404);
  h.source.wrongDailyRepo = false; h.source.dailyGraphError = 'FORBIDDEN';
  await assert.rejects(inspect(h), e => e.status === 404);
  h.source.dailyGraphError = null; h.source.dailyDenied = '/git/blobs/';
  await assert.rejects(inspect(h), e => e.status === 404);
});

test('draft previews are unsaved and refuse stale branch sources, wrong dates, disabled lanes and raised ceilings', async () => {
  const h = dailyHarness(), model = await inspect(h), input = { date: model.date, sourceDigest: model.sourceDigest, plan: dailyPlan() };
  const good = await h.daily.preview(h.access, token, h.project, input);
  assert.equal(good.valid, true); assert.equal(good.unsaved, true); assert.equal(good.capabilities.publish, false);
  input.plan.items[0].budget.minutes = 46;
  assert.equal((await h.daily.preview(h.access, token, h.project, input)).valid, false);
  input.plan = dailyPlan('2026-10-22');
  assert.match((await h.daily.preview(h.access, token, h.project, input)).problems.join(' '), /date/i);
  input.plan = dailyPlan(); input.plan.items[0].lane = 'robot:#12';
  assert.match((await h.daily.preview(h.access, token, h.project, input)).problems.join(' '), /disabled/);
  branch(h, 'keel-night-plan', dailyPlan(), 'd');
  await assert.rejects(h.daily.preview(h.access, token, h.project, input), e => e.code === 'daily_source_changed');
  assert.deepEqual(h.source.writes, []);
});

test('budget projections keep configured, allocated and unknown actual values separate and preserve ceiling periods', () => {
  const plan = dailyPlan();
  plan.items.push({ ...plan.items[0], id: 'acme-second', budget: { minutes: 40 } });
  const config = { climb: { jobs: ['test-time'], budget: { minutes: 45 } }, robot: { on: true, budgetMinutes: 60 } };
  assert.deepEqual(draftProblems(config, plan), [], 'per-run climb ceiling is not an aggregate nightly ceiling');
  assert.equal(dailyBudget(config, plan.items).lanes[0].allocatedMinutes, 50);
  plan.items.forEach(i => { i.lane = 'robot:#12'; i.budget.minutes = 40; });
  assert.match(draftProblems(config, plan).join(' '), /weekly ceiling/);
  assert.deepEqual(dailyBudget(config, plan.items).lanes.find(l => l.id === 'robot').targets, ['robot:#12', 'robot:pending']);
  const pending = dailyPlan(); pending.items[0].lane = 'robot:pending';
  assert.deepEqual(draftProblems(config, pending), [], 'canonical pending lane is a draft, never publication authorization');
  const bad = dailyBudget({ climb: { jobs: ['test-time'], budget: { minutes: 0 } }, robot: { on: true, budgetMinutes: 0 } }, dailyPlan().items);
  assert.equal(bad.lanes[0].enabled, null); assert.equal(bad.lanes[0].configuredMinutes, null);
  assert.equal(bad.lanes[1].enabled, null); assert.equal(bad.lanes[1].configuredMinutes, null);
  assert.equal(bad.actualMinutes, null);
  const defaults = { climb: { jobs: ['test-time'] } };
  assert.equal(dailyBudget(defaults, dailyPlan().items).lanes[0].configuredMinutes, null);
  assert.match(draftProblems(defaults, dailyPlan()).join(' '), /unavailable/);
  const disabled = dailyBudget({}, dailyPlan().items);
  assert.equal(disabled.lanes[0].enabled, false);
  assert.equal(disabled.lanes[1].enabled, false);
});

test('dates, file bounds, UTF-8 and result links cannot cause arbitrary URL fetches or expand reads', async () => {
  const h = dailyHarness();
  await assert.rejects(h.daily.inspect(h.access, token, h.project, '2026-02-30'), e => e.status === 400);
  assert.equal(h.source.dailyRequests.length, 0);
  for (let day = 1; day <= 31; day++) h.source.files[`docs/night/2026-10-${String(day).padStart(2, '0')}.json`] = JSON.stringify(dailyPlan(`2026-10-${String(day).padStart(2, '0')}`));
  const plan = dailyPlan(); plan.items[0].result = { link: 'https://preview.acme.test/private', note: 'Acme only' };
  h.source.files['docs/night/2026-10-21.json'] = JSON.stringify(plan);
  let model = await inspect(h);
  assert.equal(model.dates.length, 30); assert.ok(model.gaps.some(g => g.source === 'dates'));
  assert.ok(h.source.dailyRequests.every(r => new URL(r.url).hostname === 'api.github.com'));
  assert.ok(h.source.dailyRequests.length < 200);
  h.source.files['docs/night/2026-10-21.json'] = ' '.repeat(262145);
  model = await inspect(h);
  assert.equal(model.sources[6].state, 'unavailable');
  assert.equal(model.plan, null);
  assert.equal(planRecord('{"schema":1}', {}, '2026-10-21').state, 'invalid');
});

test('source blobs are content-verified and malformed UTF-8 remains invalid', async () => {
  const h = dailyHarness(), original = h.fetcher;
  const { createDaily } = await import('../lib/web/daily.mjs');
  const path = 'docs/night/2026-10-21.json', oid = gitBlob(h.source.files[path]);
  const fetcher = async (url, options) => {
    if (url.includes(`/git/blobs/${oid}`)) return Response.json({ sha: oid, size: Buffer.byteLength(h.source.files[path]), encoding: 'base64', content: Buffer.from('Acme tampering').toString('base64') });
    return original(url, options);
  };
  const model = await createDaily(h.config, { fetcher, now: () => h.state.now }).inspect(h.access, token, h.project, '2026-10-21');
  assert.equal(model.sources[6].state, 'invalid'); assert.equal(model.plan, null);
  h.source.files[path] = Buffer.from([0xc3, 0x28]);
  const invalidUtf8 = await inspect(h);
  assert.equal(invalidUtf8.sources[6].state, 'invalid');
  assert.equal(invalidUtf8.plan, null);
});

test('Home adds a bounded latest default record only and no nightly branch requests', async () => {
  const h = projectHarness(), path = 'docs/night/2026-10-21.json';
  h.source.files[path] = JSON.stringify(dailyPlan());
  const read = createProjectReader({ fetcher: h.fetcher, store: createHomeStore(h.config, h.fetcher), userId: h.access.userId, token, now: () => h.state.now });
  const model = await read(h.access.projects[0]);
  assert.equal(model.daily.date, '2026-10-21'); assert.equal(model.daily.state, 'read');
  assert.equal(model.daily.counts.planned, 1); assert.equal(model.daily.actualMinutes, null);
  assert.match(model.daily.coverage, /default-branch record only/);
  assert.ok(h.source.requests.every(r => !r.options.method || r.options.method === 'GET'));
  assert.ok(Buffer.byteLength(JSON.stringify(model.daily)) < 2000);
  const bad = await homeDaily({ project: h.access.projects[0], revision: h.source.revision, paths: [path], read: async () => '{bad' });
  assert.equal(bad.state, 'invalid'); assert.equal(bad.readiness, null);
});


test('missing or invalid plan leaves allocation unknown while a valid empty plan observes zero', async () => {
  const h = dailyHarness(), path = 'docs/night/2026-10-21.json';
  for (const value of [undefined, '{invalid']) {
    if (value === undefined) delete h.source.files[path]; else h.source.files[path] = value;
    const model = await inspect(h);
    assert.equal(model.plan, null);
    assert.ok(model.budget.lanes.every(lane => lane.allocatedMinutes === null && lane.unallocatedItems === null));
    assert.equal(model.budget.lanes.find(lane => lane.id === 'climb').configuredMinutes, 45);
  }
  h.source.files[path] = JSON.stringify({ ...dailyPlan(), items: [] });
  const empty = await inspect(h);
  assert.deepEqual(empty.plan.items, []);
  assert.ok(empty.budget.lanes.every(lane => lane.allocatedMinutes === 0 && lane.unallocatedItems === 0));
});

test('web daily accepts either plan name and excludes conflicting legacy ticks when both are tonight', async () => {
  for (const name of ['plates','keel']) {
    const h=dailyHarness(), p=dailyPlan();p.items[0].status='done';
    h.source.branches[`${name}-night-plan`]={head:'d'.repeat(40),files:{[`.${name}/night/plan.json`]:JSON.stringify(p)}};
    const found=await inspect(h);assert.equal(found.items[0].status,'done');assert.equal(found.items[0].source.branch,`${name}-night-plan`);
  }
  const h=dailyHarness(), current=dailyPlan(), legacy=dailyPlan();
  current.items[0].status='running';legacy.items[0].status='done';
  for(const [name,p,digit] of [['plates',current,'d'],['keel',legacy,'e']])h.source.branches[`${name}-night-plan`]={head:digit.repeat(40),files:{[`.${name}/night/plan.json`]:JSON.stringify(p)}};
  const found=await inspect(h);assert.equal(found.items[0].status,'running');assert.match(found.sources.find(s=>s.branch==='keel-night-plan').reason,/plates-night-plan wins/);
});

test('web daily reads either original nightly record and final record',async()=>{
 for(const name of ['plates','keel']) for(const suffix of ['', '-final']) {
  const h=dailyHarness(), p=dailyPlan();p.items[0].status='done';
  const ref=`${name}-night/${p.date}${suffix}`;branch(h,ref,p,'d');
  const found=await inspect(h);assert.equal(found.items[0].status,'done');assert.equal(found.items[0].source.branch,ref);
 }
});
