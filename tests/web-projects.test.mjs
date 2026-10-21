import test from 'node:test';
import assert from 'node:assert/strict';
import { projectHarness, phaseFile } from './helpers/web-projects.mjs';
import { createHomeReader } from '../lib/web/home.mjs';
import { createHomeStore } from '../lib/web/home-store.mjs';
import { createProjectReader } from '../lib/web/projects.mjs';
import { hash } from '../lib/web/common.mjs';
const token = 'fake-user-access-token-for-tests';
const home = h => createHomeReader(h.config, { fetcher: h.fetcher, now: () => h.state.now });

test('file phases reuse board ownership/readiness, separate source claims and give revision-bound links', async () => {
  const h = projectHarness(), result = await home(h)(h.access, token);
  assert.equal(result.decisions.length, 1); assert.match(result.decisions[0].title, /phase 1/);
  assert.equal(result.walks.length, 1); assert.equal(result.walks[0].ready, true); assert.match(result.walks[0].title, /phone/);
  assert.equal(result.waiting.length, 1); assert.match(result.waiting[0].why, /Ready when/);
  assert.equal(result.projects[0].planning.built, 1); assert.equal(result.projects[0].planning.total, 4);
  assert.match(result.projects[0].planning.next, /Choose/);
  assert.match(result.changes[0].link, new RegExp(`/blob/${h.source.revision}/docs/phases/04-built.md$`));
  assert.equal(result.changes[0].media, null); assert.equal(result.changes[0].previewUrl, null);
  assert.equal(result.changes[0].acceptance, 'source claim');
  assert.equal(result.coverage.state, 'partial'); assert.ok(result.coverage.gaps.some(gap => gap.source === 'GitHub operations'));
  assert.equal(h.source.requests.every(request => !request.options.method || request.options.method === 'GET'), true, 'all project requests are reads');
  const original = result.decisions[0];
  h.state.now += 61000; h.source.revision = 'd'.repeat(40);
  const changed = await home(h)(h.access, token, { fresh: true, since: result.cursor });
  assert.equal(changed.decisions[0].id, original.id); assert.notEqual(changed.decisions[0].expectedSourceVersion, original.expectedSourceVersion);
});

test('the source budget covers 109 real-shaped phases, not only small fixtures', async () => {
  const h = projectHarness();
  for (const path of Object.keys(h.source.files)) if (path.startsWith('docs/phases/')) delete h.source.files[path];
  for (let i = 0; i < 109; i++) h.source.files[`docs/phases/${String(i).padStart(3,'0')}-acme.md`] = phaseFile(i, { status: 'built' });
  const result = await home(h)(h.access, token);
  assert.equal(result.projects[0].planning.total, 109); assert.equal(result.projects[0].planning.built, 109);
  assert.equal(result.projects[0].sourceComplete, true);
  assert.equal(result.projects[0].gaps.some(gap => gap.source === 'planning'), false);
  assert.ok(h.source.requests.length <= 120);
});

test('projects-shaped plans reuse their status vocabulary and never treat future work as recent additions', async () => {
  const h = projectHarness({ shape: 'projects' });
  h.source.files['docs/projects/publishing/phases.md'] = '# Publishing\n\n## Phase 1 — Ship a page\n**Status: CLOSED.** 2026-10-01 — Used.\n\n## Phase 2 — Draft safely\n**Status: PART-DONE.** 2026-10-20 — In progress.\n\n**Where we are** Next: phase 2.\n';
  const result = await home(h)(h.access, token), plan = result.projects[0].planning;
  assert.equal(plan.source, 'projects'); assert.equal(plan.built, 1); assert.equal(plan.total, 2); assert.match(plan.next, /Draft safely/);
  assert.deepEqual(result.walks, []); assert.ok(result.coverage.gaps.some(gap => gap.source === 'human actions'));
  assert.equal(result.changes[0].kind, 'commit'); assert.doesNotMatch(result.changes[0].title, /Draft safely/);
});

test('milestones preserve external authority and unavailable issue permission without reading archived plans', async () => {
  const h = projectHarness();
  h.source.files['.keel/keel.json'] = JSON.stringify({ name: 'Acme Studio', phases: { source: 'milestones' } });
  const result = await home(h)(h.access, token), plan = result.projects[0].planning;
  assert.equal(plan.source, 'milestones'); assert.equal(plan.built, null); assert.equal(plan.total, null);
  assert.deepEqual(result.decisions, []); assert.deepEqual(result.walks, []);
  assert.match(result.coverage.gaps.find(g => g.source === 'milestones').reason, /archived local phases are not substituted/);
  assert.equal(h.source.requests.filter(r => r.url.includes('/git/blobs/')).length, 1);
});

test('cache-only HTML is loading; independent JSON readers share cache, leases and unchanged cursors', async () => {
  const h = projectHarness(), read = home(h);
  const loading = await read(h.access, token, { cacheOnly: true });
  assert.equal(loading.projects[0].state, 'loading'); assert.equal(h.source.requests.length, 0);
  const first = await read(h.access, token), calls = h.source.requests.length;
  const second = await home(h)(h.access, token, { since: first.cursor });
  assert.equal(second.cursorState, 'current'); assert.equal(second.cursor, first.cursor); assert.equal(h.source.requests.length, calls);
  h.state.now += 61000;
  const checked = await read(h.access, token, { fresh: true, since: first.cursor });
  assert.equal(checked.cursor, first.cursor, 'read timestamp and quota observations do not invent new content');
  assert.equal(h.source.requests.length, calls + 2, 'unchanged revision skips repeated blob reads');
  const gap = await read(h.access, token, { since: 'f'.repeat(64) }); assert.equal(gap.cursorState, 'gap');
});

test('failed refresh retains the last successful value with stale coverage; revoked access cannot fall back to cache', async () => {
  const h = projectHarness(), read = home(h), first = await read(h.access, token);
  h.state.now += 61000; h.source.fail = true;
  const stale = await read(h.access, token, { fresh: true, since: first.cursor });
  assert.equal(stale.projects[0].state, 'stale'); assert.equal(stale.decisions[0].id, first.decisions[0].id);
  assert.equal(stale.projects[0].readAt, first.projects[0].readAt); assert.ok(stale.coverage.gaps.some(g => g.source === 'refresh'));
  assert.doesNotMatch(JSON.stringify(stale), /fake-private-provider-error/);
  h.source.fail = false; h.source.denied = true; h.state.now += 61000;
  await assert.rejects(read(h.access, token, { fresh: true }), error => error.status === 401);
});

test('cache keys separate users and authorization revisions, expiration and unknown quota remain explicit', async () => {
  const h = projectHarness(), read = home(h); await read(h.access, token);
  const other = await read({ ...h.access, userId: 2 }, token, { cacheOnly: true }); assert.equal(other.projects[0].state, 'loading');
  const changed = await read({ ...h.access, sourceRevision: 'e'.repeat(40) }, token, { cacheOnly: true }); assert.equal(changed.projects[0].state, 'loading');
  h.state.now += 8 * 86400000;
  const expired = await read(h.access, token, { cacheOnly: true }); assert.equal(expired.projects[0].state, 'loading'); assert.equal(expired.quota.remaining, null); assert.equal(expired.quota.state, 'unavailable');
  const store = createHomeStore(h.config, h.fetcher);
  await store.observe(1, { remaining: 1000, reset: Math.floor(h.state.now / 1000) + 3600 });
  const limited = await read(h.access, token); assert.equal(limited.quota.state, 'saving'); assert.equal(limited.projects[0].state, 'unavailable'); assert.match(limited.projects[0].gaps[0].reason, /quota/);
});

test('truncated trees, malformed phase records and oversized input preserve gaps instead of empty success', async () => {
  const h = projectHarness(); h.source.treeTruncated = true;
  const truncated = await home(h)(h.access, token); assert.equal(truncated.coverage.state, 'unavailable'); assert.match(truncated.coverage.gaps[0].reason, /bound/);
  const bad = projectHarness(); bad.source.files['docs/phases/01-first.md'] = 'malformed';
  const result = await home(bad)(bad.access, token); assert.equal(result.coverage.state, 'partial'); assert.equal(result.projects[0].sourceComplete, false); assert.deepEqual(result.decisions, []);
  const huge = projectHarness(); huge.source.files['.keel/keel.json'] = 'x'.repeat(140000);
  const oversized = await home(huge)(huge.access, token); assert.equal(oversized.projects[0].state, 'unavailable'); assert.match(oversized.projects[0].gaps[0].reason, /bound/);
});

test('two clients share one refresh lease, and session renewal stays usable concurrently', async () => {
  const h = projectHarness(); let release; h.source.hold = new Promise(resolve => { release = resolve; });
  let entered; const ready = new Promise(resolve => { entered = resolve; });
  const fetcher = async (url, options) => { if (new URL(url).pathname === '/repositories/102') entered(); return h.fetcher(url, options); };
  const first = createHomeReader(h.config, { fetcher, now: () => h.state.now })(h.access, token);
  await ready;
  const second = await home(h)(h.access, token); assert.equal(second.projects[0].state, 'loading'); assert.match(second.projects[0].gaps[0].reason, /progress/);
  release(); await first;
  assert.equal(h.source.requests.filter(r => new URL(r.url).pathname === '/repositories/102').length, 1);
  h.source.hold = null;
  const signed = await h.login();
  const statuses = await Promise.all([h.service, h.makeService()].map(service => service(h.request('/api/home', { cookie: signed.cookie })).then(r => r.status)));
  assert.deepEqual(statuses, [200,200]);
});

test('Home routes enforce fresh access, conditional responses, cursor/query bounds and read-only methods', async () => {
  const h = projectHarness(), signed = await h.login();
  for (const path of ['/api/home', '/api/projects/studio/home']) assert.equal((await h.service(h.request(path))).status, 401);
  const html = await h.service(h.request('/', { cookie: signed.cookie })); assert.equal(html.status, 200); assert.match(await html.text(), /loading/i); assert.equal(h.source.requests.length, 0);
  const response = await h.service(h.request('/api/home', { cookie: signed.cookie })); assert.equal(response.status, 200); const snapshot = await response.json();
  const unchanged = await h.service(h.request(`/api/home?cursor=${snapshot.cursor}`, { cookie: signed.cookie, headers: { 'if-none-match': response.headers.get('etag') } })); assert.equal(unchanged.status, 304);
  for (const path of ['/api/home?cursor=secret', '/api/home?fresh=yes', '/api/home?cursor=x&cursor=y', '/api/home?project=secret']) assert.equal((await h.service(h.request(path, { cookie: signed.cookie }))).status, 400);
  assert.equal((await h.service(h.request('/api/projects/secret/home', { cookie: signed.cookie }))).status, 404);
  assert.equal((await h.service(h.request('/api/home', { cookie: signed.cookie, method: 'POST', headers: { origin: h.config.origin } }))).status, 404);
  h.state.members = [];
  const denied = await h.service(h.request('/api/home', { cookie: signed.cookie })); assert.equal(denied.status, 404); assert.doesNotMatch(await denied.text(), /Acme Studio|sourceRevision/);
});

test('fleet refresh prioritizes never-attempted projects ahead of repeated failures', async () => {
  const h = projectHarness(), projects = Array.from({ length: 6 }, (_, i) => ({ id: `app${i}`, repoId: 200 + i, repo: `acme/app${i}` }));
  const seen = [];
  const fetcher = async (url, options) => {
    const u = new URL(url), id = /^\/repositories\/(2\d\d)$/.exec(u.pathname), repo = /^\/repos\/acme\/app(\d+)\//.exec(u.pathname);
    if (!id && !repo) return h.fetcher(url, options);
    const index = id ? Number(id[1]) - 200 : Number(repo[1]); seen.push(index);
    if (index < 4) return new Response('{}', { status: 500 });
    if (id) return Response.json({ id: 200 + index, full_name: `acme/app${index}`, default_branch: 'main' });
    u.pathname = u.pathname.replace(`/acme/app${index}/`, '/acme/studio/');
    return h.fetcher(u.href, options);
  };
  const access = { ...h.access, projects }, read = createHomeReader(h.config, { fetcher, now: () => h.state.now });
  const first = await read(access, token);
  assert.deepEqual([...new Set(seen)], [0,1,2,3]); assert.equal(first.projects[4].state, 'loading');
  h.state.now += 61000; seen.length = 0;
  const second = await read(access, token);
  assert.deepEqual([...new Set(seen)].slice(0, 2), [4,5]);
  assert.equal(second.projects[4].planning.total, 4); assert.equal(second.projects[5].planning.total, 4);
});

test('a failed slow first project yields to healthy sources, and fleet cache reads are bounded parallel', async () => {
  const h = projectHarness(), projects = Array.from({ length: 6 }, (_, i) => ({ id: `app${i}`, repoId: 200 + i, repo: `acme/app${i}` }));

  let active = 0, peak = 0, healthyDuringSlow = false, slow = false;
  const fetcher = async (url, options) => {
    const u = new URL(url);
    if (u.pathname.endsWith('keel_home_cache_rpc') && JSON.parse(options.body).p_operation === 'read') {
      active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); active--;
    }
    const id = /^\/repositories\/(2\d\d)$/.exec(u.pathname), repo = /^\/repos\/acme\/app(\d+)\//.exec(u.pathname);
    if (!id && !repo) return h.fetcher(url, options);
    const index = id ? Number(id[1]) - 200 : Number(repo[1]);
    if (id && index === 0) { slow = true; await new Promise(resolve => setTimeout(resolve, 5)); return new Response('{}', { status: 500 }); }
    if (id && index === 1) { healthyDuringSlow = slow; }
    if (id) return Response.json({ id: 200 + index, full_name: `acme/app${index}`, default_branch: 'main' });
    u.pathname = u.pathname.replace(`/acme/app${index}/`, '/acme/studio/'); return h.fetcher(u.href, options);
  };
  const read = createHomeReader(h.config, { fetcher, now: () => h.state.now }), access = { ...h.access, projects };
  await read(access, token, { cacheOnly: true }); assert.ok(peak > 1 && peak <= 8);
  const result = await read(access, token);
  assert.equal(healthyDuringSlow, true); assert.equal(result.projects[1].planning.total, 4);
  h.state.now += 61000;
  const later = await read(access, token); assert.equal(later.projects[4].planning.total, 4); assert.equal(later.projects[5].planning.total, 4);
});

test('reader version namespaces old caches and malformed cached models are reread at the same HEAD', async () => {
  const h = projectHarness(), read = home(h), first = await read(h.access, token);
  const store = createHomeStore(h.config, h.fetcher), currentKey = [...h.state.homeDatabase.cache.keys()][0];
  const oldScope = hash(JSON.stringify({ source: h.access.sourceRevision, projects: h.access.projects }));
  assert.notEqual(currentKey, store.keyFor(h.access.userId, 102, oldScope));
  h.state.now += 61000;
  const lease = 'a'.repeat(64); await store.claim(currentKey, lease);
  await store.finish(currentKey, lease, { ...first.projects[0], planning: null });
  const broken = await read(h.access, token, { cacheOnly: true }); assert.equal(broken.projects[0].state, 'loading');
  h.state.now += 61000; const calls = h.source.requests.length;
  const repaired = await read(h.access, token); assert.equal(repaired.projects[0].planning.total, 4);
  assert.ok(h.source.requests.length > calls + 2, 'invalid model never takes the same-revision shortcut');
});

test('four 109-phase projects converge under the shared 200-request bound', async () => {
  const h = projectHarness();
  for (const path of Object.keys(h.source.files)) if (path.startsWith('docs/phases/')) delete h.source.files[path];
  for (let i = 0; i < 109; i++) h.source.files[`docs/phases/${String(i).padStart(3,'0')}-acme.md`] = phaseFile(i, { status: 'built' });
  const projects = Array.from({ length: 4 }, (_, i) => ({ id: `app${i}`, repoId: 200 + i, repo: `acme/app${i}` }));
  let calls = 0;
  const fetcher = async (url, options) => {
    const u = new URL(url), id = /^\/repositories\/(2\d\d)$/.exec(u.pathname), repo = /^\/repos\/acme\/app(\d+)\//.exec(u.pathname);
    if (!id && !repo) return h.fetcher(url, options);
    calls++; const index = id ? Number(id[1]) - 200 : Number(repo[1]);
    if (id) return Response.json({ id: 200 + index, full_name: `acme/app${index}`, default_branch: 'main' });
    u.pathname = u.pathname.replace(`/acme/app${index}/`, '/acme/studio/'); return h.fetcher(u.href, options);
  };
  let result;
  for (let attempt = 0; attempt < 4; attempt++) {
    calls = 0;
    result = await createHomeReader(h.config, { fetcher, now: () => h.state.now })({ ...h.access, projects }, token);
    assert.ok(calls <= 200, `attempt ${attempt} stayed inside its source budget`);
    assert.ok(result.projects.filter(p => p.sourceComplete).length >= attempt + 1, 'at least one whole project advances each pass');
    h.state.now += 61000;
  }
  assert.ok(result.projects.every(p => p.sourceComplete && p.planning.total === 109));
});

test('unchanged source HEAD reclassifies dated actions when the UTC day changes', async () => {
  const h = projectHarness(); h.state.now = Date.parse('2026-10-21T23:58:00Z');
  h.source.files['docs/phases/01-first.md'] = phaseFile(1, { next: '⚑ Choose the publishing policy.' }).replace('depends: []', 'after: 2026-10-22\ndepends: []');
  const read = home(h), before = await read(h.access, token);
  assert.ok(before.waiting.some(item => item.phase === '1')); assert.ok(!before.decisions.some(item => item.phase === '1'));
  h.state.now = Date.parse('2026-10-22T00:00:01Z');
  const after = await read(h.access, token);
  assert.equal(after.projects[0].revision, before.projects[0].revision);
  assert.ok(after.decisions.some(item => item.phase === '1')); assert.ok(!after.waiting.some(item => item.phase === '1'));
  assert.notEqual(after.cursor, before.cursor);
});

test('secondary rate limits preserve authorized cached data and durable Retry-After across instances', async () => {
  const h = projectHarness(), initial = await home(h)(h.access, token); h.state.now += 61000;
  let limited = true, calls = 0;
  const fetcher = async (url, options) => {
    if (new URL(url).pathname === '/repositories/102') {
      calls++;
      if (limited) return Response.json({ message: 'Synthetic secondary limit' }, { status: 403, headers: { 'retry-after': '180', 'x-ratelimit-remaining': '4500', 'x-ratelimit-reset': String(Math.floor(h.state.now / 1000) + 3600) } });
    }
    return h.fetcher(url, options);
  };
  const read = () => createHomeReader(h.config, { fetcher, now: () => h.state.now })(h.access, token, { fresh: true });
  const paused = await read(); assert.equal(paused.projects[0].state, 'stale'); assert.equal(paused.decisions[0].id, initial.decisions[0].id);
  assert.equal(paused.quota.state, 'saving'); assert.equal(paused.quota.remaining, 4500); assert.ok(paused.quota.blockedUntil);
  h.state.now += 61000; limited = false;
  const stillPaused = await read(); assert.equal(calls, 1); assert.equal(stillPaused.projects[0].state, 'stale');
  h.state.now += 121000;
  const resumed = await read(); assert.equal(calls, 2); assert.equal(resumed.projects[0].state, 'partial'); assert.equal(resumed.quota.blockedUntil, null);
});

test('ambiguous 403 without Retry-After preserves authorization and pauses optional reads for one minute', async () => {
  const h = projectHarness(), initial = await home(h)(h.access, token); h.state.now += 61000;
  let limited = true, calls = 0;
  const fetcher = async (url, options) => {
    if (new URL(url).pathname === '/repositories/102') {
      calls++;
      if (limited) return Response.json({ message: 'Synthetic secondary limit without retry header' }, { status: 403, headers: { 'x-ratelimit-remaining': '4500', 'x-ratelimit-reset': String(Math.floor(h.state.now / 1000) + 3600) } });
    }
    return h.fetcher(url, options);
  };
  const read = () => createHomeReader(h.config, { fetcher, now: () => h.state.now })(h.access, token, { fresh: true });
  const paused = await read(); assert.equal(paused.projects[0].state, 'stale'); assert.equal(paused.decisions[0].id, initial.decisions[0].id);
  assert.equal(paused.quota.state, 'saving'); assert.equal(Date.parse(paused.quota.blockedUntil), Math.ceil((h.state.now + 60000) / 1000) * 1000);
  assert.equal(paused.quota.remaining, 4500);
  h.state.now += 30000; limited = false;
  await read(); assert.equal(calls, 1);
  h.state.now += 31000;
  const resumed = await read(); assert.equal(calls, 2); assert.equal(resumed.projects[0].state, 'partial'); assert.equal(resumed.quota.blockedUntil, null);
});
