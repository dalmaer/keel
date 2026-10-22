import './helpers/hermetic.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { run } from './helpers/run.mjs';
import { SOURCE_MAPPINGS, selectValidation, inspectValidationPlan } from '../lib/validation-plan.mjs';
import { assertSupportedNode, assertFocusedRuntime, nodeSatisfies, inspectCapabilities, packageBinding, probeLoopback } from '../lib/validation-capabilities.mjs';
import { REQUIRED_CONVENTIONS } from '../scripts/check-focused.mjs';

const ROOT = resolve('.');
async function fixture(t) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), 'plates-acme-plan-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, 'repo'), manifest = join(parent, 'manifest.json');
  await mkdir(root); await mkdir(join(root, '.plates')); await mkdir(join(root, 'lib')); await mkdir(join(root, 'tests'));
  await writeFile(manifest, JSON.stringify([{ repo: 'acme/source', kind: 'node', role: 'managed' }]));
  await writeFile(join(root, '.plates/plates.json'), JSON.stringify({ repo: 'acme/source', check: 'node acme-must-not-run.mjs' }));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'acme', version: '1.0.0', engines: { node: '>=24.22.1' }, scripts: { typecheck: 'node acme-must-not-run.mjs' } }));
  await writeFile(join(root, 'acme-must-not-run.mjs'), "import {writeFileSync} from 'node:fs'; writeFileSync('acme-forbidden','executed'); process.exit(99);\n");
  for (const file of ['lib/validation-audit.mjs', 'lib/validation-plan.mjs', 'tests/check-focused.test.mjs', 'tests/shared.mjs']) await writeFile(join(root, file), '// Acme baseline\n');
  const git = args => { const r = run('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: root }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  git(['init', '-q']); git(['remote', 'add', 'origin', 'https://github.com/acme/source.git']); git(['add', '.']); git(['commit', '-qm', 'Acme baseline']);
  return { root, manifest, parent, base: git(['rev-parse', 'HEAD']).trim(), git };
}
const observedRuntime = () => ({ version: process.version, executable: process.execPath, architecture: process.arch, platform: process.platform });
const safeEnv = () => ({ ...process.env, NODE_OPTIONS: '', NODE_PATH: '' });
function fakeVersions(child = observedRuntime()) {
  return (command, args, options) => {
    assert.equal(options.shell, false); assert.ok(options.timeout > 0 && options.timeout <= 5000);
    assert.equal(Object.keys(options.env).some(key => key.startsWith('NODE_TEST_')), false);
    return { status: 0, stdout: args[0] === '-p' ? JSON.stringify(child) : basename(command) === 'git' ? 'git version 2.50.1\n' : '11.6.0\n' };
  };
}
const healthy = async () => ({ ready: true, issues: [], processRuntime: observedRuntime() });

test('exact source mappings always include conventions and cannot omit the complete gate', () => {
  assert.equal(Object.keys(SOURCE_MAPPINGS).length, 12);
  for (const [path, expected] of Object.entries(SOURCE_MAPPINGS)) {
    const plan = selectValidation([{ path, status: 'M' }], { source: true });
    assert.equal(plan.mode, 'focused-first', path);
    for (const test of [...REQUIRED_CONVENTIONS, ...expected]) assert.ok(plan.tests.includes(test), `${path}: ${test}`);
    assert.equal(plan.gateMayBeOmitted, false); assert.equal(plan.authority, 'feedback-only');
  }
  const combined = selectValidation([{ path: 'lib/validation-audit.mjs', status: 'M' }, { path: 'lib/validation-budget.mjs', status: 'A' }], { source: true });
  assert.ok(combined.tests.includes('tests/validation-audit.test.mjs')); assert.ok(combined.tests.includes('tests/validation-budget.test.mjs'));
});

test('unmapped shared config generated environment deletion and rename inputs fail closed', () => {
  for (const path of ['lib/unknown.mjs', 'tests/helpers/run.mjs', 'tests/helpers/hermetic.mjs', 'package.json', 'package-lock.json', '.plates/plates.json', '.github/workflows/check.yml', '.env', 'docs/ROADMAP.md', '.plates/lock.json', 'AGENTS.md']) {
    const plan = selectValidation([{ path: 'lib/validation-audit.mjs', status: 'M' }, { path, status: 'M' }], { source: true });
    assert.equal(plan.mode, 'broad', path); assert.ok(plan.reasons.some(reason => reason.includes(path)));
    assert.equal(plan.gateMayBeOmitted, false);
  }
  for (const status of ['D', 'T', 'U', 'R100', 'C100']) assert.equal(selectValidation([{ path: 'lib/validation-audit.mjs', status, ...(/[RC]/.test(status) ? { previous: 'lib/acme.mjs' } : {}) }], { source: true }).mode, 'broad');
  assert.equal(selectValidation([], { source: true }).mode, 'broad');
  assert.equal(selectValidation([{ path: 'lib/validation-audit.mjs', status: 'M' }]).mode, 'broad', 'consumer source-looking files never inherit source mappings');
  for (const path of ['../lib/validation-audit.mjs', '/tmp/acme', 'lib/../acme', 'lib\\acme', 'lib/acme\n']) assert.throws(() => selectValidation([{ path, status: 'M' }]), /invalid/);
  assert.throws(() => selectValidation(Array(2049).fill({ path: 'acme', status: 'M' })), /invalid/);
});

test('supported engine forms are explicit and unknown syntax never grants support', () => {
  for (const actual of ['24.22.1', 'v24.23.0', '26.12.1']) assert.doesNotThrow(() => assertSupportedNode(actual));
  for (const actual of ['24.13.0', '23.9.9', '24.22.0', '24.22.1-rc.1', 'garbage']) assert.throws(() => assertSupportedNode(actual), /unsupported/);
  assert.equal(nodeSatisfies('24.22.1', '24.22.1'), true); assert.equal(nodeSatisfies('26.12.1', '24.22.1'), false);
  assert.equal(nodeSatisfies('24.22.1', '24.x'), true); assert.equal(nodeSatisfies('26.12.1', '24.x'), false);
  assert.equal(nodeSatisfies('26.12.1', '>=24'), true); assert.equal(nodeSatisfies('24.22.1', '>=24.22.1'), true);
  for (const range of [undefined, '', '^24', '>=24 <27', '*', '>=24.22.1 || >=26']) assert.equal(nodeSatisfies('24.22.1', range), null);
});

test('capabilities capture process and PATH runtime and refuse mismatch missing tools and unknown engines', async t => {
  const f = await fixture(t), options = { root: f.root, engine: '>=24.22.1' };
  const good = await inspectCapabilities(options, { execute: fakeVersions(), env: safeEnv() });
  assert.equal(good.ready, true, JSON.stringify(good.issues)); assert.equal(good.childRuntime.executable, process.execPath);
  assert.equal(good.deployedFunctionRuntime.status, 'unverified');
  const drift = await inspectCapabilities(options, { execute: fakeVersions({ ...observedRuntime(), version: 'v24.13.0' }), env: safeEnv() });
  assert.ok(drift.issues.includes('unsupported-path-node')); assert.ok(drift.issues.includes('process-path-runtime-mismatch'));
  const unknown = await inspectCapabilities({ ...options, engine: '^24' }, { execute: fakeVersions(), env: safeEnv() });
  assert.ok(unknown.issues.includes('target-engine-unavailable'));
  const emptyBin = join(f.parent, 'empty-bin'); await mkdir(emptyBin);
  const missing = await inspectCapabilities(options, { env: { ...safeEnv(), PATH: emptyBin } });
  assert.deepEqual(missing.issues.filter(issue => issue.endsWith('-unavailable')).sort(), ['git-unavailable', 'node-unavailable', 'npm-unavailable']);
  const failed = await inspectCapabilities(options, { execute: () => ({ status: null, error: { code: 'ETIMEDOUT' } }), env: safeEnv() });
  assert.equal(failed.ready, false); assert.ok(failed.issues.includes('node-probe-failed'));
  const flags = await inspectCapabilities(options, { execute: fakeVersions(), env: { ...safeEnv(), NODE_OPTIONS: '--require ./acme.mjs' } });
  assert.ok(flags.issues.includes('runtime-options-require-inspection'));
});

test('source loopback binds and closes under bounds; refusal blocks source readiness without changing consumer planning', async t => {
  const f = await fixture(t), packageBytes = await readFile(join(ROOT, 'package.json'));
  const supported = await inspectCapabilities({ root: f.root, engine: '>=24.22.1', source: true, packageBytes });
  assert.equal(supported.ready, true, JSON.stringify(supported));
  assert.deepEqual(supported.loopback, { status: 'observed', address: '127.0.0.1', closed: true, code: null });
  let binds = 0;
  const execute = (command, args, options) => {
    if (args[0] !== '--input-type=module') return fakeVersions()(command, args, options);
    binds++;
    return { status: 1, stdout: JSON.stringify({ status: 'unavailable', address: '127.0.0.1', closed: false, code: 'EPERM' }) };
  };
  const refused = await inspectCapabilities({ root: f.root, engine: '>=24.22.1', source: true, packageBytes }, { execute, env: safeEnv() });
  assert.equal(refused.ready, false); assert.ok(refused.issues.includes('source-loopback-unavailable')); assert.equal(refused.loopback.code, 'EPERM');
  const consumer = await inspectCapabilities({ root: f.root, engine: '>=24.22.1' }, { execute, env: safeEnv() });
  assert.equal(consumer.ready, true); assert.equal(consumer.loopback.status, 'not-applicable'); assert.equal(binds, 1);
  for (const result of [{ error: { code: 'ETIMEDOUT' } }, { status: 0, stdout: '{}' }, { status: 1, stdout: 'invalid' }]) {
    assert.equal(probeLoopback(f.root, process.execPath, { execute: () => result }).status, 'unavailable');
  }
});

test('the existing normalized package binding permits release bumps but rejects executable metadata drift', async () => {
  const bytes = await readFile(join(ROOT, 'package.json')), pkg = JSON.parse(bytes);
  assert.equal(packageBinding(bytes).status, 'verified');
  assert.equal(packageBinding(Buffer.from(JSON.stringify({ ...pkg, version: '999.0.0' }))).status, 'verified');
  const changed = packageBinding(Buffer.from(JSON.stringify({ ...pkg, scripts: { ...pkg.scripts, 'acme-extra': 'node acme.mjs' } })));
  assert.equal(changed.status, 'changed'); assert.notEqual(changed.actual, changed.expected);
  assert.equal(packageBinding(Buffer.from(JSON.stringify({ ...pkg, version: 'v999.0.0' }))).status, 'unavailable');
  assert.equal(packageBinding(Buffer.from('not json')).status, 'unavailable');
});

test('actual read-only planner sees committed staged unstaged and untracked changes and preserves consumer gates', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'lib/validation-audit.mjs'), '// Acme committed\n'); f.git(['add', '.']); f.git(['commit', '-qm', 'Acme committed change']);
  await writeFile(join(f.root, 'lib/validation-plan.mjs'), '// Acme staged\n'); f.git(['add', 'lib/validation-plan.mjs']);
  await writeFile(join(f.root, 'tests/check-focused.test.mjs'), '// Acme unstaged\n');
  await writeFile(join(f.root, 'acme-untracked.txt'), 'Acme untracked\n');
  const before = f.git(['status', '--porcelain']);
  const report = await inspectValidationPlan(f);
  assert.equal(report.status, 'ready', JSON.stringify(report.capabilities)); assert.equal(report.selection.mode, 'broad');
  for (const scope of ['committed', 'index', 'working-tree', 'untracked']) assert.ok(report.changes.some(change => change.scope === scope), scope);
  assert.equal(report.required.gate, 'node acme-must-not-run.mjs'); assert.equal(report.required.typecheck, 'npm run typecheck');
  assert.equal(report.required.mayOmit, false); assert.equal(report.review.approval, false); assert.equal(report.review.status, 'unavailable');
  assert.equal(report.stableInputs, true); assert.equal(report.dirty, true); assert.match(report.inputDigest, /^[a-f0-9]{64}$/);
  assert.equal(f.git(['status', '--porcelain']), before, 'never mutates the checkout or executes its scripts');
  await assert.rejects(readFile(join(f.root, 'acme-forbidden')), /ENOENT/);
});

test('staged shared changes cannot hide behind a restored working file', async t => {
  const f = await fixture(t), path = 'tests/shared.mjs';
  await writeFile(join(f.root, path), '// Acme index change\n'); f.git(['add', path]);
  await writeFile(join(f.root, path), '// Acme baseline\n');
  const report = await inspectValidationPlan(f, { capabilities: healthy });
  assert.ok(report.changes.some(change => change.path === path && change.scope === 'index'));
  assert.ok(report.changes.some(change => change.path === path && change.scope === 'working-tree'));
  assert.equal(report.selection.mode, 'broad');
});

test('concurrent content changes and unsupported file kinds never produce stable narrow plans', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'lib/validation-audit.mjs'), '// Acme before\n');
  const moved = await inspectValidationPlan(f, { capabilities: healthy, afterSnapshot: () => writeFile(join(f.root, 'lib/validation-audit.mjs'), '// Acme after\n') });
  assert.equal(moved.status, 'blocked'); assert.equal(moved.stableInputs, false); assert.ok(moved.selection.reasons.includes('inputs-changed-during-inspection'));
  await symlink(join(f.root, 'lib/validation-audit.mjs'), join(f.root, 'acme-alias'));
  const linked = await inspectValidationPlan(f, { capabilities: healthy });
  assert.equal(linked.status, 'blocked'); assert.ok(linked.selection.reasons.includes('unsupported-changed-file-kind'));
});

test('manifest identity origin canonical paths and required reads fail closed', async t => {
  const f = await fixture(t);
  f.git(['remote', 'set-url', 'origin', 'https://github.com/acme/other.git']);
  await assert.rejects(inspectValidationPlan(f), /origin identity/);
  f.git(['remote', 'set-url', 'origin', 'https://github.com/acme/source.git']);
  await writeFile(f.manifest, JSON.stringify([{ repo: 'acme/source', role: 'source' }]));
  await assert.rejects(inspectValidationPlan(f), /manifest-managed/);
  await writeFile(f.manifest, JSON.stringify([{ repo: 'acme/source', role: 'managed' }, { repo: 'ACME/SOURCE', role: 'managed' }]));
  await assert.rejects(inspectValidationPlan(f), /duplicate/);
  await writeFile(f.manifest, JSON.stringify([{ repo: 'acme/source', role: 'managed' }]));
  const alias = join(f.parent, 'alias'); await symlink(f.root, alias);
  await assert.rejects(inspectValidationPlan({ ...f, root: alias }), /canonical/);
  await assert.rejects(inspectValidationPlan({ ...f, base: 'HEAD' }), /full 40/);
  await rm(join(f.root, '.plates/plates.json')); await symlink(f.manifest, join(f.root, '.plates/plates.json'));
  await assert.rejects(inspectValidationPlan(f), /symlink/);
});

test('full pinned review bytes establish input availability only and stale or dirty inputs remain gaps', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'lib/validation-audit.mjs'), '// Acme review change\n'); f.git(['add', '.']); f.git(['commit', '-qm', 'Acme reviewed change']);
  const reviewInput = join(f.parent, 'review'); await mkdir(reviewInput);
  const head = f.git(['rev-parse', 'HEAD']).trim();
  await writeFile(join(reviewInput, 'pr.json'), JSON.stringify({ baseRefOid: f.base, headRefOid: head, changedFiles: 1 }));
  const diff = f.git(['diff', '--no-ext-diff', '--no-textconv', '--binary', `${f.base}...${head}`, '--']);
  await writeFile(join(reviewInput, 'pr.diff'), diff);
  const good = await inspectValidationPlan({ ...f, reviewInput }, { capabilities: healthy });
  assert.equal(good.review.status, 'complete-input'); assert.equal(good.review.approval, false); assert.equal(good.review.changedFiles, 1);
  await writeFile(join(reviewInput, 'pr.diff'), diff.slice(0, -10));
  assert.equal((await inspectValidationPlan({ ...f, reviewInput }, { capabilities: healthy })).review.status, 'unavailable');
  await writeFile(join(reviewInput, 'pr.diff'), diff); await writeFile(join(f.root, 'acme-untracked'), 'Acme dirty\n');
  assert.equal((await inspectValidationPlan({ ...f, reviewInput }, { capabilities: healthy })).review.status, 'unavailable');
});

test('CLI is read-only with JSON help, broad fallback, and explicit invalid-input exits', async t => {
  const f = await fixture(t), cli = join(ROOT, 'scripts/validation-plan.mjs');
  const help = run(process.execPath, [cli, '--help', '--json']); assert.equal(help.status, 0); assert.match(JSON.parse(help.stdout).help, /never|without running tests/);
  const result = run(process.execPath, [cli, '--root', f.root, '--manifest', f.manifest, '--base', f.base, '--json']);
  assert.equal(result.status, 0, result.stderr); const plan = JSON.parse(result.stdout);
  assert.equal(plan.selection.mode, 'broad'); assert.equal(plan.authority, 'feedback-only');
  for (const args of [['--run'], ['--base', 'HEAD'], ['--root', f.root, '--root', f.root]]) {
    const invalid = run(process.execPath, [cli, ...args, '--json']); assert.equal(invalid.status, 2); assert.equal(JSON.parse(invalid.stderr).broadValidationRequired, true);
  }
  await assert.rejects(readFile(join(f.root, 'acme-forbidden')), /ENOENT/);
});


test('index blob changes invalidate a snapshot even when path status and working bytes stay identical', async t => {
  const f = await fixture(t), path = 'lib/validation-audit.mjs';
  await writeFile(join(f.root, path), '// Acme index one\n'); f.git(['add', path]);
  await writeFile(join(f.root, path), '// Acme baseline\n');
  const alternate = join(f.parent, 'alternate'); await writeFile(alternate, '// Acme index two\n');
  const blob = f.git(['hash-object', '-w', alternate]).trim();
  const result = await inspectValidationPlan(f, { capabilities: healthy, afterSnapshot: async () => { f.git(['update-index', '--cacheinfo', `100644,${blob},${path}`]); } });
  assert.equal(result.stableInputs, false); assert.equal(result.status, 'blocked'); assert.equal(result.selection.mode, 'broad');
  assert.ok(result.selection.reasons.includes('inputs-changed-during-inspection'));
});

test('Git clean and process filters are refused before any target code executes; fsmonitor stays disabled', async t => {
  const f = await fixture(t), sentinel = join(f.root, 'acme-forbidden-filter');
  await writeFile(join(f.root, 'acme-filter.mjs'), "import {writeFileSync} from 'node:fs'; writeFileSync('acme-forbidden-filter','executed');\n");
  await writeFile(join(f.root, '.gitattributes'), '*.mjs filter=acme\n');
  for (const kind of ['clean', 'process']) {
    f.git(['config', `filter.acme.${kind}`, 'node acme-filter.mjs']);
    await assert.rejects(inspectValidationPlan(f), /Git filters/);
    await assert.rejects(readFile(sentinel), /ENOENT/);
    f.git(['config', '--unset', `filter.acme.${kind}`]);
  }
  f.git(['config', 'core.fsmonitor', 'node acme-filter.mjs']);
  const report = await inspectValidationPlan(f, { capabilities: healthy });
  assert.equal(report.status, 'ready'); await assert.rejects(readFile(sentinel), /ENOENT/);
});

test('unsafe first PATH tools and ambiguous relative entries are refused instead of bypassed', async t => {
  const f = await fixture(t), bin = join(f.root, 'bin'), sentinel = join(f.parent, 'acme-tool-ran'); await mkdir(bin);
  for (const name of ['node', 'npm']) {
    const file = join(bin, name); await writeFile(file, '#!/bin/sh\n: > "$ACME_SENTINEL"\nexit 97\n', { mode: 0o755 });
    const env = { ...safeEnv(), PATH: `${bin}:${process.env.PATH}`, ACME_SENTINEL: sentinel };
    const report = await inspectCapabilities({ root: f.root, engine: '>=24.22.1' }, { env });
    assert.equal(report.ready, false); assert.ok(report.issues.includes(`${name}-unsafe-path`));
    assert.throws(() => assertFocusedRuntime(f.root, { env }), /unsafe repository executable/);
    await assert.rejects(readFile(sentinel), /ENOENT/);
    await rm(file);
  }
  for (const prefix of ['', '.']) {
    const env = { ...safeEnv(), PATH: `${prefix}:${process.env.PATH}` };
    const report = await inspectCapabilities({ root: f.root, engine: '>=24.22.1' }, { env });
    assert.equal(report.ready, false); assert.ok(report.issues.includes('node-unsafe-path'));
    assert.throws(() => assertFocusedRuntime(f.root, { env }), /unsafe relative or empty PATH/);
  }
});
