import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { run as runProcess } from './helpers/run.mjs';
import { render, load } from '../lib/practices.mjs';
import { survey } from '../lib/adopt.mjs';
import { withLedger } from '../migrations/0004-test-ledger.mjs';
import { phaseZero } from '../lib/init.mjs';
import { collect, run } from '../practices/phases/files/scripts/roadmap.mjs';
import { generatedFiles } from '../practices/phases/files/scripts/keel/generated.mjs';
import { projectMilestones } from '../practices/night/files/scripts/keel/milestones.mjs';
import { milestoneConfig, milestone, response } from './helpers/milestones.mjs';

async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), 'acme-milestone-surfaces-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, '.keel'));
  return root;
}
async function archive(root) {
  const paths = ['docs/goals.json', 'docs/ROADMAP.md', ...(await readdir(join(root, 'docs/phases'))).map(n => `docs/phases/${n}`)];
  return Object.fromEntries(await Promise.all(paths.map(async p => [p, await readFile(join(root, p), 'utf8')])));
}

test('normal seeded project full gate stays active after milestone switch and leaves archive and package untouched', async t => {
  const root = await scratch(t);
  const config = { name: 'Acme', tagline: 'Acme ships anvils.', repo: 'acme/anvils', practices: ['base', 'agents-md', 'phases', 'evidence', 'lessons', 'conduct', 'ci', 'night', 'renovate'] };
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify(config));
  await render(root);
  // Match init's normal test-ledger wiring before capturing project-owned bytes.
  const pkgPath = join(root, 'package.json');
  const pkg = JSON.parse(await readFile(pkgPath, 'utf8'));
  pkg.scripts.test = withLedger(pkg.scripts.test);
  await writeFile(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  const template = await readFile(join(root, 'docs/templates/phase.md'), 'utf8');
  await writeFile(join(root, 'docs/phases/00-acme.md'), phaseZero(template, { name: 'Acme', kind: 'node', since: '2026-10-10' }));
  await run({ root });
  // An ordinary project test must still run, including its failure path.
  await writeFile(join(root, 'tests/acme.test.mjs'), `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('Acme code runs', () => assert.equal(process.env.ACME_FAIL, undefined));\n`);
  await writeFile(join(root, 'package-lock.json'), '{"name":"acme","lockfileVersion":3}\n');
  const packages = await Promise.all(['package.json', 'package-lock.json'].map(p => readFile(join(root, p), 'utf8')));
  const before = await archive(root);
  const gate = extra => runProcess('npm', ['run', 'check'], { cwd: root, env: { ...process.env, ...extra }, timeout: 120000 });
  const local = gate();
  assert.equal(local.status, 0, local.stdout + local.stderr);
  config.phases = { source: 'milestones' };
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify(config));
  const remote = gate();
  assert.equal(remote.status, 0, remote.stdout + remote.stderr);
  assert.match(remote.stdout, /Acme code runs/);
  assert.match(remote.stdout, /inactive.*milestones/i);
  assert.match(remote.stdout, /keel test ledger: no flaky or slower test/);
  assert.deepEqual(await archive(root), before);
  assert.deepEqual(await Promise.all(['package.json', 'package-lock.json'].map(p => readFile(join(root, p), 'utf8'))), packages);
  const broken = gate({ ACME_FAIL: 'yes' });
  assert.notEqual(broken.status, 0, 'source selection must not disable the project code tests');
  assert.match(broken.stdout, /Acme code runs/);
  assert.deepEqual(await archive(root), before);
});

test('milestone check bypasses malformed archived inputs; local readers and writers still refuse', async t => {
  const root = await scratch(t);
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify(milestoneConfig));
  await mkdir(join(root, 'docs/phases'), { recursive: true });
  await writeFile(join(root, 'docs/goals.json'), 'archived, not JSON');
  await writeFile(join(root, 'docs/phases/01-acme.md'), 'archived, not a phase');
  await writeFile(join(root, 'docs/ROADMAP.md'), 'Acme archived roadmap');
  const before = await archive(root);
  assert.match(await run({ root, mode: 'check' }), /inactive.*milestones/i);
  await assert.rejects(collect(root), /read-only/);
  for (const mode of ['write', 'next', 'json']) await assert.rejects(run({ root, mode }), /read-only/);
  assert.deepEqual(await archive(root), before);
  const paths = generatedFiles({ ...milestoneConfig, practices: ['phases', 'loop'] }).map(g => g.path);
  assert.deepEqual(paths, [], 'the inactive roadmap and Loop page are excluded');
});

test('empty milestone descriptions keep readable records but disclose missing exit criteria', () => {
  const nodes = [milestone(1), ...[null, '', ' \n\t '].map((description, i) => ({ ...milestone(i + 2), description }))];
  const data = projectMilestones(response(nodes), milestoneConfig);
  assert.equal(data.phases.length, 4);
  assert.equal(data.phases[0].done, '- Anvils land.');
  assert.equal(data.coverage.complete, false);
  assert.deepEqual(data.coverage.gaps, [2, 3, 4].map(n => `milestone ${n} missing exit criteria: description is empty`));
  for (const p of data.phases.slice(1)) {
    assert.equal(p.done, '');
    assert.equal(p.readOnly, true);
    assert.equal(p.sourceState, 'OPEN');
  }
});

test('adoption can select mixed described and empty milestones while preserving coverage gaps', async t => {
  const root = await scratch(t);
  await writeFile(join(root, '.keel/keel.json'), JSON.stringify({ name: 'Acme', repo: 'acme/anvils' }));
  const packageText = JSON.stringify({ name: 'acme', scripts: { test: 'node --test' } });
  await writeFile(join(root, 'package.json'), packageText);
  const result = await survey(root, {
    version: { cli: '0.0.0', practice: '0.0.0', commit: 'acme' }, practices: await load(), discoverMilestones: true,
    milestoneRead: async () => projectMilestones(response([milestone(1), { ...milestone(2), description: null }]), milestoneConfig),
  });
  assert.equal(result.config.phases.source, 'milestones');
  assert.equal(result.milestoneDiscovery.state, 'partial');
  assert.deepEqual(result.milestoneDiscovery.coverage.gaps, ['milestone 2 missing exit criteria: description is empty']);
  assert.equal(await readFile(join(root, 'package.json'), 'utf8'), packageText);
});
