import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { render, load, targets, blockBody } from '../lib/practices.mjs';
import { readLock } from '../lib/lock.mjs';
import { adopt } from '../lib/adopt.mjs';
import { diagnose } from '../lib/doctor.mjs';
import { anyPending, collect, load as migrations } from '../lib/migrations.mjs';
import { readMilestones, projectMilestones } from '../practices/night/files/scripts/keel/milestones.mjs';
import { milestoneConfig, milestone, response } from './helpers/milestones.mjs';
import { run } from './helpers/run.mjs';

const version = { cli: '0.0.0', practice: '0.0.0', commit: null };
const fileConfig = { name: 'Acme', tagline: 'Acme ships anvils.', repo: 'acme/anvils', check: 'node --test', practices: ['base', 'agents-md', 'phases', 'evidence', 'lessons', 'conduct'] };
async function put(root, path, value) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
}
async function scratch(t, config = fileConfig) {
  const root = await mkdtemp(join(tmpdir(), 'keel-milestone-integration-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await put(root, '.keel/keel.json', config);
  return root;
}
const exists = path => lstat(path).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; });

for (const readopt of [false, true]) test(`source switch preserves dormant hashes and detects edits after returning to files (readopt=${readopt})`, async t => {
  const root = await scratch(t), practices = await load();
  await render(root, { practices });
  const before = await readLock(root);
  const dormant = Object.fromEntries(Object.entries(before.files).filter(([, row]) => ['phases', 'evidence', 'conduct'].includes(row.practice)));
  assert.ok(Object.keys(dormant).length > 3);
  await put(root, '.keel/keel.json', { ...fileConfig, phases: { source: 'milestones' } });
  const edited = ['scripts/roadmap.mjs', 'docs/templates/evidence.md', '.agents/skills/conduct/SKILL.md'];
  for (const path of edited) await put(root, path, `${await readFile(join(root, path), 'utf8')}\nAcme's retained edit.\n`);
  const guide = await readFile(join(root, 'AGENTS.md'), 'utf8');
  if (readopt) {
    const result = await adopt({ dir: root, check: 'npm test' }, { version, practices, ciEnv: { ...process.env, KEEL_CI_OFFLINE: '1', KEEL_GH: '/no-real-gh' } });
    for (const name of ['phases', 'evidence', 'conduct']) assert.ok(!result.data.config.practices.includes(name));
  } else await render(root, { practices });
  for (const [key, row] of Object.entries(dormant)) assert.deepEqual((await readLock(root)).files[key], row, key);
  assert.equal(await readFile(join(root, 'AGENTS.md'), 'utf8'), guide);
  const doctor = await diagnose(root, { practices });
  assert.ok(!doctor.drift.some(row => ['phases', 'evidence', 'conduct'].includes(row.practice)));
  await put(root, '.keel/keel.json', fileConfig);
  await assert.rejects(render(root, { practices }), error => {
    assert.match(error.message, /refusing to overwrite/);
    for (const path of edited) assert.ok(error.changed.includes(path), path);
    return true;
  });
  // Ejection remains explicit ownership even when the source is disabled.
  await put(root, '.keel/keel.json', { ...fileConfig, phases: { source: 'milestones' }, ejected: edited });
  await render(root, { practices });
  for (const path of edited) assert.equal((await readLock(root)).files[path], undefined);
});

test('actual milestone adoption omits conduct targets and preserves existing project instructions', async t => {
  for (const own of [false, true]) {
    const root = await scratch(t, { name: 'Acme', repo: 'acme/anvils' });
    await put(root, 'package.json', { name: 'acme', scripts: { test: 'node --test' } });
    const instructions = '# Acme\n\nUse Acme review before releasing.\n\nnpm run next      # the next phase to conduct, and its next action\nnpm run roadmap   # after editing any docs/phases/*.md or docs/goals.json\n';
    if (own) {
      await put(root, 'AGENTS.md', instructions);
      await put(root, '.agents/skills/conduct/SKILL.md', instructions);
    }
    const practices = await load();
    const result = await adopt({ dir: root, check: 'npm test' }, { version, practices, milestoneRead: async () => projectMilestones(response([milestone()]), milestoneConfig), ciEnv: { ...process.env, KEEL_CI_OFFLINE: '1', KEEL_GH: '/no-real-gh' } });
    const cfg = result.data.config;
    assert.equal(cfg.phases.source, 'milestones');
    const row = result.data.practices.find(p => p.name === 'conduct');
    assert.equal(row.state, 'off'); assert.match(row.why, /file-based conduct.*read-only/);
    assert.ok(!targets(cfg, practices).some(f => ['phases', 'evidence', 'conduct'].includes(f.practice)));
    assert.equal(await exists(join(root, '.agents/skills/conduct/SKILL.md')), own);
    const guide = await readFile(join(root, 'AGENTS.md'), 'utf8');
    assert.equal((blockBody(guide, 'conduct') ?? '').trim(), '');
    if (own) {
      assert.ok(guide.startsWith(instructions));
      assert.equal(await readFile(join(root, '.agents/skills/conduct/SKILL.md'), 'utf8'), instructions);
    } else {
      assert.doesNotMatch(guide, /npm run (?:next|roadmap)|the next phase to conduct/);
      assert.match(guide, /keel next/);
      assert.match(guide, /keel status/);
      assert.match(guide, /plan lives in GitHub milestones.*read-only/);
    }
  }
});

test('migration pipeline skips archived local plans for milestone sources but still migrates file plans', async t => {
  const all = await migrations();
  for (const [fixture, id] of [['acme-groove', '0001-milestone-to-goal'], ['acme-fold', '0003-phases-gain-goals']]) {
    const root = await scratch(t, { ...milestoneConfig, tagline: 'Acme ships anvils.', local: { phases: 'Archived file plan' } });
    await cp(resolve('tests/fixtures/adopt', fixture), root, { recursive: true });
    // Remove evidence debt from the synthetic file plan to make 0003 applicable.
    if (fixture === 'acme-fold') {
      const { readdir } = await import('node:fs/promises');
      for (const file of await readdir(join(root, 'docs/phases'))) {
        const path = `docs/phases/${file}`;
        await put(root, path, (await readFile(join(root, path), 'utf8')).replace(/^status:.*$/m, 'status: planned'));
      }
    }
    const selected = all.filter(m => ['0001-milestone-to-goal', '0003-phases-gain-goals'].includes(m.id));
    assert.equal(await anyPending(root, selected), false);
    const result = await collect(root, selected);
    assert.deepEqual(result.applied, []); assert.equal(result.edits.size, 0);
    assert.equal(await exists(join(root, 'docs/goals.json')), false);
    // Same real fixture must produce migration work once file planning is selected.
    await put(root, '.keel/keel.json', { ...fileConfig, practices: ['base', 'agents-md'], local: { phases: 'Acme file plan' } });
    assert.equal(await anyPending(root, selected), true);
    const local = await collect(root, selected);
    assert.ok(local.applied.some(m => m.id === id)); assert.ok(local.edits.has('docs/goals.json'));
  }
});

test('phase list text CLI prints every milestone row and incomplete coverage', async t => {
  const root = await scratch(t, milestoneConfig);
  const env = { ...process.env, KEEL_CACHE: join(root, 'cache'), KEEL_GH: '/no-real-gh' };
  await readMilestones(milestoneConfig, { env, fresh: true, guard: async () => null, graphql: async () => response([milestone(1), { ...milestone(2, 'CLOSED'), title: 'Acme archive' }], { closed: true }) });
  const result = run(process.execPath, [resolve('bin/keel.mjs'), 'phase', 'list'], { cwd: root, env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /1\. Acme release \[planned\].*https:\/\/github.com\/acme\/anvils\/milestone\/1/);
  assert.match(result.stdout, /2\. Acme archive \[closed\].*https:\/\/github.com\/acme\/anvils\/milestone\/2/);
  assert.match(result.stdout, /coverage incomplete/);
});

test('full migration pipeline keeps night and CI work without wiring dormant phase tests into the gate', async t => {
  const cfg = { ...fileConfig, practice: '0.0.0', check: 'npm test', phases: { source: 'milestones' }, practices: [...fileConfig.practices, 'night', 'ci'] };
  const root = await scratch(t, cfg);
  await render(root);
  const archived = {
    'docs/phases/01-archive.md': '---\nstatus: planned\nmilestone: M1\n---\n# Acme archive\n',
    'docs/milestones.json': '[{"id":"M1","title":"Acme","outcome":"Acme ships."}]\n',
    'tests/roadmap.test.mjs': "throw new Error('archived test must stay outside the gate');\n",
    'tests/keel-generated.test.mjs': "throw new Error('archived generated test');\n",
    'scripts/roadmap.mjs': "throw new Error('archived roadmap');\n",
  };
  for (const [path, text] of Object.entries(archived)) await put(root, path, text);
  await put(root, 'package.json', { name: 'acme', scripts: { test: 'node --test tests/acme.test.mjs' } });
  await put(root, 'app/package.json', { name: 'acme-app', scripts: { test: 'node --test' } });
  await put(root, 'tests/acme.test.mjs', "import { test } from 'node:test'; test('Acme', () => {});\n");
  const all = await migrations();
  assert.equal(await anyPending(root, all), true);
  const result = await collect(root, all);
  assert.deepEqual(result.applied.map(m => m.id), ['0004-test-ledger', '0005-test-ledger-reach']);
  for (const [path, content] of result.edits) { assert.notEqual(content, null); await put(root, path, content); }
  await render(root);
  for (const [path, text] of Object.entries(archived)) assert.equal(await readFile(join(root, path), 'utf8'), text, path);
  assert.equal(await exists(join(root, 'docs/goals.json')), false);
  assert.equal(JSON.parse(await readFile(join(root, '.keel/keel.json'), 'utf8')).phases.livedIn, undefined);
  const script = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).scripts.test;
  assert.match(script, /test-ledger/); assert.match(script, /tests\/keel-workflows.test.mjs/);
  assert.doesNotMatch(script, /roadmap|keel-generated/);
  assert.match(JSON.parse(await readFile(join(root, 'app/package.json'), 'utf8')).scripts.test, /test-ledger/);
  assert.equal(await anyPending(root, all), false);
  const doctor = await diagnose(root);
  assert.ok(!doctor.lint.some(row => row.rule === 'shipped-test-unrun' && /roadmap|keel-generated/.test(row.path)));
});
