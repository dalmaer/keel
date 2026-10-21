import './helpers/hermetic.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readlink, symlink, rm, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { planRename, applyRename, migrateRename, renameActiveText } from '../lib/rename.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
const put = async (root, path, value) => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), value); };
const get = (root, path) => readFile(join(root, path), 'utf8');
const absent = async (root, path) => assert.rejects(stat(join(root, path)), { code: 'ENOENT' });

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'plates-rename-acme-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  const script = '// Keel health\nconst root = ".keel"; const receipt = "keel:robot-issue";\n';
  const workflow = 'name: keel-night\nconcurrency:\n  group: keel-night\non:\n  schedule: [{cron: "0 1 * * *"}]\njobs:\n  check:\n    run: node scripts/keel/check.mjs\n';
  const block = 'Run `keel doctor`; inspect `.keel/keel.json`.\n';
  const guide = `# Acme\nPersonal instructions stay here.\n<!-- keel:begin agents-md -->\n${block}<!-- keel:end agents-md -->\n`;
  const config = { name: 'Acme', repo: 'acme/studio', keel: 'github:dalmaer/keel', practice: '1.0.0', practices: ['agents-md'], local: { phases: 'Uses its own phases' }, check: 'npm run check' };
  for (const [path, value] of Object.entries({
    '.keel/keel.json': JSON.stringify(config),
    'scripts/keel/check.mjs': script,
    '.github/workflows/keel-night.yml': workflow,
    '.agents/skills/keel/SKILL.md': '# Keel\nRun keel --agent-help.\n',
    'AGENTS.md': guide,
    'README.md': '# Acme\nThis project uses Keel. See [adoption](docs/keel-adoption.md).\n',
    'package.json': JSON.stringify({ name: 'acme', scripts: { check: 'node scripts/keel/check.mjs' } }),
    'docs/keel-adoption.md': '# Adoption\nThe Keel configuration is .keel/keel.json.\n',
    'docs/evidence/2020-keel-check.md': '# Keel check in 2020\nRan `keel doctor`; old receipt `keel-proof`.\n[Guide](../keel-adoption.md)\n',
    'NOTICE': 'Keel adapted this historical upstream material.\n',
    'docs/phases/01-keel-check.md': '# Keel check\nRun scripts/keel/check.mjs.\n## Trajectory\nKeel was checked in 2020.\n',
    'src/app.mjs': 'export const userFeature = true;\n',
    '.keel/lock.json': JSON.stringify({ practice: '1.0.0', files: {
      'scripts/keel/check.mjs': { practice: 'night', sha256: sha(script) },
      '.github/workflows/keel-night.yml': { practice: 'night', sha256: sha(workflow) },
      'AGENTS.md#agents-md': { practice: 'agents-md', sha256: sha(block) },
      '.claude/skills/keel': { practice: 'agents-md', sha256: sha('../../.agents/skills/keel') },
    } }),
  })) await put(root, path, value);
  await mkdir(join(root, '.claude/skills'), { recursive: true });
  await symlink('../../.agents/skills/keel', join(root, '.claude/skills/keel'));
  git(root, 'add', '.'); git(root, 'commit', '-qm', 'Acme before rename');
  // Untracked journals and user work are intentionally outside Git's inventory.
  await put(root, '.keel/robot-issues/acme.json', '{"repo":"acme/keel-example","marker":"keel:robot-issue","nonce":"opaque"}\n');
  await put(root, '.keel/test-runs/acme.json', '{"file":"scripts/keel/check.mjs","result":"kept"}\n');
  await put(root, 'personal-notes.txt', 'unrelated Keel note; leave untouched\n');
  return root;
}

test('preview is read-only, names changes, and needs explicit approval', async t => {
  const root = await fixture(t), before = git(root, 'status', '--porcelain');
  const result = await migrateRename({ root });
  assert.equal(result.exitCode, 3);
  assert.equal(result.data.state, 'planned');
  assert(result.data.files.some(file => file.from === '.keel/keel.json' && file.to === '.plates/plates.json'));
  assert(result.data.files.some(file => file.to === 'docs/evidence/2020-plates-check.md'));
  assert.equal(git(root, 'status', '--porcelain'), before);
  await absent(root, '.git/plates-rename');
  assert(!JSON.stringify(result.data).includes('opaque'));
});

test('migration preserves journals and user work, moves workflows and symlinks, and rehashes managed files', async t => {
  const root = await fixture(t), journal = await get(root, '.keel/robot-issues/acme.json'), run = await get(root, '.keel/test-runs/acme.json');
  const preview = await planRename(root);
  const result = await applyRename(root, { digest: preview.digest });
  assert.equal(result.state, 'completed');
  await absent(root, '.keel'); await absent(root, '.github/workflows/keel-night.yml');
  assert.deepEqual((await readdir(join(root, '.github/workflows'))), ['plates-night.yml']);
  assert.equal(await get(root, '.plates/robot-issues/acme.json'), journal);
  assert.equal(await get(root, '.plates/test-runs/acme.json'), run);
  assert.equal(await get(root, 'personal-notes.txt'), 'unrelated Keel note; leave untouched\n');
  assert.equal(await get(root, 'src/app.mjs'), 'export const userFeature = true;\n');
  assert.equal(await readlink(join(root, '.claude/skills/plates')), '../../.agents/skills/plates');
  const config = JSON.parse(await get(root, '.plates/plates.json'));
  assert.equal(config.plates, 'github:dalmaer/plates'); assert.equal(config.keel, undefined);
  assert.equal(config.local.phases, 'Uses its own phases');
  const lock = JSON.parse(await get(root, '.plates/lock.json'));
  assert.equal(lock.files['scripts/plates/check.mjs'].sha256, sha(await get(root, 'scripts/plates/check.mjs')));
  assert.equal(lock.files['.claude/skills/plates'].sha256, sha('../../.agents/skills/plates'));
  assert.match(await get(root, 'AGENTS.md'), /Personal instructions stay here\./);
  assert.match(await get(root, 'AGENTS.md'), /<!-- plates:begin agents-md -->/);
  assert.match(await get(root, '.github/workflows/plates-night.yml'), /group: keel-night/);
  assert.match(await get(root, 'scripts/plates/check.mjs'), /keel:robot-issue/);
  const history = await get(root, 'docs/evidence/2020-plates-check.md');
  assert.match(history, /# Keel check in 2020/); assert.match(history, /Ran `keel doctor`/);
  assert.match(history, /\.\.\/plates-adoption\.md/);
  assert.equal(await get(root, 'NOTICE'), 'Keel adapted this historical upstream material.\n');
  assert.equal(await get(root, 'docs/phases/01-plates-check.md'), '# Plates check\nRun scripts/plates/check.mjs.\n## Trajectory\nKeel was checked in 2020.\n');
  assert.equal((await planRename(root)).state, 'already-migrated');
  assert.equal((await applyRename(root)).state, 'already-migrated');
});

test('existing destination and managed drift refuse before changing project files', async t => {
  const root = await fixture(t);
  await put(root, '.github/workflows/plates-night.yml', 'existing user workflow\n');
  await assert.rejects(planRename(root), /destination exists/);
  assert.match(await get(root, '.keel/keel.json'), /"keel"/);
  await rm(join(root, '.github/workflows/plates-night.yml'));
  await put(root, 'scripts/keel/check.mjs', 'user changed managed script\n');
  await assert.rejects(planRename(root), /managed file drift/);
  await absent(root, '.plates');
});

test('changed preview is refused without changing files or storing a receipt', async t => {
  const root = await fixture(t), preview = await planRename(root);
  await put(root, 'README.md', '# Acme\nNew human instruction about Keel.\n');
  await assert.rejects(applyRename(root, { digest: preview.digest }), /preview changed/);
  await absent(root, '.plates'); await absent(root, '.git/plates-rename/receipt.json');
  assert.match(await get(root, 'README.md'), /New human instruction/);
});

test('interrupted migration resumes the same receipt and preserves journal identities', async t => {
  const root = await fixture(t), preview = await planRename(root);
  await assert.rejects(applyRename(root, { digest: preview.digest, afterOperation() { throw Error('simulated interruption'); } }), /simulated interruption/);
  assert.equal((await planRename(root)).state, 'recovery-required');
  const receipt = JSON.parse(await get(root, '.git/plates-rename/receipt.json'));
  assert.equal(receipt.plan.digest, preview.digest);
  const result = await applyRename(root, { digest: preview.digest });
  assert.equal(result.state, 'completed');
  assert.equal(JSON.parse(await get(root, '.plates/robot-issues/acme.json')).nonce, 'opaque');
  assert.deepEqual(await readdir(join(root, '.github/workflows')), ['plates-night.yml']);
});

test('interruption between removing the old path and publishing the new path recovers exact bytes', async t => {
  const root = await fixture(t), preview = await planRename(root);
  await assert.rejects(applyRename(root, { digest: preview.digest, afterBackup() { throw Error('process exited before publish'); } }), /before publish/);
  const receipt = JSON.parse(await get(root, '.git/plates-rename/receipt.json'));
  assert.deepEqual(receipt.finished, []);
  const first = receipt.plan.operations[0];
  await absent(root, first.from); await absent(root, first.to);
  assert.equal((await planRename(root)).state, 'recovery-required');
  await applyRename(root, { digest: preview.digest });
  const actual = first.after.kind === 'link' ? await readlink(join(root, first.to)) : (await readFile(join(root, first.to))).toString('base64');
  assert.equal(actual, first.after.data);
  await absent(root, '.keel');
});

test('historical immutable source links keep their pinned path', async t => {
  const root = await fixture(t);
  const pinned = 'https://github.com/acme/source/blob/0123456789abcdef0123456789abcdef01234567/docs/keel-adoption.md';
  await put(root, 'docs/evidence/2020-keel-check.md', `[Original](${pinned})\n[Working](../keel-adoption.md)\n`);
  await applyRename(root);
  const result = await get(root, 'docs/evidence/2020-plates-check.md');
  assert(result.includes(pinned)); assert(result.includes('../plates-adoption.md'));
});

test('recovery refuses a human edit to an already-migrated target', async t => {
  const root = await fixture(t);
  await assert.rejects(applyRename(root, { afterOperation() { throw Error('simulated interruption'); } }), /simulated interruption/);
  const receipt = JSON.parse(await get(root, '.git/plates-rename/receipt.json'));
  const target = receipt.plan.operations[receipt.finished[0]].to;
  await rm(join(root, target)); await put(root, target, 'human edit after interrupted migration\n');
  await assert.rejects(applyRename(root), /changed before recovery/);
  assert.equal(await get(root, target), 'human edit after interrupted migration\n');
});

test('writer locks, symlinked parents and conflicting runtime roots are refused', async t => {
  const root = await fixture(t);
  await mkdir(join(root, '.keel/robot-issues/writer.lock'));
  await assert.rejects(planRename(root), /writer lock/);
  await rm(join(root, '.keel/robot-issues/writer.lock'), { recursive: true });
  await mkdir(join(root, '.plates'));
  await assert.rejects(planRename(root), /\.plates already exists/);
  await rm(join(root, '.plates'), { recursive: true });
  await symlink('/tmp', join(root, 'scripts/plates'));
  await assert.rejects(planRename(root), /parent is not a real directory/);
});

test('operational identities, secrets and concurrency survive active source rebranding', () => {
  const source = 'Keel .keel/keel.json fleet.json KEEL_GH keel:agent keel:robot-issue keel-impact keel-reconciliation keel-proof keel-decision keel/robot-1 keel/update-v1 keel-night-plan keel-climb/job keel-canvas-night __Host-keel-session keel_private keel_web_rpc secrets.KEEL_TOKEN keel.project keel.operation keel.hash keel.key keel.futureField keel-measurements keel-verify keelWindow keel%3Aagent keel%3areview-after keel-time-proposal .keel-time-proposals.lock\n  group: keel-night-${{ github.ref }}\n';
  const result = renameActiveText(source);
  assert.match(result, /Plates \.plates\/plates\.json plates\.json PLATES_GH/);
  for (const literal of ['keel:agent', 'keel:robot-issue', 'keel-impact', 'keel-reconciliation', 'keel-proof', 'keel-decision', 'keel/robot-1', 'keel/update-v1', 'keel-night-plan', 'keel-climb/job', 'keel-canvas-night', '__Host-keel-session', 'keel_private', 'keel_web_rpc', 'secrets.KEEL_TOKEN', 'group: keel-night-', 'keel.project', 'keel.operation', 'keel.hash', 'keel.key', 'keel.futureField', 'keel-measurements', 'keel-verify', 'keelWindow', 'keel%3Aagent', 'keel%3areview-after', 'keel-time-proposal', '.keel-time-proposals.lock']) assert(result.includes(literal), literal);
});


test('configuration and package identities survive while owned integration paths move', async t => {
  const root = await fixture(t);
  const config = {
    name: 'Keelboat', repo: 'acme/keel-tools', keel: 'github:dalmaer/keel',
    lessonProject: 'acme/keel-original', inbox: 'acme/keel-inbox',
    check: 'node scripts/keel/check.mjs', ci: { gateWorkflow: 'keel-night.yml' },
    local: { phases: 'Keel originally declined this local variant' },
    canvas: { projectKey: 'keel-identity', operation: 'keel-op', home: 'https://keel.example.com' },
    production: { sources: [{ id: 'keel-prod', project: 'keel-project', service: 'keel-service' }] },
  };
  await put(root, '.keel/keel.json', JSON.stringify(config));
  await put(root, 'package.json', JSON.stringify({ name: 'keel-user-package', repository: 'acme/keel-tools', scripts: { check: 'node scripts/keel/check.mjs' } }));
  await applyRename(root);
  const next = JSON.parse(await get(root, '.plates/plates.json'));
  assert.deepEqual(next, { ...Object.fromEntries(Object.entries(config).filter(([key]) => key !== 'keel')), plates: 'github:dalmaer/plates', check: 'node scripts/plates/check.mjs', ci: { gateWorkflow: 'plates-night.yml' } });
  assert.deepEqual(JSON.parse(await get(root, 'package.json')), { name: 'keel-user-package', repository: 'acme/keel-tools', scripts: { check: 'node scripts/plates/check.mjs' } });
});

test('self configuration retains lesson fingerprint identity across repository rename', async t => {
  const root = await fixture(t);
  await put(root, '.keel/keel.json', JSON.stringify({ name: 'Keel', repo: 'dalmaer/keel', keel: 'self', inbox: 'dalmaer/keel-inbox' }));
  await applyRename(root);
  assert.deepEqual(JSON.parse(await get(root, '.plates/plates.json')), { name: 'Plates', repo: 'dalmaer/plates', plates: 'self', lessonProject: 'dalmaer/keel', inbox: 'dalmaer/keel-inbox' });
});


test('migration keeps remote plan blob identity and adapts shipped plan writer separately from local paths', async t => {
  const root = await fixture(t);
  const oldSource = `export const PLAN_DIR = '.keel/night';\nexport const PLAN = \`\${PLAN_DIR}/plan.json\`;\nexport const PLAN_BRANCH = 'keel-night-plan';\nconst shown = planGit(root, ['show', \`\${tip}:\${PLAN}\`]);\nplanGit(root, ['update-index', '--cacheinfo', \`100644,\${blob},\${PLAN}\`]);\n`;
  await put(root, 'scripts/keel/night-plan.mjs', oldSource);
  await put(root, 'scripts/keel/morning.mjs', "import { PLAN, PLAN_BRANCH, NIGHT_AT } from './night-plan.mjs';\nawait at(`${PLAN_BRANCH}:${PLAN}`, () => remoteFile(root, PLAN_BRANCH, PLAN), PLAN_BRANCH);\n");
  await put(root, '.github/workflows/keel-plan-reader.yml', 'name: keel-impact\nrun: git show "refs/remotes/origin/keel-night-plan:.keel/night/plan.json"\napi: repos/$REPO/contents/.keel/night/plan.json?ref=keel-night-plan\n');
  git(root, 'add', 'scripts/keel/night-plan.mjs', 'scripts/keel/morning.mjs', '.github/workflows/keel-plan-reader.yml');
  await applyRename(root);
  const source = await get(root, 'scripts/plates/night-plan.mjs');
  assert(source.includes("export const PLAN_DIR = '.plates/night'"));
  assert(source.includes("export const REMOTE_PLAN = '.keel/night/plan.json'"));
  assert(source.includes('`${tip}:${REMOTE_PLAN}`'));
  assert(source.includes('`100644,${blob},${REMOTE_PLAN}`'));
  assert(!source.includes('`${tip}:${PLAN}`'));
  const morning = await get(root, 'scripts/plates/morning.mjs');
  assert(morning.includes('import { PLAN, PLAN_BRANCH, REMOTE_PLAN,'));
  assert(morning.includes('remoteFile(root, PLAN_BRANCH, REMOTE_PLAN)'));
  assert(!morning.includes('remoteFile(root, PLAN_BRANCH, PLAN)'));
  const workflow = await get(root, '.github/workflows/plates-plan-reader.yml');
  assert(workflow.includes('name: plates-impact'));
  assert(workflow.includes('keel-night-plan:.keel/night/plan.json'));
  assert(workflow.includes('contents/.keel/night/plan.json?ref=keel-night-plan'));
});


test('escaped regular expressions retain existing machine branch identity', () => {
  const pattern = String.raw`/^keel\/robot-([1-9]\d*)$/; /^keel-night\//; /^keel\/update-/;`;
  assert.equal(renameActiveText(pattern), pattern);
});


test('queue and goodnight hash namespaces survive without freezing integration paths', () => {
  const source = [
    "const queue = 'keel/';",
    'const queueDouble = "keel/";',
    'const queueTemplate = `keel/`;',
    "const namespace = 'keel-goodnight-loop';",
    "const script = 'scripts/keel/night-plan.mjs';",
    "const skill = '.agents/skills/keel/SKILL.md';",
    "const config = '.keel/keel.json';",
  ].join('\n');
  assert.equal(renameActiveText(source), [
    "const queue = 'keel/';",
    'const queueDouble = "keel/";',
    'const queueTemplate = `keel/`;',
    "const namespace = 'keel-goodnight-loop';",
    "const script = 'scripts/plates/night-plan.mjs';",
    "const skill = '.agents/skills/plates/SKILL.md';",
    "const config = '.plates/plates.json';",
  ].join('\n'));
});
