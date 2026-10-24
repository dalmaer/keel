// Invalid or unavailable owner state must never become permission to publish a default.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { run } from './helpers/run.mjs';
import { runBlocks } from './helpers/workflows.mjs';
import { selectNightPlan, readRemoteNightPlan, readApiNightPlan, publishDefault, writePlan, record } from '../lib/night-plan.mjs';
import { finalPlan } from '../practices/night/files/scripts/plates/morning.mjs';
const date = '2026-10-24';
const plan = (over = {}) => ({ schema: 1, date, shapedBy: 'owner', readyBy: null, willNotTouch: [], settledToday: [], leftOpen: [], items: [], ...over });
const git = (cwd, ...args) => { const r = run('git', args, { cwd }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim(); };
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'plates125-preserve-acme-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'work'), origin = join(dir, 'origin.git'); await mkdir(root);
  git(root, 'init', '-q', '-b', 'main'); git(dir, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'remote', 'add', 'origin', origin);
  await writeFile(join(root, 'Acme.txt'), 'Acme\n'); git(root, 'add', '.'); git(root, 'commit', '-qm', 'Acme base'); git(root, 'push', '-q', 'origin', 'main');
  async function publish(branch, path, bytes) {
    git(root, 'checkout', '-q', '-B', branch, 'main'); await mkdir(join(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), bytes); git(root, 'add', '-f', path); git(root, 'commit', '-qm', 'Acme owner state');
    git(root, 'push', '-q', '--force', 'origin', branch); git(root, 'checkout', '-q', 'main');
  }
  return { root, origin, dir, publish };
}
const invalids = { malformed: '{not JSON\n', oversize: ' '.repeat(256 * 1024 + 1), invalid: JSON.stringify(plan({ readyBy: 'bad' })) };
for (const name of ['keel', 'plates']) for (const [kind, bytes] of Object.entries(invalids)) {
  test(`${name} ${kind} owner plan blocks default publication and preserves exact bytes`, async t => {
    const f = await fixture(t), branch = `${name}-night-plan`, path = `.${name}/night/plan.json`;
    await f.publish(branch, path, bytes); const before = git(f.origin, 'rev-parse', branch);
    await writePlan(f.root, plan({ shapedBy: 'default' }));
    const outcome = await publishDefault({ root: f.root, date });
    assert.equal(outcome.written, false, outcome.why);
    assert.match(outcome.why, new RegExp(`${branch}.*(refused|unavailable|cannot be read)`));
    assert.equal(git(f.origin, 'rev-parse', branch), before);
    assert.equal(run('git', ['show', `${branch}:${path}`], { cwd: f.origin }).stdout, bytes);
    if (name === 'keel') assert.equal(run('git', ['rev-parse', '--verify', '-q', 'plates-night-plan'], { cwd: f.origin }).status, 1, 'no canonical shadow');
  });
}
test('selection reports invalid and unavailable sources instead of absence', () => {
  for (const [text, extra] of [[invalids.invalid, {}], [null, { unavailable: 'git show failed' }]]) {
    const selected = selectNightPlan([{ branch: 'keel-night-plan', path: '.keel/night/plan.json', text, ...extra }], date);
    assert.equal(selected.plan, null); assert.equal(selected.refused.length, 1);
    assert.match(selected.refused[0], /keel-night-plan/); assert.notEqual(selected.sources[0].state, 'absent');
  }
});
for (const name of ['keel', 'plates']) test(`API ${name} invalid plan reports a refusal`, async t => {
  const f = await fixture(t), gh = join(f.dir, 'gh');
  await writeFile(gh, `#!${process.execPath}\nif(process.argv.at(-1).endsWith('ref=${name}-night-plan'))console.log(${JSON.stringify(invalids.invalid)});else {console.error('HTTP 404');process.exit(1);}`, { mode: 0o755 });
  const selected = readApiNightPlan({ root: f.root, repo: 'acme/project', date, env: { ...process.env, PLATES_GH: gh } });
  assert.equal(selected.plan, null); assert.match(selected.refused.join('; '), new RegExp(`${name}-night-plan.*readyBy`));
});
test('record refuses invalid canonical state even when a valid legacy plan can supply ticks', async t => {
  const f = await fixture(t);
  await f.publish('keel-night-plan', '.keel/night/plan.json', JSON.stringify(plan()));
  await f.publish('plates-night-plan', '.plates/night/plan.json', invalids.invalid);
  const before = git(f.origin, 'rev-parse', 'plates-night-plan');
  const result = await record({ root: f.root, date, ticks: [] });
  assert.equal(result.recorded, false); assert.match(result.why, /plates-night-plan.*readyBy/);
  assert.equal(git(f.origin, 'rev-parse', 'plates-night-plan'), before);
});
test('morning refuses a malformed original record rather than falling back to a valid plan', async t => {
  const f = await fixture(t);
  await f.publish('plates-night-plan', '.plates/night/plan.json', JSON.stringify(plan()));
  await f.publish(`keel-night/${date}`, `docs/night/${date}.json`, invalids.malformed);
  await assert.rejects(finalPlan({ root: f.root, date }), /keel-night.*refused/);
});
async function runtime(f) {
  await mkdir(join(f.root, 'scripts'), { recursive: true });
  await cp(resolve('practices/night/files/scripts/plates'), join(f.root, 'scripts/plates'), { recursive: true });
  await mkdir(join(f.root, '.plates'), { recursive: true });
  await writeFile(join(f.root, '.plates/plates.json'), JSON.stringify({ repo: 'acme/project', check: 'true' }));
}
test('real night workflow carries legacy refusal through branch-unread and red verdict output', async t => {
  const f = await fixture(t); await runtime(f);
  await f.publish('keel-night-plan', '.keel/night/plan.json', invalids.invalid);
  const source = await readFile(resolve('practices/night/files/.github/workflows/plates-night.yml'), 'utf8');
  const block = runBlocks(source).find(b => b.step === 'Plan the night'); assert.ok(block);
  const output = join(f.dir, 'output'); await writeFile(output, '');
  const result = run('bash', ['-e', '-c', block.script], { cwd: f.root, env: { ...process.env, RUNNER_TEMP: f.dir, GITHUB_OUTPUT: output } });
  assert.equal(result.status, 0, result.stderr);
  assert.match(await readFile(output, 'utf8'), /code=2/);
  assert.match(result.stdout + result.stderr, /keel-night-plan.*readyBy/);
});
for (const name of ['climb', 'robot']) test(`${name} API workflow refuses invalid source before admitting work`, async t => {
  const f = await fixture(t); await runtime(f);
  const gh = join(f.dir, 'gh'); await writeFile(gh, `#!${process.execPath}\nconsole.log(${JSON.stringify(invalids.invalid)});`, { mode: 0o755 });
  const source = await readFile(resolve(`practices/climb/files/.github/workflows/plates-${name}.yml`), 'utf8');
  const block = runBlocks(source).find(b => b.script.includes('readApiNightPlan')); assert.ok(block);
  const result = run('bash', ['-e', '-c', block.script], { cwd: f.root, env: { ...process.env, RUNNER_TEMP: f.dir, REPO: 'acme/project', PLATES_GH: gh } });
  assert.notEqual(result.status, 0); assert.match(result.stdout + result.stderr, /readyBy/);
  await assert.rejects(readFile(join(f.dir, 'night-plan/branch.json')), { code: 'ENOENT' });
});

async function gitShim(f, body) {
  const real = run('sh', ['-c', 'command -v git']).stdout.trim();
  const bin = join(f.dir, 'bin'); await mkdir(bin);
  await writeFile(join(bin, 'git'), `#!${process.execPath}\nimport {run} from ${JSON.stringify(new URL('./helpers/run.mjs', import.meta.url).href)};\nimport {existsSync,writeFileSync,readFileSync,writeSync} from 'node:fs';\nconst args=process.argv.slice(2), real=${JSON.stringify(real)};\n${body}\nconst r=run(real,args,{input:readFileSync(0)});writeSync(1,r.stdout);writeSync(2,r.stderr);process.exit(r.status??1);\n`, { mode: 0o755 });
  return { ...process.env, PATH: `${bin}:${process.env.PATH}` };
}
for (const operation of ['publish', 'record']) test(`${operation} retry rechecks legacy invalid state before creating a canonical shadow`, async t => {
  const f = await fixture(t), item = { id: 'acme-review', title: 'Acme review', kind: 'review', source: 'default', number: null, lane: 'night', budget: null, status: 'planned', result: null };
  await f.publish('keel-night-plan', '.keel/night/plan.json', invalids.invalid);
  const invalidHead = git(f.origin, 'rev-parse', 'keel-night-plan');
  git(f.origin, 'update-ref', '-d', 'refs/heads/keel-night-plan');
  if (operation === 'record') await f.publish('plates-night-plan', '.plates/night/plan.json', JSON.stringify(plan({ items: [item] })));
  await writePlan(f.root, plan({ shapedBy: 'default' }));
  const before = git(f.origin, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/plates-night-plan');
  const mark = join(f.dir, 'raced');
  const env = await gitShim(f, `if(args.includes('push')&&args.includes('--porcelain')&&!existsSync(${JSON.stringify(mark)})) {\nwriteFileSync(${JSON.stringify(mark)},'raced');\nconst r=run(real,['--git-dir',${JSON.stringify(f.origin)},'update-ref','refs/heads/keel-night-plan',${JSON.stringify(invalidHead)}]);writeSync(1,r.stdout);writeSync(2,r.stderr);if(r.status!==0)process.exit(9);process.exit(1);}`);
  const result = operation === 'publish' ? await publishDefault({ root: f.root, date, env }) : await record({ root: f.root, date, env, ticks: [{ id: item.id, status: 'running' }] });
  assert.equal(await readFile(mark, 'utf8'), 'raced');
  assert.equal(operation === 'publish' ? result.written : result.recorded, false);
  assert.match(result.why, /keel-night-plan.*readyBy/);
  assert.equal(git(f.origin, 'for-each-ref', '--format=%(refname) %(objectname)', 'refs/heads/plates-night-plan'), before);
  assert.equal(run('git', ['show', 'keel-night-plan:.keel/night/plan.json'], { cwd: f.origin }).stdout, invalids.invalid);
});
test('Git blob read failure is unavailable, never an absent plan or permission to publish', async t => {
  const f = await fixture(t); await f.publish('keel-night-plan', '.keel/night/plan.json', JSON.stringify(plan()));
  const env = await gitShim(f, "if(args.includes('show'))process.exit(128);");
  const selected = readRemoteNightPlan({ root: f.root, date, env });
  assert.match(selected.refused.join('; '), /keel-night-plan.*unavailable.*git show/);
  await writePlan(f.root, plan({ shapedBy: 'default' }));
  await assert.rejects(publishDefault({ root: f.root, date, env }), /keel-night-plan.*unavailable.*git show/);
  assert.equal(run('git', ['rev-parse', '--verify', '-q', 'plates-night-plan'], { cwd: f.origin }).status, 1);
});
for (const kind of ['oversize', 'transport']) test(`API ${kind} remains unavailable rather than absence`, async t => {
  const f = await fixture(t), gh = join(f.dir, 'gh');
  await writeFile(gh, `#!${process.execPath}\n${kind === 'oversize' ? "console.log('x'.repeat(1024*1024));" : "console.error('HTTP 403');process.exit(1);"}`, { mode: 0o755 });
  const selected = readApiNightPlan({ root: f.root, repo: 'acme/project', date, env: { ...process.env, PLATES_GH: gh } });
  assert.equal(selected.plan, null); assert.equal(selected.refused.length, 2);
  assert(selected.sources.every(source => source.state !== 'absent'));
});
test('confirmed missing plan files still permit default publication', async t => {
  const f = await fixture(t); await f.publish('keel-night-plan', 'Acme-owner.txt', 'Acme retained\n');
  await writePlan(f.root, plan({ shapedBy: 'default' }));
  assert.equal((await publishDefault({ root: f.root, date })).written, true);
  assert.equal(git(f.origin, 'show', 'keel-night-plan:Acme-owner.txt'), 'Acme retained');
});
test('a later legacy owner plan is preserved rather than shadowed by a default', async t => {
  const f = await fixture(t); await f.publish('keel-night-plan', '.keel/night/plan.json', JSON.stringify(plan({ date: '2026-10-25' })));
  await writePlan(f.root, plan({ shapedBy: 'default' }));
  const result = await publishDefault({ root: f.root, date });
  assert.equal(result.written, false); assert.match(result.why, /2026-10-25/);
  assert.equal(run('git', ['rev-parse', '--verify', '-q', 'plates-night-plan'], { cwd: f.origin }).status, 1);
});

test('morning reports a failed original-record Git read instead of using the plan branch', async t => {
  const f = await fixture(t);
  await f.publish('plates-night-plan', '.plates/night/plan.json', JSON.stringify(plan()));
  await f.publish(`keel-night/${date}`, `docs/night/${date}.json`, JSON.stringify(plan()));
  const env = await gitShim(f, "if(args.includes('show')&&args.at(-1).includes(':docs/night/'))process.exit(128);");
  const module = new URL('../practices/night/files/scripts/plates/morning.mjs', import.meta.url).href;
  const result = run(process.execPath, ['--input-type=module', '-e', `import assert from 'node:assert/strict';import {finalPlan} from ${JSON.stringify(module)};await assert.rejects(finalPlan({root:process.argv[1],date:process.argv[2]}),/cannot read keel-night.*git show exited 128/);`, f.root, date], { cwd: f.root, env });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
test('default publisher second read cannot reinterpret a failed blob read as no plan file', async t => {
  const f = await fixture(t);
  await f.publish('plates-night-plan', '.plates/night/plan.json', JSON.stringify(plan({ date: '2026-10-23' })));
  const before = git(f.origin, 'rev-parse', 'plates-night-plan');
  await writePlan(f.root, plan({ shapedBy: 'default' }));
  const env = await gitShim(f, "if(args.includes('show')&&!args.at(-1).startsWith('refs/remotes/'))process.exit(128);");
  await assert.rejects(publishDefault({ root: f.root, date, env }), /cannot read.*git show exited 128/);
  assert.equal(git(f.origin, 'rev-parse', 'plates-night-plan'), before);
});
