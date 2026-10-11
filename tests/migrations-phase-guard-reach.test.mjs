import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { collect, load, taken, view, anyPending } from '../lib/migrations.mjs';
import { render, practiceVersion } from '../lib/practices.mjs';
import { update } from '../lib/update.mjs';
import { run, cleanEnv } from './helpers/run.mjs';

const read = (root, path) => readFile(join(root, path), 'utf8');
async function put(root, path, content) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
}
async function scratch(t) {
  const root = await mkdtemp(join(tmpdir(), 'keel-phase-guard-acme-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function git(root, ...args) {
  const result = run('git', ['-C', root, ...args]);
  assert.equal(result.status, 0, result.stderr);
}
const save = root => { git(root, 'add', '-A'); git(root, 'commit', '-qm', 'Acme source transition'); };

test('0007 survives a files/milestones/files roundtrip after 0005 is recorded, and the repaired gate catches a broken generator', async t => {
  const root = await scratch(t), version = practiceVersion(), all = await load();
  const repair = all.find(m => m.id === '0007-phase-guard-reach');
  assert.ok(repair, '0007-phase-guard-reach must be registered');
  const config = { name: 'Acme', repo: 'acme/anvils', tagline: 'Acme ships anvils.', practice: version,
    practices: ['base', 'agents-md', 'phases', 'night'], check: 'npm run check',
    migrations: ['0004-test-ledger'], phases: { source: 'files' } };
  await put(root, '.keel/keel.json', config);
  // Unusual formatting and unrelated human scripts must survive byte for byte.
  const script = 'node --test tests/acme.test.mjs';
  const pkg = `{\n\t"name" : "acme",\n\t"scripts" : { "check": "npm test", "test" : "${script}", "ship": "echo Acme ships" }\n}\n`;
  await put(root, 'package.json', pkg);
  await put(root, 'tests/acme.test.mjs', "import { test } from 'node:test'; test('Acme runs', () => {});\n");
  await render(root, { version });
  await put(root, 'docs/phases/01-acme.md', '---\nstatus: planned\nsince: 2026-10-10\ngoal: G0\ndepends: []\nevidence: []\nnote: Acme starts\n---\n# Acme\n\n## Done when\n\nAcme ships an anvil.\n\n## Scope\n\nOne anvil.\n\n## Acceptance\n\n- [ ] An anvil ships.\n\n## Proof\n\nnpm test\n\n## Deliberately open\n\nNone.\n\n## Next action\n\nShip the anvil.\n');
  const generated = run(process.execPath, ['scripts/roadmap.mjs'], { cwd: root });
  assert.equal(generated.status, 0, generated.stderr);
  const archives = Object.fromEntries(await Promise.all(['docs/phases/01-acme.md', 'docs/goals.json', 'docs/ROADMAP.md',
    'scripts/roadmap.mjs', 'tests/roadmap.test.mjs', 'tests/keel-generated.test.mjs'].map(async p => [p, await read(root, p)])));
  config.phases.source = 'milestones';
  await put(root, '.keel/keel.json', config);
  git(root, 'init', '-q', '-b', 'main'); save(root);
  const deps = { version, cliRoot: resolve('.'), env: { ...cleanEnv(), KEEL_GH: '/no-real-gh', KEEL_CACHE: join(root, '.keel/cache') } };
  const updateLocal = () => update({ dir: root, local: true, selfUpdate: false }, deps);
  const milestonePlan = await collect(root, all, { done: taken(config) });
  assert.deepEqual(milestonePlan.applied.map(m => m.id), ['0005-test-ledger-reach']);
  assert.ok(milestonePlan.skipped.includes(repair.id));
  const milestoneUpdate = await updateLocal();
  assert.deepEqual(milestoneUpdate.data.migrations.map(m => m.id), ['0005-test-ledger-reach']);
  const recorded = JSON.parse(await read(root, '.keel/keel.json'));
  assert.ok(recorded.migrations.includes('0005-test-ledger-reach'));
  assert.ok(!recorded.migrations.includes(repair.id));
  assert.equal(await read(root, 'package.json'), pkg);
  for (const [path, text] of Object.entries(archives)) assert.equal(await read(root, path), text, path);
  save(root);
  assert.equal((await updateLocal()).data.changed, false, 'same-version milestone update remains idle');
  recorded.phases.source = 'files';
  await put(root, '.keel/keel.json', recorded); save(root);
  const plan = await collect(root, all, { done: taken(recorded) });
  assert.deepEqual(plan.applied.map(m => m.id), [repair.id]);
  assert.deepEqual([...plan.edits.keys()], ['package.json']);
  const repaired = await updateLocal();
  assert.deepEqual(repaired.data.migrations.map(m => m.id), [repair.id]);
  assert.equal(repaired.data.check.ok, true, 'the real updated project gate passed');
  const nextScript = `${script} tests/roadmap.test.mjs tests/keel-generated.test.mjs`;
  assert.equal(await read(root, 'package.json'), pkg.replace(JSON.stringify(script), JSON.stringify(nextScript)));
  assert.equal(await repair.applies(await view(root)), false, 'idempotent even without the recorded id');
  save(root);
  assert.equal((await updateLocal()).data.changed, false);

  // Keep all exports and unit behavior intact, but make the CLI generator keep
  // stale content. Only the newly reachable generated-file guard detects it.
  await put(root, 'scripts/roadmap.mjs', `if (process.argv[1]?.endsWith('/scripts/roadmap.mjs')) process.exit(0);\n${archives['scripts/roadmap.mjs']}`);
  await put(root, 'docs/ROADMAP.md', `${archives['docs/ROADMAP.md']}\nAcme stale generated content.\n`);
  const broken = run('npm', ['run', 'check'], { cwd: root });
  assert.notEqual(broken.status, 0);
  assert.match(broken.stdout + broken.stderr, /docs\/ROADMAP\.md: a line appended to it survived/);
  // Counterfactual in the disposable fixture: the original gate misses it.
  await put(root, 'package.json', pkg);
  const missed = run('npm', ['run', 'check'], { cwd: root });
  assert.equal(missed.status, 0, missed.stdout + missed.stderr);
});

test('0007 respects local phases, ejected tests, existing gate coverage and non-node scripts; it never repairs CI or workspaces', async t => {
  const all = await load();
  const repair = all.find(m => m.id === '0007-phase-guard-reach');
  assert.ok(repair, '0007-phase-guard-reach must be registered');
  const root = await scratch(t);
  const guards = ['tests/roadmap.test.mjs', 'tests/keel-generated.test.mjs'];
  const base = { practices: ['phases', 'night', 'ci'], check: 'npm run check', migrations: ['0005-test-ledger-reach'] };
  for (const [extra, script, check, missing] of [
    [{ phases: { source: 'milestones' } }, 'node --test tests/acme.test.mjs', 'npm test', []],
    [{ practices: ['night', 'ci'], local: { phases: 'Acme owns its plan' } }, 'node --test tests/acme.test.mjs', 'npm test', []],
    [{ ejected: guards }, 'node --test tests/acme.test.mjs', 'npm test', []],
    [{ ejected: [guards[0]] }, 'node --test tests/acme.test.mjs', 'npm test', [guards[1]]],
    [{}, 'node --test tests/*.test.mjs', 'npm test', []],
    [{}, 'node --test', 'npm test', []],
    [{}, 'node --test tests/acme.test.mjs', `npm test && node --test ${guards.join(' ')}`, []],
    [{}, 'vitest run', 'npm test', []],
    [{}, 'node --test tests/acme.test.mjs && echo Acme', 'npm test', []],
    [{}, `node --test tests/acme.test.mjs ${guards[0]}`, 'npm test', [guards[1]]],
  ]) {
    const config = { ...base, ...extra };
    await put(root, '.keel/keel.json', config);
    await put(root, 'package.json', { name: 'acme', scripts: { test: script, check } });
    await put(root, 'app/package.json', '{"scripts":{"test":"node --test"}}\n');
    const result = await collect(root, [repair], { done: taken(config) });
    assert.equal(await anyPending(root, [repair], taken(config)), missing.length > 0);
    assert.deepEqual([...result.edits.keys()], missing.length ? ['package.json'] : []);
    if (missing.length) {
      const next = result.edits.get('package.json');
      assert.equal(JSON.parse(next).scripts.test, `${script} ${missing.join(' ')}`);
      await put(root, 'package.json', next);
      assert.equal(await repair.applies(await view(root)), false);
    }
    assert.equal(await read(root, 'app/package.json'), '{"scripts":{"test":"node --test"}}\n');
  }
});
