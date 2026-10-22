import './helpers/hermetic.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readlink, symlink, link, rm, stat, readdir, chmod, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';
import { run } from './helpers/run.mjs';
import { load, targets } from '../lib/practices.mjs';
import { planRename, applyRename, migrateRename, renameActiveText } from '../lib/rename.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
const put = async (root, path, value) => { await mkdir(join(root, path, '..'), { recursive: true }); await writeFile(join(root, path), value); };
const get = (root, path) => readFile(join(root, path), 'utf8');
const absent = async (root, path) => assert.rejects(stat(join(root, path)), { code: 'ENOENT' });

async function fixture(t, prefix = 'plates-rename-acme-') {
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
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

test('public migration API enforces approval before accessing root and applies only a reviewed digest', async t => {
  const root = await fixture(t), before = git(root, 'status', '--porcelain');
  for (const options of [{ yes: true }, { digest: 'a'.repeat(64) }, { yes: true, digest: 'A'.repeat(64) }, { yes: 'true', digest: 'a'.repeat(64) }]) {
    await assert.rejects(migrateRename({ root, ...options }), /--yes and --digest|lowercase SHA-256|boolean/);
    assert.equal(git(root, 'status', '--porcelain'), before);
    await absent(root, '.plates');await absent(root, '.git/plates-rename');
    let touched = false;
    await assert.rejects(migrateRename({ ...options, get root() { touched = true;throw Error('root accessed'); } }), /--yes and --digest|lowercase SHA-256|boolean/);
    assert.equal(touched, false);
  }
  const preview = await migrateRename({ root });
  const applied = await migrateRename({ root, yes: true, digest: preview.data.digest });
  assert.equal(applied.data.state, 'completed');await absent(root, '.keel');
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

test('self configuration retains lesson and feedback identity across repository rename', async t => {
  const root = await fixture(t);
  await put(root, '.keel/keel.json', JSON.stringify({ name: 'Keel', repo: 'dalmaer/keel', keel: 'self', inbox: 'dalmaer/keel-inbox' }));
  await applyRename(root);
  assert.deepEqual(JSON.parse(await get(root, '.plates/plates.json')), { name: 'Plates', repo: 'dalmaer/plates', plates: 'self', lessonProject: 'dalmaer/keel', feedbackProject: 'dalmaer/keel', inbox: 'dalmaer/keel-inbox' });
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

test('package migration preserves script-key references and executes the npm gate after paths move', async t => {
  const root = await fixture(t);
  const scripts = { keel: 'node scripts/keel/check.mjs', check: 'npm run keel', yarnGate: 'yarn keel', pnpmGate: 'pnpm run keel', 'keel-tools': 'node -e "console.log(\'keel-tools\')"', tools: 'npm run keel-tools' };
  await put(root, 'package.json', JSON.stringify({ name: 'acme-keel-tools', scripts }));
  await applyRename(root);
  const pkg = JSON.parse(await get(root, 'package.json'));
  assert.deepEqual(pkg.scripts, { ...scripts, keel: 'node scripts/plates/check.mjs' });
  const result = run('npm', ['run', 'check', '--offline'], { cwd: root });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /scripts\/plates\/check.mjs/);
});

test('unrelated root and nested package manifests and locks retain dependency identities and exact lock bytes', async t => {
  const root = await fixture(t);
  const pkg = { name: 'acme-keel-tools', dependencies: { '@acme/keel-tools': '1.0.0' }, scripts: { check: 'echo keel-tools' } };
  const lock = JSON.stringify({ name: pkg.name, lockfileVersion: 3, packages: { '': pkg, 'node_modules/@acme/keel-tools': { version: '1.0.0', resolved: 'https://registry.npmjs.org/@acme/keel-tools/-/keel-tools-1.0.0.tgz', integrity: 'sha512-keel', license: 'Acme keel license' } } });
  for (const dir of ['', 'packages/acme/']) {
    await put(root, dir + 'package.json', JSON.stringify(pkg));
    await put(root, dir + 'package-lock.json', lock);
  }
  git(root, 'add', 'package.json', 'package-lock.json', 'packages');
  await applyRename(root);
  for (const dir of ['', 'packages/acme/']) {
    assert.deepEqual(JSON.parse(await get(root, dir + 'package.json')), pkg);
    assert.equal(await get(root, dir + 'package-lock.json'), lock);
  }
});

for (const version of [1, 2, 3]) test(`npm lock v${version} refuses legacy product Git pins without changing manifest or lock`, async t => {
  const root = await fixture(t), ref = 'a'.repeat(40), old = 'git+ssh://git@github.com/dalmaer/keel.git#' + ref;
  const pkg = { name: 'acme', version: '1.0.0', dependencies: { keel: 'github:dalmaer/keel#' + ref, '@acme/keel-tools': '1.0.0' } };
  const other = { version: '1.0.0', resolved: 'https://registry.npmjs.org/@acme/keel-tools/-/keel-tools-1.0.0.tgz', integrity: 'sha512-keel' };
  const lock = { name: 'acme', version: '1.0.0', lockfileVersion: version, requires: true,
    ...(version >= 2 ? { packages: { '': { name: 'acme', version: '1.0.0', dependencies: pkg.dependencies }, 'node_modules/keel': { name: 'keel', version: '0.8.0', resolved: old, license: 'MIT' }, 'node_modules/@acme/keel-tools': other } } : {}),
    ...(version <= 2 ? { dependencies: { keel: { version: old }, '@acme/keel-tools': other } } : {}) };
  const dir = version === 2 ? 'packages/acme/' : '';
  await put(root, dir + 'package.json', JSON.stringify(pkg)); await put(root, dir + 'package-lock.json', JSON.stringify(lock));
  git(root, 'add', dir + 'package.json', dir + 'package-lock.json');
  const before = git(root, 'diff', 'HEAD'), status = git(root, 'status', '--porcelain');
  await assert.rejects(planRename(root), /legacy product Git pin.*explicit compatible upgrade/);
  await assert.rejects(applyRename(root), /legacy product Git pin.*explicit compatible upgrade/);
  assert.equal(await get(root, dir + 'package.json'), JSON.stringify(pkg));
  assert.equal(await get(root, dir + 'package-lock.json'), JSON.stringify(lock));
  assert.equal(git(root, 'diff', 'HEAD'), before);
  assert.equal(git(root, 'status', '--porcelain'), status);
  await absent(root, '.plates');
});

test('script calls retain consumer aliases while explicit CLI calls use Plates without touching quoted prose', async t => {
  const root = await fixture(t), scripts = {
    keel: 'keel doctor', plates: 'echo acme-owned', prekeel: 'echo acme-setup',
    calls: 'npm run keel && pnpm run keel && yarn run keel && pnpm keel && yarn keel',
    cli: 'keel doctor && npx keel doctor && npm exec -- keel doctor && pnpm exec keel doctor && yarn exec keel doctor',
    prose: 'node -e "console.log(\'npx keel\')"',
  };
  await put(root, 'package.json', JSON.stringify({ scripts }));await applyRename(root);
  const next = JSON.parse(await get(root, 'package.json')).scripts;
  assert.deepEqual(next, { ...scripts, keel: 'plates doctor', cli: scripts.cli.replaceAll('keel doctor', 'plates doctor') });
});

test('ambiguous or unsupported relevant locks refuse before migration and unrelated opaque locks stay byte-identical', async t => {
  for (const shape of ['collision', 'mismatch', 'transitive', 'future', 'yarn', 'pnpm', 'bun']) {
    const root = await fixture(t), spec = 'github:dalmaer/keel#' + 'a'.repeat(40);
    const pkg = { dependencies: { keel: spec } }, lock = { lockfileVersion: 3, packages: { '': { dependencies: { keel: spec } }, 'node_modules/keel': { version: '1.0.0', resolved: 'git+https://github.com/dalmaer/keel.git#' + 'a'.repeat(40) } } };
    if (shape === 'collision') lock.packages['node_modules/plates'] = { version: '1.0.0' };
    if (shape === 'mismatch') lock.packages[''].dependencies.keel = 'github:dalmaer/keel#other';
    if (shape === 'transitive') lock.packages['packages/acme'] = { dependencies: { keel: spec } };
    if (shape === 'future') lock.lockfileVersion = 99;
    const path = ({ yarn: 'yarn.lock', pnpm: 'pnpm-lock.yaml', bun: 'bun.lockb' })[shape] ?? 'package-lock.json';
    const content = shape === 'bun' ? Buffer.from([0, 1, 2, 3]) : ['yarn', 'pnpm'].includes(shape) ? spec : JSON.stringify(lock);
    await put(root, 'package.json', JSON.stringify(pkg));await put(root, path, content);git(root, 'add', 'package.json', path);
    const before = git(root, 'status', '--porcelain');
    await assert.rejects(planRename(root), /conflict|disagree|unsupported/);
    assert.equal(git(root, 'status', '--porcelain'), before);await absent(root, '.plates');
  }
  const root = await fixture(t), bytes = Buffer.from([0, 1, 2, 3]);
  for (const [path, content] of [['yarn.lock', 'keel-tools@1.0.0:\n  resolved https://acme.test/keel-tools.tgz\n'], ['pnpm-lock.yaml', 'keel-tools: acme-keel\n'], ['bun.lockb', bytes]]) { await put(root, path, content);git(root, 'add', path); }
  await applyRename(root);
  assert.equal(await get(root, 'yarn.lock'), 'keel-tools@1.0.0:\n  resolved https://acme.test/keel-tools.tgz\n');
  assert.equal(await get(root, 'pnpm-lock.yaml'), 'keel-tools: acme-keel\n');assert.deepEqual(await readFile(join(root, 'bun.lockb')), bytes);
});

test('npm shrinkwrap refuses legacy product pins and dependency-name collisions across fields', async t => {
  const root = await fixture(t), spec = 'github:dalmaer/keel#' + 'a'.repeat(40);
  await put(root, 'package.json', JSON.stringify({ dependencies: { keel: spec }, devDependencies: { plates: '1.0.0' } }));
  await assert.rejects(planRename(root), /conflicting keel and plates dependencies/);
  await put(root, 'package.json', JSON.stringify({ optionalDependencies: { keel: spec } }));
  await put(root, 'npm-shrinkwrap.json', JSON.stringify({ lockfileVersion: 3, packages: { '': { optionalDependencies: { keel: spec } }, 'node_modules/keel': { version: '1.0.0', resolved: 'git+https://github.com/dalmaer/keel.git#' + 'a'.repeat(40), optional: true } } }));
  git(root, 'add', 'package.json', 'npm-shrinkwrap.json');
  const before = git(root, 'diff', 'HEAD');
  await assert.rejects(applyRename(root), /legacy product Git pin.*explicit compatible upgrade/);
  assert.equal(git(root, 'diff', 'HEAD'), before);
  await absent(root, '.plates');
});

test('CLI migration preserves quoted separators and nested commands while renaming unquoted command positions', async t => {
  const root = await fixture(t), scripts = {
    keel: '  keel doctor', npm: ' npm exec -- keel doctor', pnpm: 'pnpm exec keel doctor', yarn: 'yarn exec keel doctor',
    quoted: `node -e "console.log('example; keel doctor && npx keel doctor')"`,
    quotedCommand: '"keel" doctor', nested: 'echo "$(keel doctor)" && keel doctor',
    escaped: 'node -e "console.log(\\"example; keel doctor\\")" && keel doctor',
    incomplete: `echo "example; keel doctor`,
  };
  await put(root, 'package.json', JSON.stringify({ scripts }));await applyRename(root);
  const next = JSON.parse(await get(root, 'package.json')).scripts;
  assert.deepEqual(next, { ...scripts, keel: '  plates doctor', npm: ' npm exec -- plates doctor', pnpm: 'pnpm exec plates doctor', yarn: 'yarn exec plates doctor', escaped: 'node -e "console.log(\\"example; keel doctor\\")" && plates doctor' });
});

test('workflow and shell callers retain package script aliases after migration and execute the gate', async t => {
  const root = await fixture(t);
  await put(root, 'package.json', JSON.stringify({ scripts: { keel: 'node scripts/keel/check.mjs', check: 'npm run keel' } }));
  const workflow = 'jobs:\n  check:\n    steps:\n      - run: npm run keel\n      - run: pnpm run keel\n      - run: yarn run keel\n      - run: yarn keel\n      - run: pnpm keel\n      - run: keel doctor\n';
  await put(root, '.github/workflows/acme.yml', workflow);await put(root, 'scripts/acme-gate.sh', 'npm run keel\n');
  git(root, 'add', 'package.json', '.github/workflows/acme.yml', 'scripts/acme-gate.sh');await applyRename(root);
  assert.equal(await get(root, '.github/workflows/acme.yml'), workflow.replace('run: keel doctor', 'run: plates doctor'));
  assert.equal(await get(root, 'scripts/acme-gate.sh'), 'npm run keel\n');
  const result = run('sh', ['scripts/acme-gate.sh'], { cwd: root });assert.equal(result.status, 0, result.stderr);assert.match(result.stdout, /scripts\/plates\/check.mjs/);
});

test('public migrate CLI requires the reviewed digest and rejects changed source before applying', async t => {
  const root = await fixture(t), bin = new URL('../bin/plates.mjs', import.meta.url).pathname;
  const cli = args => run(process.execPath, [bin, 'migrate', root, ...args, '--json'], { cwd: root });
  const before = git(root, 'status', '--porcelain');
  const refused = cli(['--yes']);assert.equal(refused.status, 2, refused.stdout + refused.stderr);
  assert.match(JSON.parse(refused.stdout).error, /--yes and --digest/);assert.equal(git(root, 'status', '--porcelain'), before);await absent(root, '.git/plates-rename');
  const preview = cli([]);assert.equal(preview.status, 3, preview.stdout);const original = JSON.parse(preview.stdout);
  await put(root, 'README.md', (await get(root, 'README.md')) + '\nKeel integration changed after preview.\n');
  const stale = cli(['--yes', '--digest', original.digest]);assert.equal(stale.status, 2);assert.match(JSON.parse(stale.stdout).error, /preview changed/);await absent(root, '.plates');
  const fresh = cli([]);assert.equal(fresh.status, 3, fresh.stdout);const reviewed = JSON.parse(fresh.stdout);assert.notEqual(reviewed.digest, original.digest);
  const applied = cli(['--yes', '--digest', reviewed.digest]);assert.equal(applied.status, 0, applied.stdout + applied.stderr);assert.equal(JSON.parse(applied.stdout).state, 'completed');await absent(root, '.keel');
});

test('standalone migration helper requires paired approval before reading or mutating the project', async t => {
  const helper = new URL('../scripts/migrate-plates.mjs', import.meta.url).pathname;
  const root = await fixture(t), before = git(root, 'status', '--porcelain');
  for (const target of [root, join(root, 'does-not-exist')]) {
    for (const args of [['--yes'], ['--digest', 'a'.repeat(64)]]) {
      const result = run(process.execPath, [helper, target, '--json', ...args], { cwd: root });
      assert.equal(result.status, 2, result.stdout + result.stderr);
      assert.match(JSON.parse(result.stdout).error, /--yes and --digest must be supplied together/);
      assert.equal(git(root, 'status', '--porcelain'), before);
      await absent(root, '.plates');await absent(root, '.git/plates-rename');
      assert.equal(JSON.parse(await get(root, '.keel/keel.json')).name, 'Acme');
    }
  }
});

test('standalone migration helper refuses duplicate and malformed flags before any migration', async t => {
  const helper = new URL('../scripts/migrate-plates.mjs', import.meta.url).pathname;
  const root = await fixture(t), before = git(root, 'status', '--porcelain');
  const digest = (await planRename(root)).digest;
  for (const args of [
    ['--yes', '--yes', '--digest', digest],
    ['--yes', '--digest', digest, '--digest', digest],
    ['--yes', '--digest', digest, '--json'],
    ['--yes', '--digest'], ['--yes', '--digest', 'A'.repeat(64)],
    ['--yes', '--digest', 'a'.repeat(63)], ['--yes', '--digest', 'g'.repeat(64)],
    ['--yes', '--digest', digest, '--unknown'], ['--yes', '--digest', digest, 'second-root'],
  ]) {
    const result = run(process.execPath, [helper, root, '--json', ...args], { cwd: root });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(JSON.parse(result.stdout).error, /must appear once|SHA-256 preview digest|usage:/);
    assert.equal(git(root, 'status', '--porcelain'), before);
    await absent(root, '.plates');await absent(root, '.git/plates-rename');
  }
});

test('standalone migration helper applies only the current reviewed preview digest', async t => {
  const helper = new URL('../scripts/migrate-plates.mjs', import.meta.url).pathname;
  const root = await fixture(t);
  const cli = args => run(process.execPath, [helper, root, '--json', ...args], { cwd: root });
  const preview = cli([]);assert.equal(preview.status, 3, preview.stdout + preview.stderr);
  const original = JSON.parse(preview.stdout);assert.match(original.digest, /^[a-f0-9]{64}$/);
  await put(root, 'README.md', (await get(root, 'README.md')) + '\nKeel owner change\n');
  const before = git(root, 'status', '--porcelain');
  const stale = cli(['--yes', '--digest', original.digest]);assert.equal(stale.status, 2, stale.stdout + stale.stderr);
  assert.match(JSON.parse(stale.stdout).error, /preview changed/);
  assert.equal(git(root, 'status', '--porcelain'), before);await absent(root, '.plates');await absent(root, '.git/plates-rename/receipt.json');
  const fresh = cli([]);assert.equal(fresh.status, 3, fresh.stdout + fresh.stderr);
  const reviewed = JSON.parse(fresh.stdout);assert.notEqual(reviewed.digest, original.digest);
  const applied = cli(['--yes', '--digest', reviewed.digest]);assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  assert.equal(JSON.parse(applied.stdout).state, 'completed');await absent(root, '.keel');
  assert.match(await get(root, 'README.md'), /owner change/);
});

test('migration executable entry points share approval validation including the legacy executable', async t => {
  const root = await fixture(t), before = git(root, 'status', '--porcelain');
  const entries = [['../bin/plates.mjs', 'migrate'], ['../bin/keel.mjs', 'migrate'], ['../scripts/migrate-plates.mjs']];
  for (const args of [
    ['--yes'], ['--digest', 'a'.repeat(64)], ['--yes', '--digest', 'A'.repeat(64)],
    ['--yes', '--yes', '--digest', 'a'.repeat(64)], ['--yes', '--digest'],
    ['--yes', '--digest', 'a'.repeat(64), '--json'],
  ]) {
    const errors = entries.map(([path, ...prefix]) => {
      const result = run(process.execPath, [new URL(path, import.meta.url).pathname, ...prefix, join(root, 'missing'), '--json', ...args], { cwd: root });
      assert.equal(result.status, 2, result.stdout + result.stderr);
      return JSON.parse(result.stdout).error;
    });
    assert.equal(errors[0], errors[1]);assert.equal(errors[0], errors[2]);
    assert.match(errors[0], /--yes and --digest|SHA-256 preview digest|must appear once/);
  }
  assert.equal(git(root, 'status', '--porcelain'), before);await absent(root, '.git/plates-rename');
  const legacy = new URL('../bin/keel.mjs', import.meta.url).pathname;
  const preview = run(process.execPath, [legacy, 'migrate', root, '--json'], { cwd: root });
  assert.equal(preview.status, 3, preview.stdout + preview.stderr);
  const applied = run(process.execPath, [legacy, 'migrate', root, '--yes', '--digest', JSON.parse(preview.stdout).digest, '--json'], { cwd: root });
  assert.equal(applied.status, 0, applied.stdout + applied.stderr);
  assert.equal(JSON.parse(applied.stdout).state, 'completed');await absent(root, '.keel');
});


test('legacy product Git pins under aliases and nested dependency forms require an explicit compatible upgrade', async t => {
  const refs = ['a'.repeat(40), 'v0.8.0', 'main', 'semver:^0.8', 'v0.8.0'];
  const prefixes = ['github:dalmaer/keel#', 'git+https://github.com/dalmaer/keel.git#', 'git+ssh://git@github.com/dalmaer/keel.git#', 'dalmaer/keel#', 'github:Dalmaer/Keel#'];
  for (const [index, prefix] of prefixes.entries()) {
    const root = await fixture(t), spec = prefix + refs[index];
    const pkg = index === 3 ? { overrides: { '@acme/adapter': { tool: spec } } } : { [index === 2 ? 'peerDependencies' : 'dependencies']: { tool: spec } };
    const path = index % 2 ? 'packages/acme/package.json' : 'package.json';
    await put(root, path, JSON.stringify(pkg));git(root, 'add', path);
    const before = git(root, 'diff', 'HEAD');
    await assert.rejects(applyRename(root), /legacy product Git pin.*explicit compatible upgrade/);
    assert.equal(git(root, 'diff', 'HEAD'), before);
    await absent(root, '.plates');
  }
});

test('an unpinned manifest cannot silently carry a legacy resolved lock commit through migration', async t => {
  const root = await fixture(t), pkg = { dependencies: { keel: 'github:dalmaer/keel' } };
  const lock = { lockfileVersion: 3, packages: { '': pkg, 'node_modules/keel': { resolved: 'git+https://github.com/dalmaer/keel.git#' + 'a'.repeat(40) } } };
  await put(root, 'package.json', JSON.stringify(pkg));await put(root, 'package-lock.json', JSON.stringify(lock));git(root, 'add', 'package.json', 'package-lock.json');
  const before = git(root, 'diff', 'HEAD');
  await assert.rejects(applyRename(root), /legacy product Git pin.*explicit compatible upgrade/);
  assert.equal(git(root, 'diff', 'HEAD'), before);await absent(root, '.plates');
});

test('migrated hosted receipt validator reads existing Keel-Operation intents and exact durable RPCs', async () => {
  const { runReceiptsHarness, token } = await import('./helpers/web-run-receipts.mjs');
  const h = runReceiptsHarness();await h.addOperation();
  const before = structuredClone([...h.db.operations.values()]);
  const moduleUrl = async (relative, dependencies = {}) => {
    const url = new URL(relative, import.meta.url);
    const source = renameActiveText(await readFile(url, 'utf8')).replace(/from (["'])(\.[^"']+)\1/g, (_, quote, path) => 'from ' + quote + (dependencies[path] ?? new URL(path, url).href) + quote);
    return 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  };
  const store = await moduleUrl('../lib/web/operation-store.mjs');
  const migrated = await import(await moduleUrl('../lib/web/run-receipts.mjs', { './operation-store.mjs': store }));
  const receipts = migrated.createRunReceipts(h.config, { fetcher: h.fetcher, now: () => h.state.now });
  const page = await receipts.list(h.access, token, h.project);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].provider.status, 'committed');
  assert.equal(page.coverage.gaps.some(g => g.source === 'web-operations'), false);
  assert.deepEqual([...h.db.operations.values()], before);
  assert.deepEqual(h.source.writes, []);
  for (const [path, literal] of [
    ['../lib/web/media-store.mjs', 'keel_media_rpc'],
    ['../lib/web/operation-store.mjs', 'keel_run_history'],
    ['../lib/web/migrations/006-private-media.sql', 'keel_media_rpc'],
    ['../lib/web/migrations/007-run-history.sql', 'keel_run_history'],
  ]) {
    const source = await readFile(new URL(path, import.meta.url), 'utf8');
    assert.ok(source.includes(literal), path);
    assert.equal(renameActiveText(source).split(literal).length, source.split(literal).length, path);
  }
});


test('package command pins refuse before renamed configuration can strand the old executable', async t => {
  for (const command of ['npx github:dalmaer/keel#v0.8.0 render --check', 'npm install --global git+https://github.com/dalmaer/keel.git#' + 'a'.repeat(40), 'npx dalmaer/keel#main doctor', 'npx GitHub:dalmaer/Keel#v0.8.0 doctor']) {
    const root = await fixture(t);
    await put(root, 'package.json', JSON.stringify({ scripts: { check: command } }));
    const before = git(root, 'diff', 'HEAD');
    await assert.rejects(applyRename(root), /legacy product Git pin.*explicit compatible upgrade/);
    assert.equal(git(root, 'diff', 'HEAD'), before);await absent(root, '.plates');
  }
});

test('known configuration commands and product sources refuse legacy executable pins before any migration', async t => {
  const pin = 'github:dalmaer/keel#' + 'a'.repeat(40), command = 'npx ' + pin + ' doctor';
  for (const extra of [
    { setup: 'npm install --global ' + pin }, { check: command }, { keel: pin }, { plates: pin },
    { climb: { testCommand: command } }, { climb: { build: command } },
    { climb: { perf: { command } } }, { climb: { perf: { check: command } } },
    { loop: { run: command } }, { loop: { afterRender: command } }, { loop: { contexts: [{ command }] } },
    { prove: { command } },
  ]) {
    const root = await fixture(t), config = JSON.parse(await get(root, '.keel/keel.json'));
    if (extra.plates) delete config.keel;
    await put(root, '.keel/keel.json', JSON.stringify({ ...config, ...extra }));
    const before = git(root, 'diff', 'HEAD');
    await assert.rejects(applyRename(root), /legacy product Git pin.*explicit compatible upgrade/);
    assert.equal(git(root, 'diff', 'HEAD'), before);await absent(root, '.plates');
  }
});

test('historical pins in provenance and ordinary consumer identities are not executable migration policy', async t => {
  const root = await fixture(t), pin = 'github:dalmaer/keel#v0.8.0';
  const config = JSON.parse(await get(root, '.keel/keel.json'));
  config.local.phases = 'Originally adopted from ' + pin;
  config.lessonProject = 'acme/keel-history';
  await put(root, '.keel/keel.json', JSON.stringify(config));
  const historical = '# Original adoption\nRecorded source `' + pin + '`.\n';
  await put(root, 'docs/evidence/2020-keel-check.md', historical);
  const pkg = { name: 'acme-keel', description: 'Originally tested with ' + pin, dependencies: { plates: 'github:dalmaer/plates#' + 'b'.repeat(40) } };
  await put(root, 'package.json', JSON.stringify(pkg));
  await applyRename(root);
  assert.equal(JSON.parse(await get(root, '.plates/plates.json')).local.phases, config.local.phases);
  assert.equal(JSON.parse(await get(root, '.plates/plates.json')).lessonProject, config.lessonProject);
  assert.equal(await get(root, 'docs/evidence/2020-plates-check.md'), historical);
  assert.deepEqual(JSON.parse(await get(root, 'package.json')), pkg);
});

// Immutable executable fixtures from fda59e68a1d9d99f27f919c727076d1087b0758f.
// Deflate/base64 keeps the original reader bytes intact without relying on Git history in CI.
const LEGACY_HISTORY_FIXTURES = {
  "production-night.mjs": { sha256: "d7b2dc58a90da8682c9d49025f9a0f8f2421112cdd503b94850482902d6ea978", deflate: "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" },
  "test-history.mjs": { sha256: "5e656638ab55a61748c8cc9df6c5119083a2dbff698a25661d2f9778e04f73d1", deflate: "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" },
  "tend-page": { sha256: "1b2b9b6174f1064f49b06f9c86012b9c4e824c9afcae98877206e6ddef0f31df", deflate: "eJyFlN9P2zAQx9/7V5y0QhLWpGXaHlbUVYVVg2nSEGNPpawmvjZmiR3ZDgVV+d93tgOUp704yvnr733u/AMfa6Ut5EoaC5ezb/M/11ezix/zK5hA9BexTC1KntZsg9FJb0/26/fp9/nZNcmGt04HTjeG+IbvPrYpjR+6MRnADX8PtVa1Mqw0U1grDbZAUFuJuj886fWGR0c9OIJrCuaqqoQ1YITM0cvumMEBIMsL2Apb+NhaSC7kxoAgdmHRjGGxA1OwgfMxzd095nYQpgbg6KfQLjOf4b7hVIxx6f1MlxLi10rJjhjeWDkmq5koUYNkFSX3IJxZgmOSg1S2cNG8YHKDHO4aSwpmvSTyZs47CVCwdVOUNfSFAkZ5w03DNAeW51hbV97AG5FQo1HlA3qjLpejBGGgYvovZVw5/5WHcbQhD9Po5FRkIy2J4hKpfP3u86cxMA8VADiUij5APXD1hM2hLhmL9QC2zBCAOyok7Ei4z8RpeY08ychr2MNwnNaNzK1Q0h+Ks7CjsVbKVeN3s0DG3Qk7n8++RgnsekCuttESNsJ2ykVUqk00gChNNT6gNhh+6PhUzE4Ozg8eR6ODUxqPaWLV3znrNsv6O+ferpZJZuqS7KIbJ0myitWxgckXMJnVooqTJFuL0qKOT5UqkckgyZ3EEUF3LRaCWnKn+NOSkPM901GUnOzpurNCotipYTqFKHqFkFGyGC33F4QdmsAiy7I3S6i+vJiVZXx2cT1Plh6rcljV4nj5JidnT2SwfyMzfMQ87liSaUYrwgKxhtjJDw9B4haucDN/rOPVbX+3f+/bMfR3JGv7K+p2RTDEaPfpkq45zwjUQ19FzWxhfq5fdo+L9Tq1GrttkyoNFy0VvIuwClMly6cXgUYXM/5f0yj4c7UB36fKSpQbegcmkwkcu2p8lFrrIy/vzCVdBqKhUoi4O1z+iaBbQ/v59o2g52MZ3okx3fIGoQ1pWz/+b3VQt4Ta9nr/ANOErrE=" },
};
const HISTORY_ARCHIVE = "UEsDBBQAAAAAAAmRVV01xQU2NgAAADYAAAATAAAAYWNtZS1yZWNvdmVyZWQuanNvbnsiZGF0ZSI6IjIwMjYtMTAtMDlUMDE6MDA6MDBaIiwidGVzdHMiOltdLCJhY21lIjp0cnVlfVBLAQIUAxQAAAAAAAmRVV01xQU2NgAAADYAAAATAAAAAAAAAAAAAACAAQAAAABhY21lLXJlY292ZXJlZC5qc29uUEsFBgAAAAABAAEAQQAAAGcAAAAAAA==";

const legacyHistorySource = name => {
  const entry = LEGACY_HISTORY_FIXTURES[name], source = inflateSync(Buffer.from(entry.deflate, 'base64')).toString('utf8');
  assert.equal(sha(source), entry.sha256, 'the historical executable fixture remains byte-exact');
  return source;
};
async function migratedHistory(t, name) {
  const root = await fixture(t), path = 'scripts/keel/' + name;
  await put(root, path, legacyHistorySource(name));git(root, 'add', path);
  const cfg = JSON.parse(await get(root, '.keel/keel.json'));cfg.ci = { gateWorkflow: 'check.yml' };
  await put(root, '.keel/keel.json', JSON.stringify(cfg));
  await put(root, '.github/workflows/check.yml', 'on: push\njobs:\n  check:\n    steps:\n      - run: npm run check\n');git(root, 'add', '.github/workflows/check.yml');
  if (name === 'production-night.mjs') {
    const workflowPath = '.github/workflows/keel-night.yml';
    const workflow = await get(root, workflowPath) + '\n      - uses: actions/upload-artifact@v7\n        with:\n          name: keel-production-${{ github.run_attempt }}\n          path: ${{ runner.temp }}/keel-production/\n';
    await put(root, workflowPath, workflow);
    const lock = JSON.parse(await get(root, '.keel/lock.json'));lock.files[workflowPath].sha256 = sha(workflow);await put(root, '.keel/lock.json', JSON.stringify(lock));
  }
  await applyRename(root);
  const output = join(root, 'scripts/plates', name), source = await readFile(output, 'utf8');
  // Execute the migrated reader with its real shipped dependencies; no CLI main or network runs.
  const base = new URL('../practices/night/files/scripts/plates/' + name, import.meta.url);
  await writeFile(output, source.replace(/from (["'])(\.[^"']+)\1/g, (_, quote, path) => 'from ' + quote + new URL(path, base).href + quote));
  return { root, reader: await import(pathToFileURL(output).href) };
}

test('exact legacy production reader migration restores immutable old workflow config and artifact provenance', async t => {
  const { root, reader } = await migratedHistory(t, 'production-night.mjs');
  assert.match(await get(root, '.github/workflows/plates-night.yml'), /name: plates-production-\$\{\{ github\.run_attempt \}\}/);
  assert.match(await get(root, '.github/workflows/plates-night.yml'), /runner\.temp \}\}\/plates-production\//);
  const { emptyState, digest } = await import('../practices/night/files/scripts/plates/production-store.mjs');
  const repo = 'acme/studio', config = { production: { version: 1, enabled: true, sources: [{ id: 'acme', provider: 'json', service: 'acme', environment: 'production', input: 'events.json', windowMinutes: 60, maxEvents: 10, maxBytes: 10000, timeoutMs: 1000, threshold: 2 }] } };
  const env = { GITHUB_REPOSITORY: repo, GITHUB_REF_NAME: 'main', BASE: 'main', GITHUB_EVENT_NAME: 'schedule', GITHUB_RUN_ID: '3', GITHUB_RUN_ATTEMPT: '1' };
  const old = { id: 1, run_attempt: 2, head_sha: 'a'.repeat(40), head_branch: 'main', head_repository: { full_name: repo }, repository: { full_name: repo }, path: '.github/workflows/keel-night.yml', event: 'schedule', pull_requests: [], status: 'completed', run_started_at: '2026-10-17T09:00:00Z' };
  const snapshot = emptyState(), envelope = { version: 1, state: 'retained', provenance: { repo, workflow: old.path, runId: '1', attempt: 2, headSha: old.head_sha }, snapshot, digest: digest(snapshot) };
  const before = JSON.stringify(envelope), calls = [], downloads = [];
  const api = async path => {
    calls.push(path);
    if (path.includes('/workflows/plates-night.yml/')) return { workflow_runs: [], total_count: 0 };
    if (path.includes('/workflows/keel-night.yml/')) return { workflow_runs: [old], total_count: 1 };
    if (path.includes('/contents/.keel/keel.json?ref=' + old.head_sha)) return { encoding: 'base64', content: Buffer.from(JSON.stringify(config)).toString('base64') };
    if (path.includes('/artifacts?')) return { artifacts: [{ name: 'keel-production-2', expired: false, size_in_bytes: 1000 }], total_count: 1 };
    throw Error('unexpected history request ' + path);
  };
  const result = await reader.recoverNight({ root, config, env, api, download: async (run, name) => { downloads.push([run.id, name]);return envelope; } });
  assert.equal(result.state, 'restored');assert.deepEqual(downloads, [[1, 'keel-production-2']]);assert.equal(JSON.stringify(envelope), before);
  assert.ok(calls.some(path => path.includes('/contents/.keel/keel.json?ref=' + old.head_sha)));
  await assert.rejects(reader.recoverNight({ root, config, env, api: path => path.includes('/workflows/keel-night.yml/') ? Promise.reject(Object.assign(Error('forbidden'), { status: 403 })) : api(path) }), /forbidden/);
  const newer = { ...old, id: 2, path: '.github/workflows/plates-night.yml', run_started_at: '2026-10-18T09:00:00Z' };
  await assert.rejects(reader.recoverNight({ root, config, env, api: async path => {
    if (path.includes('/workflows/plates-night.yml/')) return { workflow_runs: [newer], total_count: 1 };
    if (path.includes('/contents/.plates/plates.json?')) return { encoding: 'base64', content: Buffer.from(JSON.stringify(config)).toString('base64') };
    if (path.includes('/runs/2/artifacts?')) return { artifacts: [], total_count: 0 };
    return api(path);
  }, download: async () => { throw Error('must not recover older state'); } }), /missing/);
});

test('exact legacy test-history reader migration imports old archives into the canonical ledger', async t => {
  const { root, reader } = await migratedHistory(t, 'test-history.mjs');
  const repo = 'acme/studio', head = 'a'.repeat(40), date = '2026-10-09T01:00:00Z', calls = [], downloads = [];
  const artifact = { id: 1, name: 'keel-test-runs', expired: false, created_at: date, size_in_bytes: 100, workflow_run: { id: 101, repository_id: 7, head_repository_id: 7, head_branch: 'main', head_sha: head } };
  const routes = {
    ['repos/' + repo]: { id: 7, full_name: repo, default_branch: 'main' },
    ['repos/' + repo + '/actions/workflows/plates-night.yml']: { id: 10, path: '.github/workflows/plates-night.yml' },
    ['repos/' + repo + '/actions/workflows/keel-night.yml']: { id: 12, path: '.github/workflows/keel-night.yml' },
    ['repos/' + repo + '/actions/workflows/check.yml']: { id: 11, path: '.github/workflows/check.yml' },
    ['repos/' + repo + '/actions/artifacts?name=plates-test-runs&per_page=100&page=1']: { total_count: 0, artifacts: [] },
    ['repos/' + repo + '/actions/artifacts?name=keel-test-runs&per_page=100&page=1']: { total_count: 1, artifacts: [artifact] },
    ['repos/' + repo + '/actions/artifacts/1']: artifact,
    ['repos/' + repo + '/actions/runs/101']: { id: 101, workflow_id: 12, path: '.github/workflows/keel-night.yml', repository: { id: 7, full_name: repo }, head_repository: { id: 7, full_name: repo }, head_branch: 'main', head_sha: head, status: 'completed', updated_at: date, event: 'schedule', pull_requests: [] },
  };
  const result = await reader.recoverTestHistory({ root, repo, branch: 'main', at: '2026-10-10T12:00:00Z', github: async path => { calls.push(path);assert.ok(routes[path], path);return structuredClone(routes[path]); }, download: async id => { downloads.push(id);return Buffer.from(HISTORY_ARCHIVE, 'base64'); } });
  assert.equal(result.imported, 1);assert.deepEqual(downloads, [1]);assert.equal(JSON.parse(await get(root, '.plates/test-runs/acme-recovered.json')).acme, true);
  assert.ok(calls.some(path => path.includes('/workflows/keel-night.yml')));assert.equal(result.selected[0].artifactId, 1);
});

test('unknown local history reader variants refuse before writes instead of losing historical evidence', async t => {
  for (const name of ['production-night.mjs', 'test-history.mjs']) {
    const root = await fixture(t), path = 'scripts/keel/' + name, source = legacyHistorySource(name) + '\n// Acme owns this variant.\n';
    await put(root, path, source);git(root, 'add', path);const before = git(root, 'diff', 'HEAD');
    await assert.rejects(applyRename(root), /history reader.*explicit compatibility upgrade/);
    assert.equal(git(root, 'diff', 'HEAD'), before);assert.equal(await get(root, path), source);await absent(root, '.plates');
  }
});

test('generic migration preserves immutable artifact names and executes the old tend-page reader for both subjects', () => {
  const source = legacyHistorySource('tend-page');
  const code = renameActiveText(source).replaceAll('export const ', 'const ').replaceAll('export function ', 'function ');
  for (const brand of ['keel', 'plates']) {
    const body = `${brand} tend: 2026-10-21, 1 proposal for the owner\n\nTend: acme-find\nkeel-tend-page: 2026-10-21`;
    const reader = new Function('git', 'pathsOf', 'proposalsPageOf', 'CITE', code + ';return tendCommits;')(() => 'abc\0' + body + '\x01', () => ['docs/tend/2026-10-21.md'], day => 'docs/tend/' + day + '.md', /^Tend: (.+)$/gm);
    assert.equal(reader('unused', 'base')[0].page, true, brand);assert.deepEqual(reader('unused', 'base')[0].cites, []);
  }
  for (const value of ['keel-test-runs', 'keel-production-2', '`keel-production-${run.run_attempt}`', "artifact: 'keel-production-'", 'keel-tend-page', 'keel_connection_rpc', 'create function public.keel_connection_rpc()']) assert.equal(renameActiveText(value), value);
});


async function privateRuntimeFixture(t) {
  const root = await fixture(t);
  for (const path of ['feedback', 'feedback/records', 'feedback/empty']) {
    await mkdir(join(root, '.keel', path), { recursive: true });await chmod(join(root, '.keel', path), 0o700);
  }
  await put(root, '.keel/feedback/records/acme.json', 'private original receipt');await chmod(join(root, '.keel/feedback/records/acme.json'), 0o600);
  return root;
}
test('runtime directory modes are reviewed and private/empty directories survive before bytes publish', async t => {
  const root = await privateRuntimeFixture(t), preview = await planRename(root);
  assert.ok(preview.runtimeDirectories.some(d => d.from === '.keel/feedback/empty' && d.to === '.plates/feedback/empty' && d.mode === 0o700));
  const original = await stat(join(root, '.keel/feedback'));
  const directory = preview.runtimeDirectories.find(d => d.from === '.keel/feedback');
  assert.equal(directory.uid, original.uid);assert.equal(directory.gid, original.gid);
  const { safeDirectory } = await import('../lib/feedback-store.mjs');let observed = false;
  await applyRename(root, { digest: preview.digest, async afterBackup(index) {
    if (preview.files[index].to !== '.plates/feedback/records/acme.json') return;
    observed = true;
    await safeDirectory(join(root, '.plates/feedback'), { privateMode: true });
    await safeDirectory(join(root, '.plates/feedback/records'), { privateMode: true });
    await absent(root, '.plates/feedback/records/acme.json');
  } });
  assert.equal(observed, true);
  for (const path of ['feedback', 'feedback/records', 'feedback/empty']) await safeDirectory(join(root, '.plates', path), { privateMode: true });
  const migrated = await stat(join(root, '.plates/feedback'));
  assert.equal(migrated.uid, original.uid);assert.equal(migrated.gid, original.gid);
  assert.equal(await get(root, '.plates/feedback/records/acme.json'), 'private original receipt');
  assert.equal((await stat(join(root, '.plates/feedback/records/acme.json'))).mode & 0o777, 0o600);
});

test('runtime permission changes invalidate the preview without touching canonical directories', async t => {
  const root = await privateRuntimeFixture(t), preview = await planRename(root);
  await chmod(join(root, '.keel/feedback/records'), 0o750);
  await assert.rejects(applyRename(root, { digest: preview.digest }), /preview changed/);
  await absent(root, '.plates');await absent(root, '.git/plates-rename/receipt.json');
});

test('runtime permissions survive crash recovery and changed canonical modes are refused without chmod repair', async t => {
  for (const changed of [false, true]) {
    const root = await privateRuntimeFixture(t), preview = await planRename(root);
    const index = preview.files.findIndex(f => f.to === '.plates/feedback/records/acme.json');
    await assert.rejects(applyRename(root, { digest: preview.digest, afterBackup(at) { if (at === index) throw Error('private publication interrupted'); } }), /private publication interrupted/);
    assert.equal((await stat(join(root, '.plates/feedback/records'))).mode & 0o777, 0o700);
    if (changed) {
      await chmod(join(root, '.plates/feedback/records'), 0o755);
      await assert.rejects(applyRename(root, { digest: preview.digest }), /runtime directory.*changed/);
      assert.equal((await stat(join(root, '.plates/feedback/records'))).mode & 0o777, 0o755);
      await absent(root, '.plates/feedback/records/acme.json');
    } else {
      await applyRename(root, { digest: preview.digest });
      assert.equal(await get(root, '.plates/feedback/records/acme.json'), 'private original receipt');
      assert.equal((await stat(join(root, '.plates/feedback/empty'))).mode & 0o777, 0o700);
    }
  }
});

test('runtime modes are rechecked after the last backup before private publication', async t => {
  const root = await privateRuntimeFixture(t), preview = await planRename(root);
  await assert.rejects(applyRename(root, { digest: preview.digest, async afterBackup(index) {
    if (preview.files[index].to === '.plates/feedback/records/acme.json') await chmod(join(root, '.plates/feedback/records'), 0o755);
  } }), /runtime directory.*changed/);
  await absent(root, '.plates/feedback/records/acme.json');
});

test('runtime ownership evidence is enforced during recovery without changing owners', async t => {
  for (const identity of ['uid', 'gid']) {
    const root = await privateRuntimeFixture(t), preview = await planRename(root);
    const index = preview.files.findIndex(f => f.to === '.plates/feedback/records/acme.json');
    await assert.rejects(applyRename(root, { afterBackup(at) { if (at === index) throw Error('interrupted'); } }), /interrupted/);
    const path = '.git/plates-rename/receipt.json', receipt = JSON.parse(await get(root, path));
    const original = await stat(join(root, '.plates/feedback/records'));
    receipt.plan.runtimeDirectories.find(d => d.to === '.plates/feedback/records')[identity] = original[identity] + 1;
    delete receipt.plan.digest;receipt.plan.digest = sha(JSON.stringify(receipt.plan));await put(root, path, JSON.stringify(receipt));
    await assert.rejects(applyRename(root), /runtime directory.*changed/);
    assert.equal((await stat(join(root, '.plates/feedback/records')))[identity], original[identity]);
    await absent(root, '.plates/feedback/records/acme.json');
  }
});

test('older incomplete receipts without directory mode evidence require explicit recovery review', async t => {
  const root = await privateRuntimeFixture(t);
  await assert.rejects(applyRename(root, { afterBackup() { throw Error('interrupted'); } }), /interrupted/);
  const path = '.git/plates-rename/receipt.json', receipt = JSON.parse(await get(root, path));
  delete receipt.plan.runtimeDirectories;delete receipt.plan.digest;receipt.plan.digest = sha(JSON.stringify(receipt.plan));
  await put(root, path, JSON.stringify(receipt));
  const before = git(root, 'diff', 'HEAD');
  await assert.rejects(applyRename(root), /legacy migration receipt.*directory.*review/);
  assert.equal(git(root, 'diff', 'HEAD'), before);
});

test('tracked workflow and shell executable pins refuse before any rename across case and SSH variants', async t => {
  for (const [path, source] of [
    ['.github/workflows/check.yml', 'jobs:\n  check:\n    steps:\n      - run: npx -y github:dalmaer/keel#v0.8.0 doctor --json\n'],
    ['scripts/check.sh', '#!/bin/sh\nnpx -y git+ssh://git@github.com/Dalmaer/KeEl.git#v0.8.0 doctor --json\n'],
    ['scripts/check', '#!/usr/bin/env bash\nnpx -y GitHub:Dalmaer/Keel#v0.8.0 doctor --json\n'],
  ]) {
    const root = await fixture(t);await put(root, path, source);git(root, 'add', path);const before = git(root, 'diff', 'HEAD');
    await assert.rejects(applyRename(root), /legacy product Git pin.*explicit compatible upgrade/);
    assert.equal(git(root, 'diff', 'HEAD'), before);assert.equal(await get(root, path), source);await absent(root, '.plates');
  }
});

test('historical command evidence and inactive shell comments do not become executable pin refusals', async t => {
  const root = await fixture(t), history = '# Original check\nRan `npx github:dalmaer/keel#v0.8.0 doctor`.\n';
  await put(root, 'docs/evidence/2020-keel-check.md', history);
  await put(root, 'scripts/check.sh', '#!/bin/sh\n# Originally ran npx github:dalmaer/keel#v0.8.0 doctor\nnode scripts/keel/check.mjs\n');git(root, 'add', 'scripts/check.sh');
  await applyRename(root);
  assert.equal(await get(root, 'docs/evidence/2020-plates-check.md'), history);
  assert.match(await get(root, 'scripts/check.sh'), /node scripts\/plates\/check.mjs/);
});


test('migration preserves worker RPC, dispatch identity and existing provider run recognition', () => {
  const source = "export const rpc = 'keel_job_rpc'; export const inputs = id => ({ keel_operation: id }); export const title = id => `keel-web-${id}`; export const lane = id => `keel-web-typecheck-${id}`;";
  const migrated = renameActiveText(source).replaceAll('export const ', 'const ');
  const runtime = new Function(migrated + ';return {rpc, inputs, title, lane};')();
  const id = 'a'.repeat(64), existing = { display_title: `keel-web-${id}`, inputs: { keel_operation: id }, lane: `keel-web-typecheck-${id}` };
  assert.equal(runtime.rpc, 'keel_job_rpc');
  assert.deepEqual(runtime.inputs(id), existing.inputs);
  assert.equal(runtime.title(id), existing.display_title);
  assert.equal(runtime.lane(id), existing.lane);
  assert.equal(renameActiveText('create function public.keel_job_rpc()'), 'create function public.keel_job_rpc()');
});

test('migration preserves fleet update RPC and durable publication reconciliation identities', () => {
  const source = "const rpc = 'keel_fleet_rpc'; const branch = `keel/web-update-${id}`; const marker = `Keel-Update-Operation: ${id}`;";
  assert.equal(renameActiveText(source), source);
});

test('migration preserves model store and credential RPC identities against existing private records', async () => {
  const { modelHarness } = await import('./helpers/web-model-tasks.mjs');
  const { fakeKey } = await import('./helpers/web-connections.mjs');
  const h = await modelHarness(), requests = [];
  const fetcher = (url, options) => { requests.push(new URL(url).pathname); return h.fetcher(url, options); };
  async function migrated(relative) {
    const url = new URL(relative, import.meta.url);
    const source = renameActiveText(await readFile(url, 'utf8')).replace(/from (["'])(\.[^"']+)\1/g, (_, quote, path) => 'from ' + quote + new URL(path, url).href + quote);
    return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  }
  const models = (await migrated('../lib/web/model-store.mjs')).createModelStore(h.config, fetcher);
  assert.deepEqual(await models.list(h.access.userId, h.project), { rows: [], nextCursor: null });
  const vault = (await migrated('../lib/web/connection-store.mjs')).createConnectionStore(h.config, fetcher);
  const policy = h.workspace.files['connections/acme-openai.json'], descriptor = JSON.parse(policy);
  assert.equal(await vault.readKey(descriptor, { policyDigest: sha(policy), expectedVersion: 1 }), fakeKey);
  assert.deepEqual(requests, ['/rest/v1/rpc/keel_model_rpc', '/rest/v1/rpc/keel_model_credential_read']);
  assert.equal(h.model.calls.length, 0);
});


test('symlink migration preserves the absolute checkout root while moving its inventoried target', async t => {
  const root = await fixture(t, 'keel-rename-acme-');
  await symlink(join(root, 'scripts/keel/check.mjs'), join(root, 'keel-absolute-link'));
  git(root, 'add', 'keel-absolute-link');
  const plan = await planRename(root);
  await applyRename(root, { digest: plan.digest });
  assert.equal(await readlink(join(root, 'plates-absolute-link')), join(root, 'scripts/plates/check.mjs'));
  assert.equal(await get(root, 'plates-absolute-link'), await get(root, 'scripts/plates/check.mjs'));
});

test('symlink migration follows opaque runtime files and directories without renaming record identities', async t => {
  const root = await fixture(t);
  await put(root, '.keel/test-runs/keel-result.json', '{"receipt":"keel-identity"}\n');
  await symlink('.keel/test-runs/keel-result.json', join(root, 'latest-run'));
  await symlink('.keel/test-runs', join(root, 'run-directory'));
  await symlink('.keel', join(root, 'runtime-root'));
  await symlink('../../scripts/keel/check.mjs', join(root, '.keel/test-runs/check-link'));
  git(root, 'add', 'latest-run', 'run-directory', 'runtime-root');
  const plan = await planRename(root);
  await applyRename(root, { digest: plan.digest });
  assert.equal(await readlink(join(root, 'latest-run')), '.plates/test-runs/keel-result.json');
  assert.equal(await get(root, 'latest-run'), '{"receipt":"keel-identity"}\n');
  assert.equal(await readlink(join(root, 'run-directory')), '.plates/test-runs');
  assert.equal(await get(root, 'run-directory/keel-result.json'), await get(root, 'latest-run'));
  assert.equal(await readlink(join(root, 'runtime-root')), '.plates');
  assert.equal(await get(root, 'runtime-root/plates.json'), await get(root, '.plates/plates.json'));
  assert.equal(await readlink(join(root, '.plates/test-runs/check-link')), '../../scripts/plates/check.mjs');
  assert.equal(await get(root, '.plates/test-runs/check-link'), await get(root, 'scripts/plates/check.mjs'));
});

test('symlink migration refuses partially moved directory targets before writing', async t => {
  const root = await fixture(t);
  await put(root, 'scripts/keel/private.txt', 'untracked owner data\n');
  await symlink('scripts/keel', join(root, 'script-directory'));
  git(root, 'add', 'script-directory');
  const before = git(root, 'diff', 'HEAD');
  await assert.rejects(applyRename(root), /ambiguous migration directory link target: scripts\/keel/);
  assert.equal(git(root, 'diff', 'HEAD'), before);
  assert.equal(await get(root, 'scripts/keel/private.txt'), 'untracked owner data\n');
  await absent(root, '.plates');
});

test('symlink migration keeps stable unowned targets and relative semantics when the link moves', async t => {
  const root = await fixture(t);
  await put(root, 'user-keel-assets/note.txt', 'private untracked target\n');
  await mkdir(join(root, 'keel-links'));
  await symlink('../user-keel-assets/note.txt', join(root, 'keel-links/personal'));
  await symlink('../scripts/keel/check.mjs', join(root, 'keel-links/relative'));
  await symlink('missing-keel-target', join(root, 'dangling'));
  git(root, 'add', 'keel-links', 'dangling');
  const plan = await planRename(root);
  await applyRename(root, { digest: plan.digest });
  assert.equal(await readlink(join(root, 'plates-links/personal')), '../user-keel-assets/note.txt');
  assert.equal(await get(root, 'plates-links/personal'), 'private untracked target\n');
  assert.equal(await readlink(join(root, 'plates-links/relative')), '../scripts/plates/check.mjs');
  assert.equal(await get(root, 'plates-links/relative'), await get(root, 'scripts/plates/check.mjs'));
  assert.equal(await readlink(join(root, 'dangling')), 'missing-keel-target');
  assert.equal(await get(root, 'user-keel-assets/note.txt'), 'private untracked target\n');
});

// Synthetic installed modules exercise Node resolution, not just string output.
test('module references: migration preserves unrelated static, exported, dynamic and required package specifiers', async t => {
  const root = await fixture(t);
  const dependencies = { '@acme/keel-tools': '1.0.0', 'keel-supplies': '1.0.0', '@keel-lab/widgets': '1.0.0', keel: '1.0.0' };
  const pkg = { name: 'acme', type: 'module', dependencies };
  await put(root, 'package.json', JSON.stringify(pkg));
  for (const name of Object.keys(dependencies)) {
    await put(root, `node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0', main: 'index.cjs' }));
    await put(root, `node_modules/${name}/index.cjs`, 'module.exports = 7;\n');
    await put(root, `node_modules/${name}/keel-part.cjs`, 'module.exports = 11;\n');
  }
  await put(root, 'src/reexport.mjs', "export { default as value } from '@keel-lab/widgets/keel-part.cjs';\nexport * from '@acme/keel-tools';\n");
  await put(root, 'src/require.cjs', "require.resolve(`@acme/keel-tools/keel-part.cjs`);\nmodule.exports = require(/* acme */ 'keel-supplies/keel-part.cjs') + require('keel');\n");
  await put(root, 'src/modules.mjs', [
    "import tools from '@acme/keel-tools';",
    "import '@keel-lab/widgets';",
    "import { value } from './reexport.mjs';",
    "import required from './require.cjs';",
    "const lazy = await import(/* acme */ `keel-supplies/keel-part.cjs`);",
    "if (!import.meta.resolve('@keel-lab/widgets/keel-part.cjs').includes('node_modules')) throw Error('missing module');",
    "console.log(JSON.stringify([tools, value, required, lazy.default]));",
  ].join('\n'));
  git(root, 'add', 'package.json', 'src');
  const before = run(process.execPath, ['src/modules.mjs'], { cwd: root });
  assert.equal(before.status, 0, before.stderr);
  await applyRename(root);
  const after = run(process.execPath, ['src/modules.mjs'], { cwd: root });
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.stdout, before.stdout);
  assert.deepEqual(JSON.parse(await get(root, 'package.json')), pkg);
  assert.match(await get(root, 'src/modules.mjs'), /@acme\/keel-tools/);
});

test('module references: relative imports follow actual moved files while untracked local targets stay put', async t => {
  const root = await fixture(t);
  await put(root, 'scripts/keel/part.mjs', 'export const value = 13;\n');
  await put(root, 'src/keel-private.mjs', 'export const value = 17;\n');
  await put(root, 'keel-entry/private.mjs', 'export const value = 19;\n');
  await put(root, 'keel-entry/main.mjs', [
    "import { value as managed } from '../scripts/keel/part.mjs?acme';",
    "import { value as untracked } from '../src/keel-private.mjs';",
    "import { value as colocated } from './private.mjs';",
    'console.log(JSON.stringify([managed, untracked, colocated]));',
  ].join('\n'));
  git(root, 'add', 'scripts/keel/part.mjs', 'keel-entry/main.mjs');
  const before = run(process.execPath, ['keel-entry/main.mjs'], { cwd: root });
  assert.equal(before.status, 0, before.stderr);
  await applyRename(root);
  const after = run(process.execPath, ['plates-entry/main.mjs'], { cwd: root });
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.stdout, before.stdout);
  const source = await get(root, 'plates-entry/main.mjs');
  assert.match(source, /scripts\/plates\/part\.mjs\?acme/);
  assert.match(source, /src\/keel-private\.mjs/);
  assert.match(source, /\.\.\/keel-entry\/private\.mjs/);
  await absent(root, 'src/plates-private.mjs');
});

test('module references: only the nearest identified product dependency changes package roots, preserving subpaths', async t => {
  const root = await fixture(t);
  await put(root, 'package.json', JSON.stringify({ type: 'module', dependencies: { keel: 'github:dalmaer/keel' } }));
  await put(root, 'src/product.mjs', "export { default } from 'keel/lib/acme.cjs';\n");
  await put(root, 'packages/acme/package.json', JSON.stringify({ type: 'module', dependencies: { keel: '1.0.0' } }));
  await put(root, 'packages/acme/index.mjs', "export { default } from 'keel/lib/acme.cjs';\n");
  for (const [dir, value] of [['node_modules/plates', 23], ['packages/acme/node_modules/keel', 29]]) {
    await put(root, `${dir}/package.json`, JSON.stringify({ main: 'lib/acme.cjs' }));
    await put(root, `${dir}/lib/acme.cjs`, `module.exports = ${value};\n`);
  }
  git(root, 'add', 'package.json', 'src/product.mjs', 'packages/acme/package.json', 'packages/acme/index.mjs');
  await applyRename(root);
  assert.match(await get(root, 'src/product.mjs'), /from 'plates\/lib\/acme.cjs'/);
  assert.match(await get(root, 'packages/acme/index.mjs'), /from 'keel\/lib\/acme.cjs'/);
  const result = run(process.execPath, ['--input-type=module', '-e', "import a from './src/product.mjs'; import b from './packages/acme/index.mjs'; console.log(a,b);"], { cwd: root });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '23 29');
});

test('module references: computed package expressions and constants retain executable resolution', async t => {
  const root = await fixture(t);
  await put(root, 'node_modules/@acme/keel-tools/package.json', JSON.stringify({ main: 'index.cjs' }));
  await put(root, 'node_modules/@acme/keel-tools/index.cjs', 'module.exports = 37;\n');
  await put(root, 'src/computed.mjs', [
    "import { createRequire } from 'node:module';",
    'const require = createRequire(import.meta.url);',
    "const name = '@acme/keel-tools', prefix = '@acme', suffix = 'tools';",
    "const a = await import(name), b = await import(prefix + '/keel-tools');",
    "const c = await import('@acme/' + 'keel-tools');",
    'const d = await import(`@acme/keel-${suffix}`);',
    "if (require.resolve(prefix + '/keel-tools') !== import.meta.resolve(name).replace('file://', '')) throw Error('resolution changed');",
    "console.log(JSON.stringify([a.default, b.default, c.default, d.default, require(name), require(prefix + '/keel-tools')]));",
    "// Keel product copy is ordinary prose, even beside a computed import.",
    "const productCopy = 'Keel keeps projects moving';",
  ].join('\n'));
  git(root, 'add', 'src/computed.mjs');
  const before = run(process.execPath, ['src/computed.mjs'], { cwd: root });
  assert.equal(before.status, 0, before.stderr);
  await applyRename(root);
  const after = run(process.execPath, ['src/computed.mjs'], { cwd: root });
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.stdout, before.stdout);
  const source = await get(root, 'src/computed.mjs');
  assert.match(source, /const name = '@acme\/keel-tools'/);
  assert.match(source, /Plates keeps projects moving/);
});

test('module references: managed lazy and URL loaders follow exact inventoried files', async t => {
  const root = await fixture(t);
  await put(root, 'scripts/keel/part.mjs', 'export const value = 41;\n');
  await put(root, 'src/lazy.mjs', [
    "import { pathToFileURL } from 'node:url';",
    "import { join } from 'node:path';",
    'const lazy = path => () => import(path);',
    "const load = lazy('../scripts/keel/part.mjs');",
    "const other = await import(pathToFileURL(join(process.cwd(), 'scripts/keel/part.mjs')).href);",
    'let count = 0;',
    'const fresh = await import(`../scripts/keel/part.mjs?cache=${count++}`);',
    'console.log((await load()).value, other.value, fresh.value);',
  ].join('\n'));
  git(root, 'add', 'src/lazy.mjs', 'scripts/keel/part.mjs');
  const before = run(process.execPath, ['src/lazy.mjs'], { cwd: root });
  assert.equal(before.status, 0, before.stderr);
  await applyRename(root);
  const after = run(process.execPath, ['src/lazy.mjs'], { cwd: root });
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.stdout, before.stdout);
  assert.match(await get(root, 'src/lazy.mjs'), /scripts\/plates\/part.mjs/);
});

test('module references: affected unresolved interpolation refuses with its path before writes', async t => {
  for (const source of ['import(`./keel-${name}.mjs`);', 'import(`@acme/${keelName}`);']) {
    const root = await fixture(t);
    await put(root, 'src/computed.mjs', source);
    git(root, 'add', 'src/computed.mjs');
    const before = git(root, 'diff', 'HEAD');
    await assert.rejects(applyRename(root), /src\/computed.mjs: affected computed module interpolation/, source);
    assert.equal(git(root, 'diff', 'HEAD'), before);
    await absent(root, '.plates');
  }
});

test('module references: escaped literals preserve external spelling and map identified local targets', async t => {
  const root = await fixture(t);
  await put(root, 'src/keel-part.mjs', 'export const value = 31;\n');
  await put(root, 'src/escaped.mjs', String.raw`import { value } from './\u006beel-part.mjs'; console.log(value);`);
  git(root, 'add', 'src');
  await applyRename(root);
  const result = run(process.execPath, ['src/escaped.mjs'], { cwd: root });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), '31');
  const external = String.raw`export { default } from '@acme/\u006beel-tools';`;
  assert.equal(renameActiveText(external), external);
});
