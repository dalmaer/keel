import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from './helpers/run.mjs';
import { milestoneConfig, milestone, issue, response } from './helpers/milestones.mjs';
import { projectMilestones, readMilestones } from '../practices/night/files/scripts/keel/milestones.mjs';
import { board, looseItems } from '../lib/board.mjs';
import { phaseZero } from '../lib/init.mjs';
import { render } from '../lib/practices.mjs';

const cli = resolve('bin/keel.mjs');
async function fixture(t, config = milestoneConfig) {
  const root = await mkdtemp(join(tmpdir(), 'acme-review-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.keel'));
  const setConfig = c => writeFile(join(root, '.keel/keel.json'), JSON.stringify(c));
  await setConfig(config);
  const env = { ...process.env, KEEL_CACHE: join(root, 'cache'), KEEL_GH: join(root, 'gh'), KEEL_CLAUDE_DIR: join(root, 'claude') };
  const log = join(root, 'calls');
  await writeFile(log, '');
  await writeFile(env.KEEL_GH, `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(log)}, 'called\\n'); process.exit(1);\n`, { mode: 0o755 });
  const invoke = (...args) => run(process.execPath, [cli, ...args, '--json'], { cwd: root, env });
  return { root, env, log, setConfig, invoke };
}
const deps = env => ({ env, reviews: async () => ({ items: [] }), fleet: async () => ({ repos: [] }), robotStatus: async () => ({ policy: { enabled: false }, budget: { state: 'off' } }) });

test('unknown ownership stays unavailable on board; only observed owner labels create human tasks', async t => {
  const f = await fixture(t);
  for (const [labelMore, issueMore, labels, expected] of [
    [true, false, [], 'broken'], [false, true, [], 'broken'],
    [true, true, ['keel:owner'], 'broken'], [true, false, ['keel:owner'], 'owner'],
    [false, false, [], 'agent'],
  ]) {
    const m = milestone(1, 'OPEN', [issue(1, 'OPEN', labels)]);
    m.issues.nodes[0].labels.pageInfo.hasNextPage = labelMore;
    m.issues.pageInfo.hasNextPage = issueMore;
    const projection = projectMilestones(response([m]), milestoneConfig);
    const result = await board({ root: f.root }, { ...deps(f.env), roadmap: async () => projection, looseEnds: async () => ({ projects: [] }) });
    const items = result.items.filter(i => i.source === 'milestones');
    assert.ok(items.some(i => i.waits === expected), JSON.stringify(items));
    if (expected === 'broken') {
      assert.ok(!items.some(i => i.waits === 'agent'));
      assert.match(items.find(i => i.waits === 'broken').why, /Ownership unavailable/);
    }
    assert.equal(items.filter(i => i.waits === 'owner').length, labels.length);
    assert.ok(items.every(i => i.actions.length === 0));
    if (expected === 'broken') {
      const fleetItems = looseItems({ projects: [{ repo: 'acme/anvils', items: [{ kind: 'gap', detail: projection.coverage.gaps.join('; ') }] }] });
      assert.equal(fleetItems[0].waits, 'broken');
    }
  }
  const m = milestone(1, 'OPEN', [issue(1)]);
  delete m.issues.nodes[0].labels;
  const result = await board({ root: f.root }, { ...deps(f.env), milestones: async () => response([m]), milestoneGuard: async () => null, looseEnds: async () => ({ projects: [] }) });
  assert.ok(!result.items.some(i => i.source === 'milestones' && i.waits === 'agent'));
  assert.match(result.sources.find(s => s.source === 'roadmap').why, /malformed .*labels/);
});

test('invalid owner labels fail before cache, quota, query or spend, including null', async t => {
  const f = await fixture(t);
  for (const ownerLabel of [null, '', ' \t', false, 42, [], {}]) {
    let calls = 0;
    const spend = { cost: 0, queries: 0 };
    await assert.rejects(readMilestones({ ...milestoneConfig, phases: { source: 'milestones', ownerLabel } }, {
      env: f.env, spend, guard: async () => { calls++; throw new Error('quota reached'); }, graphql: async () => { calls++; return response(); },
    }), /phases.ownerLabel/);
    assert.equal(calls, 0); assert.deepEqual(spend, { cost: 0, queries: 0 });
  }
  assert.ok(!(await readdir(f.root)).includes('cache'));
});

test('actual CLI consumer boundaries reject unsupported sources and invalid owner labels without writes or GitHub', async t => {
  const f = await fixture(t);
  await mkdir(join(f.root, 'docs/phases'), { recursive: true });
  await writeFile(join(f.root, 'docs/goals.json'), '[]\n');
  await writeFile(join(f.root, 'docs/ROADMAP.md'), 'Acme archive\n');
  const commands = [ ['next'], ['status'], ['phase', 'list'], ['goal', 'list'], ['goal', 'show', 'G0'],
    ['phase', 'new', 'Acme', '--goal', 'G0'], ['goal', 'add', 'Acme', '--outcome', 'Land'],
    ['goal', 'retire', 'G0', '--reason', 'Acme'], ['walk', 'done', '1', '--note', 'Acme'],
    ['render'], ['doctor'], ['adopt', '--dry-run'], ['board'], ['loose-ends'] ];
  for (const phases of [ { source: 'milestone' }, { source: null }, { source: '' }, { source: false }, { source: [] }, { source: {} }, { source: 0 }, { source: 'files', ownerLabel: null }, { source: 'milestones', ownerLabel: '' }, null, [] ]) {
    const config = { ...milestoneConfig, phases };
    await f.setConfig(config);
    const before = await readFile(join(f.root, '.keel/keel.json'), 'utf8');
    for (const command of commands) {
      const result = f.invoke(...command);
      assert.notEqual(result.status, 0, `${command}: ${result.stdout}`);
      assert.match(JSON.parse(result.stdout).error, /phases(?:\.source|\.ownerLabel)? (?:must|is)/, `${command}: ${result.stdout}`);
    }
    assert.equal(await readFile(join(f.root, '.keel/keel.json'), 'utf8'), before);
    assert.equal(await readFile(join(f.root, 'docs/goals.json'), 'utf8'), '[]\n');
    assert.equal(await readFile(join(f.root, 'docs/ROADMAP.md'), 'utf8'), 'Acme archive\n');
    assert.deepEqual(await readdir(join(f.root, 'docs/phases')), []);
  }
  assert.equal(await readFile(f.log, 'utf8'), '');
});

test('shipped readers share the source contract; default and explicit files remain supported', async t => {
  const f = await fixture(t, { name: 'Acme', tagline: 'Anvils land.', practices: ['base', 'agents-md', 'phases', 'night'] });
  await render(f.root);
  const template = await readFile(join(f.root, 'docs/templates/phase.md'), 'utf8');
  await writeFile(join(f.root, 'docs/phases/00-acme.md'), phaseZero(template, { name: 'Acme', kind: 'node', since: '2026-10-10' }));
  // The standalone roadmap carries the same tiny validator: it also ships without night.
  const canonical = await readFile('practices/night/files/scripts/keel/planning-config.mjs', 'utf8');
  assert.ok((await readFile('practices/phases/files/scripts/roadmap.mjs', 'utf8')).includes(canonical));
  const roadmap = await import(pathToFileURL(join(f.root, 'scripts/roadmap.mjs')));
  const reader = await import(pathToFileURL(join(f.root, 'scripts/keel/milestones.mjs')));
  const generated = await import(pathToFileURL(join(f.root, 'scripts/keel/generated.mjs')));
  for (const config of [null, [], { phases: null }, { phases: [] }, ...[null, '', false, [], {}, 0, 'future'].map(source => ({ phases: { source } }))]) {
    await f.setConfig(config);
    assert.throws(() => reader.milestoneSource(config), /(?:config|phases)/);
    for (const mode of ['check', 'write', 'next', 'json']) await assert.rejects(roadmap.run({ root: f.root, mode }), /(?:config|phases)/);
    await assert.rejects(reader.milestonePlan(f.root, { env: f.env }), /(?:config|phases)/);
    await assert.rejects(reader.requireLocalPhases(f.root), /(?:config|phases)/);
    assert.throws(() => generated.generatedFiles(config), /(?:config|phases)/);
  }
  for (const phases of [undefined, {}, { source: 'files' }]) {
    await f.setConfig({ name: 'Acme', phases, practices: ['phases'] });
    assert.equal(await reader.milestonePlan(f.root), null);
    await reader.requireLocalPhases(f.root);
    assert.equal((await roadmap.collect(f.root)).phases.length, 1);
    assert.equal(f.invoke('phase', 'list').status, 0);
    assert.equal(f.invoke('status').status, 0);
  }
});

test('board fresh queries root milestones once and keeps exact query accounting', async t => {
  const f = await fixture(t);
  const source = response([milestone(1, 'OPEN', [issue(1, 'OPEN', ['keel:owner'])])]);
  source.data.rateLimit.cost = 7;
  await writeFile(f.env.KEEL_GH, `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';\nif (process.argv.includes('graphql')) { appendFileSync(${JSON.stringify(f.log)}, 'query\\n'); console.log(${JSON.stringify(JSON.stringify(source))}); } else process.exit(1);\n`, { mode: 0o755 });
  const { rememberQuota } = await import('../lib/quota.mjs');
  await rememberQuota(f.env, { remaining: 4000, resetAt: '2099-01-01T00:00:00Z' });
  for (const fresh of [true, false, true]) {
    const result = await board({ root: f.root }, { ...deps(f.env), fresh });
    assert.ok(result.items.some(i => i.title === 'Acme issue 1'));
    assert.equal(result.github.queries, fresh ? 1 : 0);
    assert.equal(result.github.cost, fresh ? 7 : 0);
    assert.ok(result.github.readAt);
  }
  assert.equal(await readFile(f.log, 'utf8'), 'query\nquery\n');
});

test('ownership projection does not reuse the old cache schema', async t => {
  const f = await fixture(t);
  const { createHash } = await import('node:crypto');
  const { githubRead } = await import('../lib/quota.mjs');
  const identity = createHash('sha256').update(JSON.stringify([milestoneConfig.repo, 'keel:owner'])).digest('hex');
  const old = projectMilestones(response([milestone(1)]), milestoneConfig);
  delete old.phases[0].ownershipComplete;
  await githubRead(f.env, `milestones-v4-${identity}`, async () => old, { guard: async () => null });
  let queries = 0;
  const m = milestone(1); m.issues.pageInfo.hasNextPage = true;
  const result = await readMilestones(milestoneConfig, { env: f.env, guard: async () => null, graphql: async () => { queries++; return response([m]); } });
  assert.equal(queries, 1); assert.equal(result.github.cached, false);
  assert.equal(result.phases[0].ownershipComplete, false);
});
