import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run } from './helpers/run.mjs';
import { milestoneConfig, milestone, response } from './helpers/milestones.mjs';
import { readMilestones } from '../practices/night/files/scripts/keel/milestones.mjs';
import { rememberQuota, lastQuota } from '../lib/quota.mjs';
import { rateSpend } from '../practices/night/files/scripts/keel/lib.mjs';
import { MEASURES, measure, propose, page } from '../practices/night/files/scripts/keel/improve.mjs';
import { looseItems } from '../lib/board.mjs';

const cli = resolve('bin/keel.mjs');
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'acme-consumer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const env = { ...process.env, KEEL_CACHE: join(root, 'cache'), KEEL_GH: '/no-real-gh', KEEL_CLAUDE_DIR: join(root, 'claude'), KEEL_QUOTA_FLOOR: '1000' };
  delete env.KEEL_MILESTONES_OFFLINE;
  await mkdir(join(root, '.keel'));
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify(milestoneConfig));
  return { root, env };
}
const charged = (remaining = 994) => {
  const r = response([milestone()]);
  r.data.rateLimit = { ...r.data.rateLimit, cost: 7, remaining };
  return r;
};

for (const failure of [false, true]) for (const tally of [false, true]) test(`concurrent milestone projects see the previous charge (rejected=${failure}, tally=${tally})`, async t => {
  const { env } = await fixture(t), spend = tally ? rateSpend() : undefined;
  await rememberQuota(env, { remaining: 1001, resetAt: '2099-01-01T00:00:00Z' });
  let calls = 0;
  const graphql = async () => {
    calls++;
    const r = charged();
    if (failure) r.errors = [{ message: 'Acme denied' }];
    return r;
  };
  const results = await Promise.allSettled(['anvils', 'rockets', 'skates'].map(name =>
    readMilestones({ ...milestoneConfig, repo: `acme/${name}` }, { env: { ...env }, spend, graphql })));
  assert.equal(calls, 1, 'only the first query may spend across the floor');
  assert.equal(results.filter(r => r.status === 'fulfilled').length, failure ? 0 : 1);
  assert.equal(results.filter(r => r.reason?.saving).length, 2);
  if (spend) { assert.equal(spend.cost, 7); assert.equal(spend.queries, 1); assert.equal(spend.remaining, 994); }
  assert.equal((await lastQuota(env)).remaining, 994);
});

test('rejected guards and queries release the queue; unknown quota remains unknown', { timeout: 5000 }, async t => {
  const { env } = await fixture(t), spend = rateSpend();
  const results = await Promise.allSettled([
    readMilestones(milestoneConfig, { env, spend, guard: async () => { throw new Error('Acme guard failed'); } }),
    readMilestones(milestoneConfig, { env, spend, graphql: async () => { throw new Error('Acme transport failed'); } }),
    readMilestones(milestoneConfig, { env, spend, graphql: async () => ({ errors: [{ message: 'Acme unknown charge' }] }) }),
  ]);
  assert.deepEqual(results.map(r => r.reason.message), ['Acme guard failed', 'Acme transport failed', 'GitHub milestones: Acme unknown charge']);
  assert.deepEqual(spend.toJSON(), { cost: 0, queries: 0, remaining: null, resetAt: null });
  assert.equal(await lastQuota(env), null);
  const recovered = await readMilestones(milestoneConfig, { env, spend, graphql: async () => charged(3000) });
  assert.equal(recovered.github.queries, 1); assert.equal(spend.queries, 1);
});

test('concurrent identical reads reuse cache; cached milestones bypass the quota guard', async t => {
  const { env } = await fixture(t);
  let calls = 0, guards = 0;
  const options = { env, guard: async () => { guards++; return null; }, graphql: async () => { calls++; return charged(); } };
  const results = await Promise.all([readMilestones(milestoneConfig, options), readMilestones(milestoneConfig, options)]);
  assert.equal(calls, 1); assert.equal(guards, 1);
  assert.deepEqual(results.map(r => r.github.cached), [false, true]);
  const cached = await readMilestones(milestoneConfig, { ...options, guard: async () => { throw new Error('cache must bypass guard'); } });
  assert.equal(cached.github.cost, 0); assert.equal(cached.github.queries, 0);
  await assert.rejects(readMilestones(milestoneConfig, { env, fresh: true, graphql: options.graphql }), /saving your GitHub quota/);
  assert.equal(calls, 1);
});

test('loose-ends fleet CLI permits only one near-floor milestone query', async t => {
  const { root, env } = await fixture(t);
  const home = join(root, 'home');
  await mkdir(join(home, '.keel'), { recursive: true });
  await writeFile(join(home, '.keel/keel.json'), JSON.stringify({ name: 'Acme home', practices: [] }));
  const names = ['anvils', 'rockets', 'skates'];
  for (const name of names) {
    const dir = join(root, name);
    await mkdir(join(dir, '.keel'), { recursive: true });
    await writeFile(join(dir, '.keel/keel.json'), JSON.stringify({ ...milestoneConfig, repo: `acme/${name}` }));
    for (const args of [['init'], ['remote', 'add', 'origin', `https://github.com/acme/${name}.git`]]) {
      const r = run('git', args, { cwd: dir, env }); assert.equal(r.status, 0, r.stderr);
    }
  }
  await writeFile(join(home, 'fleet.json'), JSON.stringify(names.map(name => ({ repo: `acme/${name}`, role: 'managed' }))));
  const log = join(root, 'calls');
  env.KEEL_GH = join(root, 'gh');
  await writeFile(env.KEEL_GH, `#!${process.execPath}
import { appendFileSync } from 'node:fs';
if (process.argv.some(a => a.includes('openMilestones:'))) {
  appendFileSync(${JSON.stringify(log)}, 'query\\n');
  console.log(${JSON.stringify(JSON.stringify(charged()))});
} else process.exit(1);
`, { mode: 0o755 });
  await rememberQuota(env, { remaining: 1001, resetAt: '2099-01-01T00:00:00Z' });
  const r = run(process.execPath, [cli, 'loose-ends', '--json'], { cwd: home, env });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(await readFile(log, 'utf8'), 'query\n');
  assert.equal(data.github.queries, 1); assert.equal(data.github.cost, 7); assert.equal(data.github.remaining, 994);
  const gaps = data.projects.flatMap(p => p.items).filter(i => i.kind === 'gap');
  assert.equal(gaps.length, 2);
  assert.ok(gaps.every(i => /saving your GitHub quota/.test(i.detail)));
});

test('night proposal and health page assign issues to GitHub milestones', async t => {
  const { root, env } = await fixture(t);
  const config = { ...milestoneConfig, phases: { source: 'milestones', shape: 'projects' } };
  const results = await measure({ root, env, config, measures: MEASURES.filter(m => m.id === 'phases_without_issue'),
    keel: { milestones: { guard: async () => null, graphql: async () => response([milestone(3), milestone(7), milestone(9, 'CLOSED')]) } } });
  assert.equal(results[0].state, 'outside');
  assert.deepEqual(results[0].facts.ids, [3, 7]);
  const proposal = propose(results, config);
  const rendered = page({ config, date: '2026-10-11', results, proposal, tightened: [] });
  for (const text of [proposal.text, rendered]) {
    assert.match(text, /Create issues on acme\/anvils and assign them to GitHub milestones #3, #7/);
    assert.doesNotMatch(text, /front matter|`issue:`/);
  }
});

for (const unavailable of [false, true]) test(`loose-ends CLI gaps render without an invented move (${unavailable})`, async t => {
  const { root, env } = await fixture(t);
  if (!unavailable) await readMilestones(milestoneConfig, { env, guard: async () => null, graphql: async () => response([], { open: true }) });
  const invoke = (...args) => run(process.execPath, [cli, 'loose-ends', ...args], { cwd: root, env });
  const text = invoke();
  assert.equal(text.status, 0, text.stdout + text.stderr);
  assert.match(text.stdout, unavailable ? /Milestones unavailable/ : /Milestone coverage incomplete/);
  assert.doesNotMatch(text.stdout, /undefined|→/);
  const json = invoke('--json'); assert.equal(json.status, 0, json.stdout + json.stderr);
  const data = JSON.parse(json.stdout), gaps = data.projects.flatMap(p => p.items).filter(i => i.kind === 'gap');
  assert.equal(gaps.length, 1); assert.equal(gaps[0].move, undefined); assert.deepEqual(gaps[0].commands, []);
  const boardGaps = looseItems(data).filter(i => i.waits === 'broken');
  assert.equal(boardGaps.length, 1); assert.deepEqual(boardGaps[0].actions, []);
});
