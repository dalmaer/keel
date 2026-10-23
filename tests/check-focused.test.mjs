// The early preflight must catch repository-wide conventions before a full gate.
import './helpers/hermetic.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink, realpath, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { run } from './helpers/run.mjs';
import { focusedPlan, runFocusedPlan } from '../scripts/check-focused.mjs';

const ROOT = resolve('.');
const REQUIRED = ['tests/helpers.test.mjs', 'tests/docs.test.mjs', 'tests/guides.test.mjs', 'tests/cli.test.mjs', 'tests/adopt.test.mjs', 'tests/skill.test.mjs', 'tests/guide-consumers.test.mjs', 'tests/web-operation-coverage.test.mjs', 'tests/check-focused.test.mjs'];
async function acme(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'plates-focused-acme-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'tests'));
  for (const file of [...REQUIRED, 'tests/acme.test.mjs']) await writeFile(join(root, file), '// Acme\n');
  return root;
}

test('every plan unconditionally includes source conventions and its own regression test', async t => {
  const root = await acme(t);
  for (const files of [[], ['tests/acme.test.mjs'], ['tests/helpers.test.mjs', 'tests/acme.test.mjs', 'tests/acme.test.mjs']]) {
    const plan = await focusedPlan(files, root);
    for (const file of REQUIRED) assert.equal(plan.tests.filter(t => t === file).length, 1, file);
    assert.deepEqual(plan.tests, [...new Set([...REQUIRED, ...files])]);
    assert.equal(plan.authority, 'feedback-only');
    assert.deepEqual(plan.stages[0].args, ['--import', './tests/helpers/hermetic.mjs', '--test', '--test-concurrency=2', ...plan.tests]);
    assert.deepEqual(plan.stages.slice(1).map(s => [s.command, ...s.args]), [
      ['npm', 'run', 'roadmap:check'], ['npm', 'run', 'render:check'], ['npm', 'run', 'inbox:check'], ['git', '-c', 'core.fsmonitor=false', 'diff', '--check', 'HEAD'],
    ]);
    assert.equal(plan.stages.some(s => s.command === 'npm' && (s.args.includes('test') || s.args.includes('check'))), false, 'never runs the integrated gate');
  }
});

test('explicit test validation rejects missing, traversal, shell, flags, glob and symlink paths', async t => {
  const root = await acme(t);
  for (const path of ['--test-concurrency=32', '../tests/acme.test.mjs', '/tests/acme.test.mjs', 'tests/../acme.test.mjs', 'tests/*.test.mjs', 'tests/acme.test.mjs;echo', 'tests/acme test.mjs', 'tests/missing.test.mjs', 'tests/acme.mjs']) await assert.rejects(focusedPlan([path], root), undefined, path);
  await assert.rejects(focusedPlan(Array(65).fill('tests/acme.test.mjs'), root));
  await symlink(join(root, 'tests/acme.test.mjs'), join(root, 'tests/alias.test.mjs'));
  await assert.rejects(focusedPlan(['tests/alias.test.mjs'], root), /symlinks/);
  await rm(join(root, 'tests/helpers.test.mjs'));
  await assert.rejects(focusedPlan([], root), /unavailable/, 'missing mandatory convention cannot silently disappear');
});

test('executor keeps argv literal and sequential, strips runner markers and propagates failures', async t => {
  const root = await acme(t), plan = await focusedPlan(['tests/acme.test.mjs'], root);
  for (let failed = 0; failed < plan.stages.length; failed++) {
    const seen = [];
    const report = runFocusedPlan(plan, { json: true, execute(command, args, options) {
      seen.push([command, args]);
      assert.equal(options.shell, false);
      assert.equal(options.cwd, root);
      assert.equal(Object.keys(options.env).some(k => k.startsWith('NODE_TEST_')), false);
      assert.ok(options.timeout > 0);
      return { status: seen.length === failed + 1 ? 7 : 0, stdout: '', stderr: '' };
    } });
    assert.equal(report.status, 7); assert.equal(seen.length, failed + 1);
    assert.deepEqual(seen, plan.stages.slice(0, failed + 1).map(s => [s.command, s.args]));
  }
  for (const result of [{ status: null, signal: 'SIGTERM' }, { status: 0, error: { code: 'ENOENT' } }]) {
    let calls = 0;
    const report = runFocusedPlan(plan, { json: true, execute() { calls++; return result; } });
    assert.equal(report.status, 1); assert.equal(calls, 1);
  }
});

test('a real failing child exits red and prevents the next stage from running', async t => {
  const root = await acme(t);
  const module = pathToFileURL(join(ROOT, 'scripts/check-focused.mjs')).href;
  const result = run(process.execPath, ['--input-type=module', '-e', `
    import { runFocusedPlan } from ${JSON.stringify(module)};
    const report = runFocusedPlan({ cwd: ${JSON.stringify(root)}, stages: [
      { id: 'Acme failure', command: process.execPath, args: ['-e', 'process.exit(7)'], timeout: 10000 },
      { id: 'Acme forbidden continuation', command: process.execPath, args: ['-e', 'process.exit(0)'], timeout: 10000 }
    ] }, { json: true });
    console.log(JSON.stringify(report)); process.exitCode = report.status;
  `], { timeout: 20000 });
  assert.equal(result.status, 7, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.stages.length, 1);
  assert.equal(report.stages[0].id, 'Acme failure');
});

test('CLI exposes an inspectable plan, rejects omission flags, and package alias preserves the full gate', async () => {
  const cli = join(ROOT, 'scripts/check-focused.mjs');
  const preview = run(process.execPath, [cli, '--plan', '--json', 'tests/validation-audit.test.mjs']);
  assert.equal(preview.status, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout);
  assert.ok(plan.tests.includes('tests/validation-audit.test.mjs'));
  for (const file of REQUIRED) assert.ok(plan.tests.includes(file));
  const invalid = run(process.execPath, [cli, '--skip-conventions', '--json']);
  assert.equal(invalid.status, 2); assert.match(JSON.parse(invalid.stderr).error, /invalid arguments/);
  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['check:focused'], 'node scripts/check-focused.mjs');
  assert.match(pkg.scripts.check, /test-ledger\.mjs --run/);
  assert.match(pkg.scripts.check, /npm test && npm run roadmap:check && npm run render:check && npm run inbox:check/);
});


test('upstream and rendered spin require the configured convention preflight before the whole gate', async () => {
  for (const file of ['practices/conduct/files/.agents/skills/spin/SKILL.md', '.agents/skills/spin/SKILL.md']) {
    const text = await readFile(join(ROOT, file), 'utf8');
    const verify = text.slice(text.indexOf('## 2. Verify'), text.indexOf('## 3. Record'));
    assert.match(verify, /Inventory conventions before the integrated checkpoint/);
    assert.match(verify, /test subprocess[\s\S]*guide\/CLI[\s\S]*generated-output and whitespace/);
    assert.match(verify, /run `npm run` with script name[\s\S]*`check:focused`, followed by `--`/);
    assert.match(verify, /specific affected test files before the whole gate/);
    assert.match(verify, /required convention bundle cannot be omitted/);
    assert.match(verify, /Otherwise name and run the equivalent repository[\s\S]*convention checks explicitly/);
    assert.match(verify, /does not replace or weaken the integrated gate/);
    assert.ok(verify.indexOf('Inventory conventions') < verify.indexOf('The named Proof'), file);
  }
});


test('whitespace preflight covers staged, intent-to-add and unstaged changes without staging them', async t => {
  const root = await acme(t);
  const git = args => { const result = run('git', args, { cwd: root }); assert.equal(result.status, 0, result.stderr); return result.stdout; };
  git(['init', '-q']); git(['add', 'tests']); git(['commit', '-qm', 'Acme baseline']);
  const plan = await focusedPlan([], root);
  const whitespace = { ...plan, stages: plan.stages.filter(stage => stage.id === 'whitespace') };
  const check = () => runFocusedPlan(whitespace, { json: true });
  const tracked = join(root, 'tests/acme.test.mjs');
  assert.equal(check().status, 0, 'clean baseline');
  await writeFile(tracked, '// Acme staged whitespace  \n');
  git(['add', 'tests/acme.test.mjs']);
  assert.notEqual(check().status, 0, 'staged whitespace must fail');
  git(['restore', '--source=HEAD', '--staged', '--worktree', '--', 'tests/acme.test.mjs']);
  const added = join(root, 'tests/new.test.mjs');
  await writeFile(added, '// Acme new whitespace  \n');
  git(['add', '-N', 'tests/new.test.mjs']);
  const intent = git(['status', '--porcelain']);
  assert.notEqual(check().status, 0, 'intent-to-add whitespace must fail');
  assert.equal(git(['status', '--porcelain']), intent, 'the preflight never stages files');
  git(['reset', '-q', 'HEAD', '--', 'tests/new.test.mjs']); await rm(added);
  await writeFile(tracked, '// Acme unstaged whitespace  \n');
  assert.notEqual(check().status, 0, 'unstaged whitespace must fail');
  git(['restore', '--source=HEAD', '--worktree', '--', 'tests/acme.test.mjs']);
  assert.equal(check().status, 0, 'clean restored baseline');
  const help = run(process.execPath, [join(ROOT, 'scripts/check-focused.mjs'), '--help']);
  assert.equal(help.status, 0); assert.match(help.stdout, /git add -N/); assert.match(help.stdout, /never stages files/);
});
