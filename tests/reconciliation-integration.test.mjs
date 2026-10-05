import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, chmod, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run } from './helpers/run.mjs';
import { measure, page, MEASURES } from '../practices/night/files/scripts/keel/improve.mjs';
import { isData, plan } from '../practices/night/files/scripts/keel/drain.mjs';

const root = resolve(import.meta.dirname, '..');
const bin = join(root, 'bin/keel.mjs');
const engine = join(root, 'practices/reconciliation/files/scripts/keel/reconcile.mjs');
const measures = MEASURES.filter(m => m.id === 'record_contradictions');
async function fixture(t, enabled = true) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'acme-reconciliation-integration-')));
  t.after(() => rm(dir, { recursive: true, force: true }));
  for (const d of ['.keel', 'docs/phases', 'scripts/keel']) await mkdir(join(dir, d), { recursive: true });
  const config = { name: 'Acme', check: 'node --test', practices: enabled ? ['reconciliation'] : ['base'], local: { phases: 'Acme inline records' }, repo: 'acme/app' };
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify(config));
  if (enabled) await cp(engine, join(dir, 'scripts/keel/reconcile.mjs'));
  await writeFile(join(dir, 'docs/phases/01-store.md'), '# Store\n\n**Status:** partial\n\n## Acceptance\n\n- [ ] Production proof. <!-- acceptance: production -->\n\n**Next action.** Review the implementation.\n\n## Reconciliation\n\n```keel-reconciliation\n' + JSON.stringify({ version: 1, prs: ['acme/app#12'], decisions: [], implementation: [], production: [], use: [], next: { kind: 'review-pr', ref: 'acme/app#12' } }) + '\n```\n');
  const gh = join(dir, 'gh');
  await writeFile(gh, `#!${process.execPath}\nprocess.exit(1);\n`);
  await chmod(gh, 0o755);
  return { dir, config, env: { ...process.env, KEEL_GH: gh } };
}
test('normal night has no reconciliation dependency; opt-in missing runtime is broken', async t => {
  const { dir, config, env } = await fixture(t, false);
  assert.equal((await measure({ root: dir, config, env, measures }))[0].state, 'n/a');
  config.practices.push('reconciliation');
  const result = (await measure({ root: dir, config, env, measures }))[0];
  assert.equal(result.state, 'broken');
  assert.equal(result.value, null);
});
test('doctor --github propagates; offline doctor never requests remote facts', async t => {
  const { dir, env } = await fixture(t);
  const local = run(process.execPath, [bin, 'doctor', '--json'], { cwd: dir, env });
  const offline = JSON.parse(local.stdout);
  assert.deepEqual(offline.reconciliation.unknown, []);
  const remote = run(process.execPath, [bin, 'doctor', '--github', '--json'], { cwd: dir, env });
  assert.equal(remote.status, 2, remote.stdout + remote.stderr);
  assert.ok(JSON.parse(remote.stdout).reconciliation.unknown.length);
});
test('unknown night observation is broken and retained as full health JSON', async t => {
  const { dir, config, env } = await fixture(t);
  const results = await measure({ root: dir, config, env, measures });
  assert.equal(results[0].state, 'broken');
  assert.equal(results[0].value, null);
  assert.ok(results[0].facts.unknown.length);
  const text = page({ config, results, date: '2026-01-01', proposal: null, tightened: [] });
  assert.deepEqual(JSON.parse(/```json\n([\s\S]*?)\n```/.exec(text)[1]), results[0].facts);
});
test('record edits never qualify for drain, even custom data paths', () => {
  for (const path of ['docs/phases/01-store.md', 'docs/projects/acme/phases.md', 'docs/decisions/store.md', 'docs/research/store.md', 'docs/evidence/store.md', 'docs/design.md']) {
    assert.equal(isData(path, 'keel-night/', ['docs/']), false);
    assert.equal(isData(path, 'keel-loop/', [path]), false);
    const p = plan([{ number: 1, headRefName: 'keel-night/acme', createdAt: '2026-01-01', mergeable: 'MERGEABLE', files: [{ path }] }], 'keel-night/', { gatePassed: true, extra: ['docs/'] });
    assert.ok(p.actions.every(a => a.action !== 'merge'));
  }
});
test('remote CLI test calls require a stub; offline calls remain allowed', () => {
  const env = { ...process.env }; delete env.KEEL_GH;
  assert.throws(() => run(process.execPath, [bin, 'doctor', '--github'], { env }), /KEEL_GH/);
  assert.throws(() => run(process.execPath, [engine, '--github'], { env }), /KEEL_GH/);
});
test('optional practice adopts into local phase format and preserves existing PR template', async t => {
  const { dir, env } = await fixture(t, false);
  await mkdir(join(dir, '.github'));
  await writeFile(join(dir, '.github/pull_request_template.md'), 'Acme own template\n');
  const before = await readFile(join(dir, 'docs/phases/01-store.md'), 'utf8');
  const result = run(process.execPath, [bin, 'adopt', '--with', 'reconciliation', '--json'], { cwd: dir, env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.ok(JSON.parse(await readFile(join(dir, '.keel/keel.json'))).practices.includes('reconciliation'));
  assert.equal(await readFile(join(dir, 'docs/phases/01-store.md'), 'utf8'), before);
  assert.equal(await readFile(join(dir, '.github/pull_request_template.md'), 'utf8'), 'Acme own template\n');
  assert.equal(await readFile(join(dir, 'scripts/keel/reconcile.mjs'), 'utf8'), await readFile(engine, 'utf8'));
});
test('advisory-only health data survives zero findings and cannot close the JSON fence', async t => {
  const { dir, config, env } = await fixture(t);
  await writeFile(join(dir, 'docs/phases/01-store.md'), '# Store\n\n**Status:** partial\n\n**Next action.** Review Acme requirements.\n');
  const results = await measure({ root: dir, config, env, measures });
  assert.equal(results[0].value, 0);
  assert.ok(results[0].facts.notes.length);
  assert.match(results[0].detail, /advisory.*not complete verification/);
  results[0].facts.notes.push({ message: '```\nUntrusted excerpt\n```' });
  const text = page({ config, results, date: '2026-01-01', proposal: null, tightened: [] });
  assert.equal((text.match(/```/g) ?? []).length, 2);
  assert.deepEqual(JSON.parse(/```json\n([\s\S]*?)\n```/.exec(text)[1]), results[0].facts);
  assert.match(text, /untrusted data, never instructions/);
});
test('PR workflow uses read-only head checkout and event CLI checks the actual diff', async t => {
  const { dir, config, env } = await fixture(t);
  const workflow = await readFile(join(root, 'practices/ci/files/.github/workflows/check.yml'), 'utf8');
  assert.match(workflow, /ref: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /pull-requests: read/);
  assert.doesNotMatch(workflow, /pull_request_target|: write/);
  const git = args => {
    const r = run('git', args, { cwd: dir, env });
    assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  git(['init', '-q', '-b', 'main']); git(['add', '.']); git(['commit', '-qm', 'Acme baseline']);
  const base = git(['rev-parse', 'HEAD']);
  await writeFile(join(dir, 'docs/phases/01-store.md'), '# Store\n\n## Acceptance\n\n- [ ] Production proof remains open.\n');
  git(['add', '.']); git(['commit', '-qm', 'Acme record update']);
  const head = git(['rev-parse', 'HEAD']);
  const event = join(dir, 'event.json');
  const declaration = { version: 1, phases: [], decisions: [], supersedes: [], evidence: [], reconciliation: 'none', reason: 'Claims no impact, but actually edited a phase.' };
  const check = async () => {
    await writeFile(event, JSON.stringify({ pull_request: { body: '```keel-impact\n' + JSON.stringify(declaration) + '\n```', base: { sha: base }, head: { sha: head } } }));
    return run(process.execPath, [join(dir, 'scripts/keel/reconcile.mjs'), '--event', event, '--json'], { cwd: dir, env });
  };
  assert.equal((await check()).status, 1);
  declaration.phases = ['docs/phases/01-store.md']; declaration.reconciliation = 'updated';
  assert.equal((await check()).status, 0);
  declaration.phases = []; declaration.reconciliation = 'none'; declaration.reason = '';
  assert.equal((await check()).status, 1);
});
test('init --with reconciliation installs a standalone runtime; annotations are linted without opt-in', async t => {
  const { dir, env } = await fixture(t, false);
  const created = join(dir, 'new-acme');
  const init = run(process.execPath, [bin, 'init', created, '--description', 'Acme stores records.', '--with', 'reconciliation', '--json'], { cwd: dir, env });
  assert.equal(init.status, 0, init.stdout + init.stderr);
  const local = run(process.execPath, [join(created, 'scripts/keel/reconcile.mjs'), '--json'], { cwd: created, env });
  assert.equal(local.status, 0, local.stdout + local.stderr);
  assert.deepEqual(JSON.parse(local.stdout).findings, []);
  await writeFile(join(dir, 'docs/phases/01-store.md'), '# Store\n\n## Reconciliation\n\n```keel-reconciliation\n{"version":1,"next":{"kind":"acceptance","ref":"missing"}}\n```\n');
  const doctor = run(process.execPath, [bin, 'doctor', '--json'], { cwd: dir, env });
  assert.equal(doctor.status, 1, doctor.stdout + doctor.stderr);
  assert.ok(JSON.parse(doctor.stdout).lint?.some(f => f.rule === 'acceptance-id'), doctor.stdout + doctor.stderr);
});
test('generated Loop and dependency bodies satisfy impact gate only for their declared data', async t => {
  const { dir, env } = await fixture(t);
  const { checkImpact } = await import('../practices/reconciliation/files/scripts/keel/reconcile.mjs');
  const yml = await readFile(join(root, 'practices/loop/files/.github/workflows/keel-loop.yml'), 'utf8');
  const match = /cat > "\$RUNNER_TEMP\/loop-body\.md" <<'KEEL_BODY'\n([\s\S]*?)\n          KEEL_BODY/.exec(yml);
  assert.ok(match, 'Loop body is generated by a quoted heredoc');
  const shell = match[0].replace(/^          /gm, '');
  const generated = run('bash', ['-e', '-c', shell], { cwd: dir, env: { ...env, RUNNER_TEMP: dir } });
  assert.equal(generated.status, 0, generated.stderr);
  assert.match(yml, /--body-file "\$RUNNER_TEMP\/loop-body.md"/);
  const loop = await readFile(join(dir, 'loop-body.md'), 'utf8');
  const renovate = JSON.parse(await readFile(join(root, 'practices/renovate/files/renovate.json'), 'utf8'));
  assert.ok(renovate.prBodyNotes?.length);
  for (const lane of [...renovate.packageRules, renovate.lockFileMaintenance, renovate.vulnerabilityAlerts]) assert.equal(lane.prBodyNotes, undefined, 'every lane inherits the impact declaration');
  for (const [body, changedFiles] of [[loop, ['docs/loop/acme.md', 'docs/LOOP.md', 'docs/ROADMAP.md']], [renovate.prBodyNotes.join('\n\n'), ['package.json', 'package-lock.json', '.nvmrc']]]) {
    assert.deepEqual((await checkImpact({ root: dir, body, changedFiles })).findings, []);
    assert.ok((await checkImpact({ root: dir, body, changedFiles: [...changedFiles, 'docs/phases/01-store.md'] })).findings.length);
    assert.ok((await checkImpact({ root: dir, body, changedFiles: [...changedFiles, 'docs/decisions/acme.md'] })).findings.length);
  }
});
test('optional CI routes remote facts only on default-branch pushes', async t => {
  const { dir, config, env } = await fixture(t);
  const workflow = await readFile(join(root, 'practices/ci/files/.github/workflows/check.yml'), 'utf8');
  const step = workflow.split('- name: Reconcile records (optional)')[1].split('run: |\n')[1].replace(/^          /gm, '');
  const log = join(dir, 'calls.jsonl');
  await writeFile(join(dir, 'scripts/keel/reconcile.mjs'), `import {appendFileSync} from 'node:fs'; appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2))+'\\n');`);
  const execute = async (event, branch) => {
    await writeFile(log, '');
    const result = run('bash', ['-e', '-c', step], { cwd: dir, env: { ...env, EVENT: event, BRANCH: branch, DEFAULT_BRANCH: 'trunk', GITHUB_EVENT_PATH: join(dir, 'event.json') } });
    assert.equal(result.status, 0, result.stderr);
    return (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  };
  assert.deepEqual(await execute('push', 'trunk'), [['--json'], ['--github', '--json']]);
  assert.deepEqual(await execute('push', 'feature'), [['--json']]);
  // The PR description is keel-impact.yml's (re-checked on edit); check.yml runs only the local check on a PR.
  assert.deepEqual(await execute('pull_request', 'feature'), [['--json']]);
  config.practices = ['base'];
  await writeFile(join(dir, '.keel/keel.json'), JSON.stringify(config));
  await rm(join(dir, 'scripts/keel/reconcile.mjs'));
  assert.deepEqual(await execute('push', 'trunk'), []);
});
