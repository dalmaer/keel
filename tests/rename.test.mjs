import './helpers/hermetic.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readlink, symlink, link, rm, stat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { run } from './helpers/run.mjs';
import { load, targets } from '../lib/practices.mjs';
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
  const source = 'Keel .keel/keel.json fleet.json KEEL_GH keel:agent keel:robot-issue keel-impact keel-reconciliation keel-proof keel-decision keel/robot-1 keel/update-v1 keel-night-plan keel-climb/job keel-canvas-night __Host-keel-session keel_private keel_web_rpc secrets.KEEL_TOKEN "keel.project" "keel.operation" "keel.hash" "keel.key" "keel.futureField" keel-measurements keel-verify keelWindow keel%3Aagent keel%3areview-after keel-time-proposal .keel-time-proposals.lock\n  group: keel-night-${{ github.ref }}\n';
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


test('metadata string identities remain durable while code variables rename consistently', () => {
  const before = `const keel = { loop: { mode: 'on' }, name: 'Acme', lessons: 'docs/lessons.md', phases: { shape: 'projects' } };
const own = keel.loop;
return { mode: own.mode, name: keel.name, lessons: keel.lessons, shape: keel.phases.shape, metadata: { 'keel.project': 'stable', 'keel.futureKey': 'future' } };`;
  const after = renameActiveText(before);
  assert(after.includes('const plates ='));
  assert(!after.includes('keel.loop'));
  assert.deepEqual(new Function(after)(), new Function(before)());
});

const ignored = (root, path) => {
  try { git(root, 'check-ignore', '--no-index', '-q', path); return true; }
  catch (error) { if (error.status === 1) return false; throw error; }
};

test('private feedback stays ignored before publication with byteexact records and package guards', async t => {
  const root = await fixture(t), exclude = await get(root, '.git/info/exclude');
  const rules = exclude + '\n# user rule retained\n/personal-cache/\n/.keel/feedback/\n';
  await put(root, '.git/info/exclude', rules);
  const secret = Buffer.from('private Acme feedback\0opaque-keel-operation\xff', 'binary');
  await put(root, '.keel/feedback/records/acme.json', secret);
  await put(root, '.keel/feedback/.npmignore', '*\n');
  const preview = await planRename(root), publicJson = JSON.stringify(preview);
  assert(preview.privacy.patterns.includes('/.plates/feedback/'));
  assert(!publicJson.includes('private Acme feedback'));
  assert(!publicJson.includes(secret.toString('base64')));
  assert(!publicJson.includes('# user rule retained'));
  assert.equal(await get(root, '.git/info/exclude'), rules);
  await absent(root, '.git/plates-rename');
  const privateIndex = preview.files.findIndex(file => file.to === '.plates/feedback/records/acme.json');
  let checked = false;
  await applyRename(root, { digest: preview.digest, afterBackup(index) {
    if (index !== privateIndex) return;
    checked = true;
    assert(ignored(root, '.plates/feedback/records/acme.json'));
    assert(ignored(root, '.keel/feedback/records/acme.json'));
  } });
  assert(checked);
  assert.deepEqual(await readFile(join(root, '.plates/feedback/records/acme.json')), secret);
  assert.equal(await get(root, '.plates/feedback/.npmignore'), '*\n');
  const after = await get(root, '.git/info/exclude');
  assert(after.startsWith(rules));
  assert(ignored(root, '.plates/feedback/future.json'));
  assert(!ignored(root, '.plates/public.json'));
  assert(!ignored(root, '.plates/plates.json'));
  assert(!git(root, 'status', '--porcelain', '--untracked-files=all').includes('feedback'));
  const stage = execFileSync('git', ['-C', root, 'add', '--dry-run', '.'], { encoding: 'utf8' });
  assert(!stage.includes('feedback'));
  assert.equal((await applyRename(root)).state, 'already-migrated');
  assert.equal(await get(root, '.git/info/exclude'), after);
});

test('tracked ignore rewrites protect both old and new literal runtime files through recovery', async t => {
  const root = await fixture(t), path = '.keel/test-runs/acme[1]*?.json';
  await put(root, path, 'private test run');
  await put(root, '.gitignore', '/.keel/test-runs/*.json\n');
  git(root, 'add', '.gitignore'); git(root, 'commit', '-qm', 'Acme runtime privacy');
  const preview = await planRename(root);
  const ignoreIndex = preview.files.findIndex(file => file.from === '.gitignore');
  await assert.rejects(applyRename(root, { digest: preview.digest, afterOperation(index) {
    if (index !== ignoreIndex) return;
    assert(ignored(root, path));
    assert(ignored(root, '.plates/test-runs/acme[1]*?.json'));
    throw Error('stop after ignore rewrite');
  } }), /stop after ignore rewrite/);
  const protectedRules = await get(root, '.git/info/exclude');
  assert(protectedRules.includes('/.plates/test-runs/acme\\[1\\]\\*\\?.json'));
  // The old rule is retained narrowly: a similar old filename is not covered.
  assert(!ignored(root, '.keel/test-runs/acme11-other.json'));
  await applyRename(root, { digest: preview.digest });
  assert.equal(await get(root, '.plates/test-runs/acme[1]*?.json'), 'private test run');
  assert.equal(await get(root, '.git/info/exclude'), protectedRules);
});

test('private backup crash recovers without duplicate excludes and refuses exclude drift', async t => {
  const root = await fixture(t);
  await put(root, '.git/info/exclude', '/.keel/feedback/\n');
  await put(root, '.keel/feedback/secret.json', 'private receipt identity');
  const preview = await planRename(root), index = preview.files.findIndex(file => file.to === '.plates/feedback/secret.json');
  await assert.rejects(applyRename(root, { digest: preview.digest, afterBackup(at) {
    if (at === index) throw Error('private backup interrupted');
  } }), /private backup interrupted/);
  await absent(root, '.keel/feedback/secret.json'); await absent(root, '.plates/feedback/secret.json');
  const rules = await get(root, '.git/info/exclude');
  assert(ignored(root, '.plates/feedback/secret.json'));
  assert.equal(await get(root, `.git/plates-rename/before-${index}`), 'private receipt identity');
  assert.equal((await stat(join(root, '.git/plates-rename'))).mode & 0o777, 0o700);
  assert.equal((await stat(join(root, '.git/plates-rename/receipt.json'))).mode & 0o777, 0o600);
  await put(root, '.git/info/exclude', rules + '# human edit\n');
  await assert.rejects(applyRename(root, { digest: preview.digest }), /Git exclude changed/);
  await absent(root, '.plates/feedback/secret.json');
  assert.equal(await get(root, '.git/info/exclude'), rules + '# human edit\n');
  await put(root, '.git/info/exclude', rules);
  await applyRename(root, { digest: preview.digest });
  assert.equal(await get(root, '.plates/feedback/secret.json'), 'private receipt identity');
  assert.equal(await get(root, '.git/info/exclude'), rules);
});

test('unsafe exclude file or directory refuses preview without following links', async t => {
  for (const kind of ['file', 'directory', 'hardlink', 'fifo']) {
    const root = await fixture(t);
    await put(root, 'outside/exclude', 'outside bytes');
    if (kind === 'file') {
      await rm(join(root, '.git/info/exclude'));
      await symlink('../../outside/exclude', join(root, '.git/info/exclude'));
    } else if (kind === 'directory') {
      await rm(join(root, '.git/info'), { recursive: true });
      await symlink('../outside', join(root, '.git/info'));
    } else {
      await rm(join(root, '.git/info/exclude'));
      if (kind === 'hardlink') await link(join(root, 'outside/exclude'), join(root, '.git/info/exclude'));
      else execFileSync('mkfifo', [join(root, '.git/info/exclude')]);
    }
    await assert.rejects(planRename(root), /unsafe(?: or oversized)? Git exclude/);
    assert.equal(await get(root, 'outside/exclude'), 'outside bytes');
    await absent(root, '.plates');
  }
});

test('changed exclude preview or conflicting canonical negation refuses before private data moves', async t => {
  const root = await fixture(t);
  await put(root, '.git/info/exclude', '/.keel/feedback/\n');
  await put(root, '.keel/feedback/secret.json', 'private feedback');
  const preview = await planRename(root);
  await put(root, '.git/info/exclude', '/.keel/feedback/\n# new user rule\n');
  await assert.rejects(applyRename(root, { digest: preview.digest }), /preview changed/);
  await absent(root, '.plates');
  await put(root, '.gitignore', '!/.plates/feedback/secret.json\n');
  git(root, 'add', '.gitignore');
  const rules = await get(root, '.git/info/exclude');
  await assert.rejects(planRename(root), /ignore rules conflict/);
  assert.equal(await get(root, '.git/info/exclude'), rules);
  assert.equal(await get(root, '.keel/feedback/secret.json'), 'private feedback');
});

test('dated changelog and practice records retain release claims and measured commands while active indexes rename', async t => {
  const root = await fixture(t);
  const record = '# 5 January 2020 — Acme adopted keel\n\nAcme had adopted keel (`abc1234`); Keel released v0.7.0.\nRan `node scripts/keel/check.mjs`; measured `.keel/bounds.json` and `keel-night`.\n[Adoption](../keel-adoption.md)\n';
  const sources = ['docs/changelog/2020-01-05.md', 'docs/changelog/2020-01-06-keel.md', 'docs/practice/2020-01-05.md'];
  for (const path of sources) await put(root, path, record);
  for (const path of ['docs/changelog/README.md', 'docs/practice/README.md', 'docs/changelog/current.md']) await put(root, path, '# Current instructions\nUse `keel doctor` and `.keel/keel.json`.\n');
  git(root, 'add', 'docs'); git(root, 'commit', '-qm', 'Acme dated records');
  await applyRename(root, { digest: (await planRename(root)).digest });
  for (const path of sources) assert.equal(await get(root, path.replace('2020-01-06-keel', '2020-01-06-plates')), record.replace('](../keel-adoption.md)', '](../plates-adoption.md)'));
  for (const path of ['docs/changelog/README.md', 'docs/practice/README.md', 'docs/changelog/current.md']) assert.equal(await get(root, path), '# Current instructions\nUse `plates doctor` and `.plates/plates.json`.\n');
  await absent(root, 'docs/changelog/2020-01-06-keel.md');
});

test('actual adoption report preserves its author and practice version without freezing an adoption guide', async t => {
  const root = await fixture(t);
  const pinned = 'https://github.com/acme/source/blob/0123456789abcdef0123456789abcdef01234567/docs/keel-adoption.md';
  const report = '# Acme under keel: what stayed its own\n\nWritten by `keel adopt` on practice 0.6.7. Keel switched on the practices Acme already satisfies.\nThe gate was `node scripts/keel/check.mjs`; local variants were recorded in `.keel/keel.json`.\n[Configuration](../.keel/keel.json)\n[Original](' + pinned + ')\n';
  await put(root, 'docs/keel-adoption.md', report);
  await applyRename(root, { digest: (await planRename(root)).digest });
  assert.equal(await get(root, 'docs/plates-adoption.md'), report.replace('](../.keel/keel.json)', '](../.plates/plates.json)'));
  await absent(root, 'docs/keel-adoption.md');
  const active = await fixture(t);
  await applyRename(active, { digest: (await planRename(active)).digest });
  assert.equal(await get(active, 'docs/plates-adoption.md'), '# Adoption\nThe Plates configuration is .plates/plates.json.\n');
});

test('Loop dispositions and project phase or journey records preserve human decisions and quoted history', async t => {
  const root = await fixture(t);
  const record = '---\nstatus: dismissed\nnote: "Night was serialized by keel-night; no race."\n---\n# Keel observation\n\n**5 January 2020.** The owner asked for *"specs in keel format"*.\nVerified `scripts/keel/check.mjs`; the decision was no fix.\n[Working source](../../scripts/keel/check.mjs)\n';
  const records = ['docs/loop/keel-bounds-race.md', 'docs/projects/acme/phases.md', 'docs/projects/acme/journey.md'];
  for (const path of records) await put(root, path, record);
  const active = ['docs/loop/README.md', 'docs/LOOP.md', 'docs/projects/README.md', 'docs/projects/acme/design.md'];
  for (const path of active) await put(root, path, '# Current instructions\nRun `keel doctor`.\n');
  git(root, 'add', 'docs'); git(root, 'commit', '-qm', 'Acme recorded decisions');
  await applyRename(root, { digest: (await planRename(root)).digest });
  for (const path of records) assert.equal(await get(root, path.replace('keel-bounds', 'plates-bounds')), record.replace('](../../scripts/keel/check.mjs)', '](../../scripts/plates/check.mjs)'));
  for (const path of active) assert.equal(await get(root, path), '# Current instructions\nRun `plates doctor`.\n');
  await absent(root, 'docs/loop/keel-bounds-race.md');
});

test('decision and walk RPC identities stay exact in Acme code and SQL while active branding changes', () => {
  const code = '// Keel integration for Acme\nconst config = ".keel/keel.json";\nconst decision = "/rest/v1/rpc/keel_decision_rpc";\nconst walk = "/rest/v1/rpc/keel_walk_rpc";\nconst keel_local_setting = true;\n';
  assert.equal(renameActiveText(code), '// Plates integration for Acme\nconst config = ".plates/plates.json";\nconst decision = "/rest/v1/rpc/keel_decision_rpc";\nconst walk = "/rest/v1/rpc/keel_walk_rpc";\nconst plates_local_setting = true;\n');
  for (const rpc of ['keel_decision_rpc', 'keel_walk_rpc']) {
    const sql = `-- Keel storage for Acme\ncreate or replace function public.${rpc}(p_id text) returns text language sql as $$ select p_id $$;\nrevoke all on function public.${rpc}(text) from public,anon,authenticated;\ngrant execute on function public.${rpc}(text) to service_role;\n`;
    assert.equal(renameActiveText(sql), sql.replace('-- Keel storage', '-- Plates storage'));
  }
  assert.equal(renameActiveText('keel_future_rpc keel_decision_rpc_extra keel_walk_rpc_extra'), 'plates_future_rpc plates_decision_rpc_extra plates_walk_rpc_extra', 'the compatibility allowlist does not freeze arbitrary keel_ symbols');
});

test('supported local configuration commands execute after their paths move without rewriting remote identities', async t => {
  const root = await fixture(t), command = 'node scripts/keel/acme.mjs';
  await put(root, 'scripts/keel/acme.mjs', 'import { readFileSync } from "node:fs"; console.log(JSON.parse(readFileSync(".keel/keel.json", "utf8")).name);\n');
  await put(root, 'docs/keel-guide.md', '# Acme guide\n');
  await put(root, 'docs/keel-output.md', 'Acme output\n');
  await put(root, 'tests/keel-acme.test.mjs', '// Acme test\n');
  const old = JSON.parse(await get(root, '.keel/keel.json'));
  const identities = { repo: 'acme/keel-project', lessonProject: 'acme/keel-history', inbox: 'acme/keel-inbox', local: { phases: 'Keel adopted this local variant' }, env: { KEEL_ACME: 'scripts/keel/opaque' }, setupToken: 'read', canvas: { projectKey: 'keel-project', home: 'https://keel.example', operation: 'scripts/keel/identity' } };
  const config = { ...old, ...identities, check: command, setup: command, health: '.keel/health', lessons: 'docs/keel-guide.md', guide: 'docs/keel-guide.md', gateWorkflow: 'keel-night.yml', ci: { gateWorkflow: 'keel-night.yml', gateReuse: 'until-change' },
    climb: { jobs: ['test-time'], testCommand: command, build: command, buildOutput: '.keel/build', perf: { command, check: command, better: 'lower', unit: 'keel-units' } },
    loop: { run: command, afterRender: command, afterRenderWrites: ['docs/keel-output.md'], source: 'acme:keel', name: 'Keel-shaped Acme', intro: 'Keel originally supplied this practice', contexts: [{ command, source: 'keel:context', description: 'Ran scripts/keel/acme.mjs before adoption', annotations: { original: 'scripts/keel/acme.mjs' } }] },
    prove: { command: command + ' {file}', tap: true }, tests: { junit: '.keel/test-runs/acme.xml', stalls: ['tests/keel-acme.test.mjs'], configEnv: ['KEEL_ACME'] }, contracts: [{ paths: ['scripts/keel/**', 'tests/keel-acme.test.mjs'], read: 'docs/keel-guide.md', why: 'Keel originally required this contract' }], retros: { dir: '.keel/retros' }, paths: { retros: '.keel/retros', remote: 'keel:remote' } };
  await put(root, '.keel/keel.json', JSON.stringify(config));
  git(root, 'add', 'scripts/keel/acme.mjs', 'docs', 'tests'); git(root, 'commit', '-qm', 'Acme integration commands');
  await applyRename(root, { digest: (await planRename(root)).digest });
  const next = JSON.parse(await get(root, '.plates/plates.json'));
  for (const cmd of [next.check, next.setup, next.climb.testCommand, next.climb.build, next.climb.perf.command, next.climb.perf.check, next.loop.run, next.loop.afterRender, next.loop.contexts[0].command, next.prove.command.replace('{file}', 'tests/plates-acme.test.mjs')]) {
    const result = run('bash', ['-e', '-c', cmd], { cwd: root });
    assert.equal(result.status, 0, `${cmd}: ${result.stderr}`);
    assert.equal(result.stdout.trim(), 'Acme');
  }
  assert.deepEqual(Object.fromEntries(Object.keys(identities).map(key => [key, next[key]])), identities);
  assert.deepEqual([next.health, next.lessons, next.guide, next.gateWorkflow, next.ci.gateWorkflow, next.climb.buildOutput, next.tests.junit, next.retros.dir, next.paths.retros], ['.plates/health', 'docs/plates-guide.md', 'docs/plates-guide.md', 'plates-night.yml', 'plates-night.yml', '.plates/build', '.plates/test-runs/acme.xml', '.plates/retros', '.plates/retros']);
  assert.deepEqual(next.loop.afterRenderWrites, ['docs/plates-output.md']);
  assert.deepEqual(next.tests.stalls, ['tests/plates-acme.test.mjs']);
  assert.deepEqual(next.tests.configEnv, config.tests.configEnv);
  assert.deepEqual(next.contracts, [{ ...config.contracts[0], paths: ['scripts/plates/**', 'tests/plates-acme.test.mjs'], read: 'docs/plates-guide.md' }]);
  assert.deepEqual(next.loop.contexts[0], { ...config.loop.contexts[0], command: 'node scripts/plates/acme.mjs' });
  for (const key of ['source', 'name', 'intro']) assert.equal(next.loop[key], config.loop[key]);
  assert.equal(next.climb.perf.unit, 'keel-units');
  assert.equal(next.paths.remote, 'keel:remote');
});

test('ejected file and block ownership follows canonical paths and still excludes renderer targets', async t => {
  const root = await fixture(t), custom = '// Acme owns this implementation\nexport const custom = true;\n';
  await put(root, 'scripts/keel/improve.mjs', custom);
  await put(root, 'docs/keel-guide.md', '# Acme local block\n');
  await put(root, '.agents/skills/conduct/SKILL.md', '# Acme conductor policy\n');
  await put(root, 'scripts/keel/missing-tracked.mjs', '// Acme previously deleted this\n');
  git(root, 'add', 'scripts', 'docs/keel-guide.md', '.agents/skills/conduct'); git(root, 'commit', '-qm', 'Acme owns its integration');
  await rm(join(root, 'scripts/keel/missing-tracked.mjs'));
  const config = JSON.parse(await get(root, '.keel/keel.json'));
  config.practices = ['base', 'agents-md', 'night', 'phases', 'evidence', 'lessons', 'conduct'];
  config.ejected = ['scripts/keel/improve.mjs', '.agents/skills/keel/SKILL.md', 'AGENTS.md#agents-md', 'docs/keel-guide.md#keel-local-rule', '.agents/skills/conduct/SKILL.md', 'scripts/keel/not-present.mjs', 'scripts/keel/missing-tracked.mjs'];
  await put(root, '.keel/keel.json', JSON.stringify(config));
  await applyRename(root, { digest: (await planRename(root)).digest });
  const next = JSON.parse(await get(root, '.plates/plates.json'));
  const all = await load(), selected = targets(next, all), unrestricted = targets({ ...next, ejected: [] }, all);
  assert(unrestricted.some(file => file.path === 'scripts/plates/improve.mjs'));
  assert(!selected.some(file => file.path === 'scripts/plates/improve.mjs'));
  assert(!selected.some(file => file.path === '.agents/skills/plates/SKILL.md'));
  assert(!selected.some(file => file.path === 'AGENTS.md' && file.block === 'agents-md'));
  assert(!selected.some(file => file.practice === 'conduct'), 'local conduct ownership still protects both conduct and spin');
  assert(selected.some(file => file.path === 'scripts/plates/night-plan.mjs'), 'unrelated managed targets remain enabled');
  assert.deepEqual(next.ejected, ['scripts/plates/improve.mjs', '.agents/skills/plates/SKILL.md', 'AGENTS.md#agents-md', 'docs/plates-guide.md#keel-local-rule', '.agents/skills/conduct/SKILL.md', 'scripts/plates/not-present.mjs', 'scripts/plates/missing-tracked.mjs']);
  assert.equal(await get(root, 'scripts/plates/improve.mjs'), custom);
  assert.equal(await get(root, '.agents/skills/conduct/SKILL.md'), '# Acme conductor policy\n');
});

test('absent ejected managed targets remain excluded so rendering cannot recreate them', async t => {
  const root = await fixture(t), config = JSON.parse(await get(root, '.keel/keel.json'));
  config.practices = ['base', 'agents-md', 'night'];
  config.ejected = ['scripts/keel/improve.mjs', 'AGENTS.md#agents-md', '.agents/skills/conduct/SKILL.md', 'docs/acme-owned.md#keel-local-rule'];
  await put(root, '.keel/keel.json', JSON.stringify(config));
  await absent(root, 'scripts/keel/improve.mjs');
  await applyRename(root, { digest: (await planRename(root)).digest });
  const next = JSON.parse(await get(root, '.plates/plates.json')), all = await load();
  assert(targets({ ...next, ejected: [] }, all).some(file => file.path === 'scripts/plates/improve.mjs'));
  assert(!targets(next, all).some(file => file.path === 'scripts/plates/improve.mjs'), 'the missing file is still owned by Acme, not the renderer');
  assert.deepEqual(next.ejected, ['scripts/plates/improve.mjs', 'AGENTS.md#agents-md', '.agents/skills/conduct/SKILL.md', 'docs/acme-owned.md#keel-local-rule']);
  await absent(root, 'scripts/plates/improve.mjs');
});
