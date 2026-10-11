import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readMilestones, projectMilestones, milestoneNext, exitCriteria } from '../practices/night/files/scripts/keel/milestones.mjs';
import { rememberQuota } from '../lib/quota.mjs';
import { verbs } from '../lib/cli.mjs';
import { collect } from '../practices/phases/files/scripts/roadmap.mjs';
import { goalAdd, goalRetire, phaseNew } from '../lib/goals.mjs';
import { milestoneConfig as config, connection, milestone, issue, response } from './helpers/milestones.mjs';

async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), 'keel-milestone-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.keel'));
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify(config));
  return root;
}

test('milestone mapping preserves deadline, source closure, issue state and configured owner walk', () => {
  const data = projectMilestones(response([milestone(1, 'OPEN', [issue(1, 'CLOSED'), issue(2, 'OPEN', ['acme:owner'])]), milestone(2, 'CLOSED'), milestone(3, 'OPEN', [issue(3, 'CLOSED')])]), { ...config, phases: { source: 'milestones', ownerLabel: 'acme:owner' } });
  assert.deepEqual(data.phases.map(p => p.status), ['partial', 'closed', 'partial']);
  assert.equal(data.phases[0].boxes[1].walk, true);
  assert.equal(data.phases[0].done, '- Anvils land.');
  assert.equal(data.phases[0].due, '2026-12-01T00:00:00Z');
  assert.equal(data.phases[0].after, undefined);
  assert.deepEqual(data.phases[1].evidence, []);
  assert.equal(milestoneNext(data).id, 1);
  assert.equal(exitCriteria('Acme prose').doneFrom, 'description');
  assert.equal(exitCriteria('Acme\n- land').doneFrom, 'bullets');
});

test('malformed/error responses fail; complete empty and every truncation are distinct', () => {
  for (const bad of [{}, { data: { repository: null } }, { ...response(), errors: [{ message: 'denied' }] }]) assert.throws(() => projectMilestones(bad, config));
  assert.deepEqual(projectMilestones(response(), config).coverage, { complete: true, gaps: [] });
  const m = milestone(1, 'CLOSED', [issue(1)]);
  m.issues.pageInfo.hasNextPage = true;
  m.issues.nodes[0].labels.pageInfo.hasNextPage = true;
  const data = projectMilestones(response([m], true), config);
  assert.equal(data.coverage.complete, false);
  assert.equal(data.coverage.gaps.length, 3);
  assert.equal(milestoneNext(data), null);
  m.issues.nodes[0].labels = connection([null]);
  assert.throws(() => projectMilestones(response([m]), config));
});

test('bounded read uses shared ten-minute cache and quota floor; failed reads are never cached', async t => {
  const root = await scratch(t), env = { ...process.env, KEEL_CACHE: join(root, 'cache'), KEEL_GH: '/no-real-gh' };
  let reads = 0;
  const graphql = async ({ query }) => { reads++; assert.match(query, /milestones\(first:50/); assert.match(query, /issues\(first:50/); return response(); };
  const first = await readMilestones(config, { env, graphql, guard: async () => null });
  const second = await readMilestones(config, { env, graphql });
  assert.equal(first.github.cached, false); assert.equal(second.github.cached, true); assert.equal(reads, 1);
  await rememberQuota(env, { remaining: 2, resetAt: '2099-01-01T00:00:00Z' });
  await assert.rejects(readMilestones(config, { env, graphql, fresh: true }), /saving your GitHub quota/);
  assert.equal(reads, 1);
  await assert.rejects(readMilestones(config, { env, fresh: true, guard: async () => null, graphql: async () => ({ errors: [{ message: 'Acme failure' }] }) }), /Acme failure/);
  await readMilestones(config, { env, graphql, fresh: true, guard: async () => null });
  assert.equal(reads, 2);
});

test('CLI envelope never interprets truncated closed-only data as complete; local mutations refuse', async t => {
  const root = await scratch(t);
  // Seed the real shared cache; CLI uses that exact cache without any live read.
  await readMilestones(config, { env: process.env, fresh: true, guard: async () => null, graphql: async () => response([milestone(1, 'CLOSED')], true) });
  const ctx = { root: async () => root };
  for (const name of ['next', 'status', 'phase list']) {
    const r = await verbs.get(name).run([], ctx);
    assert.equal(r.data.source, 'milestones'); assert.equal(r.data.coverage.complete, false);
    assert.match(r.text, /coverage incomplete/);
  }
  const next = await verbs.get('next').run([], ctx);
  assert.equal(next.data.next, null); assert.match(next.text, /unknown/);
  for (const run of [() => goalAdd({ root, title: 'Acme', outcome: 'Land' }), () => goalRetire({ root, id: 'G0', reason: 'Acme' }), () => phaseNew({ root, title: 'Acme', goal: 'G0' }), () => collect(root)]) await assert.rejects(run(), /read-only/);
});

test('installed standalone night reads milestones without a Keel checkout and reports incomplete or unavailable honestly', async t => {
  const root = await scratch(t);
  await cp(resolve('practices/night/files/scripts/keel'), join(root, 'scripts/keel'), { recursive: true });
  const { MEASURES, measure } = await import(pathToFileURL(join(root, 'scripts/keel/improve.mjs')).href);
  const selected = MEASURES.filter(m => ['phases_without_issue', 'phases_stuck', 'roadmap_stale', 'proofs_hold'].includes(m.id));
  const env = { ...process.env, KEEL_CACHE: join(root, 'cache'), KEEL_GH: '/no-real-gh' };
  await readMilestones(config, { env, guard: async () => null, graphql: async () => response([milestone(1, 'OPEN', [issue(1)]), milestone(2, 'CLOSED')]) });
  const results = await measure({ root, config, env, measures: selected });
  const rows = Array.isArray(results) ? results : results.results;
  assert.equal(rows.find(r => r.id === 'phases_without_issue').value, 0);
  assert.match(rows.find(r => r.id === 'phases_stuck').detail, /not status age/);
  assert.equal(rows.find(r => r.id === 'proofs_hold').state, 'n/a');
  await rm(join(root, 'cache'), { recursive: true, force: true });
  const broken = await measure({ root, config, env, measures: selected.slice(0, 2) });
  const failures = Array.isArray(broken) ? broken : broken.results;
  assert.ok(failures.some(r => r.state === 'broken'));
});

test('GraphQL errors still account observed cost and stop the next read below the quota floor', async t => {
  const root = await scratch(t), env = { ...process.env, KEEL_CACHE: join(root, 'cache'), KEEL_GH: '/no-real-gh' };
  const spend = { cost: 0, queries: 0, remaining: null, resetAt: null };
  await rememberQuota(env, { remaining: 1001, resetAt: '2099-01-01T00:00:00Z' });
  let calls = 0;
  const graphql = async () => {
    calls++;
    return { data: { rateLimit: { cost: 26, remaining: 975, resetAt: '2099-01-01T00:00:00Z' } }, errors: [{ message: 'Acme denied' }] };
  };
  await assert.rejects(readMilestones(config, { env, graphql, spend }), /Acme denied/);
  assert.equal(spend.cost, 26); assert.equal(spend.queries, 1); assert.equal(spend.remaining, 975);
  await assert.rejects(readMilestones(config, { env, graphql }), /saving your GitHub quota \(975/);
  assert.equal(calls, 1);
});

test('owner labels that sanitize alike never reuse each other’s cached walk projection', async t => {
  const root = await scratch(t), env = { ...process.env, KEEL_CACHE: join(root, 'cache'), KEEL_GH: '/no-real-gh' };
  let calls = 0;
  const graphql = async () => { calls++; return response([milestone(1, 'OPEN', [issue(1, 'OPEN', ['team:owner'])])]); };
  const read = ownerLabel => readMilestones({ ...config, phases: { source: 'milestones', ownerLabel } }, { env, graphql, guard: async () => null });
  assert.equal((await read('team:owner')).phases[0].boxes[0].walk, true);
  assert.equal((await read('team/owner')).phases[0].boxes[0].walk, false);
  assert.equal((await read('team:owner')).github.cached, true);
  assert.equal(calls, 2);
});

test('a nonzero gh GraphQL response still remembers its validated quota and never succeeds', async t => {
  const root = await scratch(t), stub = join(root, 'gh.mjs');
  const body = { data: { rateLimit: { cost: 26, remaining: 975, resetAt: '2099-01-01T00:00:00Z' } }, errors: [{ message: 'Acme denied' }] };
  await writeFile(stub, `#!${process.execPath}\nconsole.log(${JSON.stringify(JSON.stringify(body))}); console.error('Acme denied'); process.exitCode = 1;\n`, { mode: 0o755 });
  const env = { ...process.env, KEEL_CACHE: join(root, 'cache'), KEEL_GH: stub };
  await rememberQuota(env, { remaining: 1001, resetAt: '2099-01-01T00:00:00Z' });
  await assert.rejects(readMilestones(config, { env }), /Acme denied/);
  await assert.rejects(readMilestones(config, { env }), /saving your GitHub quota \(975/);
});
