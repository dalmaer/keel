import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { acmeEvaluationPlan } from './helpers/evaluation-plan.mjs';
import { run } from './helpers/run.mjs';
import { validateEvaluationBundle, sealRecord, canonical } from '../lib/evaluation-records.mjs';
import { evaluations } from '../lib/evaluation-ledger.mjs';
import { initializeWorkspace } from '../lib/web/workspace.mjs';
const appRoot = fileURLToPath(new URL('..', import.meta.url));
const BIN = join(appRoot, 'bin/plates.mjs');
const ref = r => ({ kind: r.kind, id: r.id, digest: r.digest });
function reseal(b) {
  b.materials = b.materials.map(sealRecord);
  b.cases = b.cases.map(c => sealRecord({ ...c, acceptanceManifest: ref(b.materials.find(m => m.id === c.acceptanceManifest.id)) }));
  b.configurations = b.configurations.map(sealRecord);
  b.comparison = sealRecord({ ...b.comparison, baseline: ref(b.configurations[0]), candidate: ref(b.configurations[1]), cases: b.cases.map(ref), pairs: b.comparison.pairs.map(p => ({ ...p, case: ref(b.cases.find(c => c.id === p.case.id)) })) });
  return b;
}
async function world(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'acme-evaluation-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'inputs'));
  const opts = { appRoot, manifest: join(root, 'inputs/workspace.json'), state: join(root, 'state'), bundle: join(root, 'inputs/bundle.json') };
  await writeFile(opts.manifest, JSON.stringify({ version: 1, id: 'acme', name: 'Acme', repo: 'Acme/private', projects: [{ id: 'widget', repo: 'Acme/widget' }] }));
  await writeFile(opts.bundle, JSON.stringify(acmeEvaluationPlan()));
  await initializeWorkspace(opts);
  const call = extra => evaluations({ ...opts, ...extra });
  const cli = (action, extra = []) => {
    const r = run(process.execPath, [BIN, 'retro', 'evaluations', action, '--manifest', opts.manifest, '--state', opts.state, ...(action === 'inspect' ? ['--experiment', 'acme-comparison'] : ['--bundle', opts.bundle]), ...extra, '--json'], { cwd: root, env: { ...process.env, PLATES_CLAUDE_DIR: join(root, 'transcripts') } });
    return { status: r.status, data: JSON.parse(r.stdout) };
  };
  return { root, opts, call, cli, dir: join(opts.state, 'session-trials/acme-comparison') };
}
test('strict nested fields, immutable identities, references and bounds', () => {
  assert.equal(validateEvaluationBundle(acmeEvaluationPlan()).kind, 'harness');
  const mutations = [
    b => { b.cases[0].requirements = []; },
    b => { b.cases[0].provenance = []; },
    b => { b.comparison.authority = { kind: 'phase', ref: 'next' }; },
    b => { b.comparison.authority = { kind: 'issue', ref: 'Acme/other#1' }; },
    b => { b.comparison.authority = { kind: 'issue', ref: 'Acme/widget#0' }; },
    b => { b.configurations[0].runtime.version = 'latest'; },
    b => { b.configurations[0].tools[0].version = 'HEAD'; },
    b => { b.configurations[0].tools[0].version = 'main'; },
    b => { b.configurations[0].runtime.settings.inject = true; },
    b => { b.configurations[0].model.resolved = null; b.configurations[0].model.unresolvedReason = null; },
    b => { b.configurations[0].policy.automatic = true; },
    b => { b.cases[0].environment.image = 'latest'; },
    b => { b.cases[0].startingCommit = 'main'; },
    b => { b.cases[0].allowlist.paths = ['../escape']; },
    b => { b.cases[0].allowlist.extra = []; },
    b => { b.comparison.authority.extra = true; },
    b => { b.comparison.allowance.extra = 1; },
    b => { b.comparison.retention.extra = 1; },
    b => { b.comparison.promotion.automatic = true; },
    b => { b.comparison.pairs.pop(); b.comparison.pairs.pop(); },
    b => { b.comparison.allowance.minutes = 1; },
    b => { b.comparison.allowance.currencyUsd = 10; },
    b => { b.configurations[0].context = [{ path: 'guide.md', material: { kind: 'material', id: 'absent', digest: 'a'.repeat(64) } }]; },
  ];
  for (const mutate of mutations) { const b = acmeEvaluationPlan(); mutate(b); assert.throws(() => validateEvaluationBundle(reseal(b)), /evaluations:/); }
  const issue = acmeEvaluationPlan(); issue.comparison.authority = { kind: 'issue', ref: 'Acme/widget#12' }; validateEvaluationBundle(reseal(issue));
  const tampered = acmeEvaluationPlan(); tampered.cases[0].publicBrief = 'Tampered'; assert.throws(() => validateEvaluationBundle(tampered), /digest/);
  assert.throws(() => canonical({ x: undefined }), /non-JSON/);
  assert.throws(() => canonical({ x: Infinity }), /non-finite/);
  assert.equal(canonical({ b: null, a: 1 }), canonical({ a: 1, b: null }));
});
test('acceptance bytes cannot enter builder context or overlays under any identity', () => {
  for (const key of ['context', 'overlays']) for (const alias of [false, true]) {
    const b = acmeEvaluationPlan();
    const material = alias ? sealRecord({ ...b.materials[0], id: 'acme-copy' }) : b.materials[0];
    if (alias) b.materials.push(material);
    b.configurations[0][key] = [{ path: 'guide.md', material: ref(material) }];
    assert.throws(() => validateEvaluationBundle(reseal(b)), /acceptance material/);
  }
});
test('real CLI JSON preview, immutable retry, inspect, and unavailable execution', async t => {
  const w = await world(t);
  assert.equal(w.cli('plan').status, 0);
  const preview = w.cli('freeze'); assert.equal(preview.status, 3); assert.match(preview.data.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(await readdir(w.opts.state), ['workspace.json']);
  const first = w.cli('freeze', ['--yes', '--digest', preview.data.digest]); assert.equal(first.status, 0, JSON.stringify(first.data));
  const bytes = await readFile(join(w.dir, 'state.json'));
  const retry = w.cli('freeze', ['--yes', '--digest', preview.data.digest]); assert.equal(retry.status, 0); assert.equal(retry.data.recovered, true);
  assert.deepEqual(await readFile(join(w.dir, 'state.json')), bytes);
  assert.equal(w.cli('inspect').data.status, 'frozen');
  assert.equal(first.data.receipt.plan.bundle.comparison.allowance.currencyUsd, null);
  assert.equal(first.data.receipt.plan.budgetReserved, false);
  for (const action of ['run', 'resume', 'cancel', 'compare', 'rescore']) assert.equal(w.cli(action).status, 2);
  const help = run(process.execPath, [BIN, '--agent-help', 'retro']); assert.match(help.stdout, /evaluations plan\|freeze\|inspect/);
});
test('raw input, exact destination and manifest scope bind approval', async t => {
  const w = await world(t), p = await w.call({ action: 'freeze' });
  await writeFile(w.opts.bundle, `${await readFile(w.opts.bundle, 'utf8')}\n`);
  await assert.rejects(w.call({ action: 'freeze', yes: true, digest: p.digest }), /stale/);
  const other = await world(t);
  await assert.rejects(other.call({ action: 'freeze', yes: true, digest: p.digest }), /stale/);
  const manifest = JSON.parse(await readFile(w.opts.manifest)); manifest.projects = [];
  await writeFile(w.opts.manifest, JSON.stringify(manifest));
  await assert.rejects(w.call({ action: 'plan' }), /not authorized/);
  assert.deepEqual(await readdir(w.opts.state), ['workspace.json']);
});
test('exact retention refusal is pure, including attachment bytes and binding overhead', async t => {
  const w = await world(t), b = acmeEvaluationPlan();
  b.materials[0].content = 'x'.repeat(50000);
  b.comparison.retention.maxBytes = 80000;
  await writeFile(w.opts.bundle, JSON.stringify(reseal(b)));
  for (const action of ['plan', 'freeze']) await assert.rejects(w.call({ action }), /retention byte/);
  assert.deepEqual(await readdir(w.opts.state), ['workspace.json']);
});
test('foreign ownership, symlink paths, locked, partial and corrupt state refuse', async t => {
  const w = await world(t), p = await w.call({ action: 'freeze' });
  await symlink(w.opts.bundle, join(w.root, 'alias.json'));
  await assert.rejects(w.call({ action: 'plan', bundle: join(w.root, 'alias.json') }), /unsafe/);
  await symlink(w.opts.state, join(w.root, 'alias-state'));
  await assert.rejects(w.call({ action: 'plan', state: join(w.root, 'alias-state') }), /unsafe/);
  const marker = await readFile(join(w.opts.state, 'workspace.json'));
  await writeFile(join(w.opts.state, 'workspace.json'), JSON.stringify({ version: 1, id: 'foreign', repo: 'Acme/private' }));
  await assert.rejects(w.call({ action: 'freeze', yes: true, digest: p.digest }), /ownership/);
  await writeFile(join(w.opts.state, 'workspace.json'), marker);
  const home = join(w.opts.state, 'session-trials'); await mkdir(home, { mode: 0o700 });
  await writeFile(join(home, '.lock'), '', { mode: 0o600 });
  await assert.rejects(w.call({ action: 'freeze', yes: true, digest: p.digest }), /locked/);
  await rm(join(home, '.lock'));
  await mkdir(w.dir, { mode: 0o700 });
  await assert.rejects(w.call({ action: 'freeze', yes: true, digest: p.digest }), /partial/);
  await rm(w.dir, { recursive: true });
  await w.call({ action: 'freeze', yes: true, digest: p.digest });
  const path = join(w.dir, 'state.json'), raw = await readFile(path);
  await writeFile(path, '{}');
  await assert.rejects(w.call({ action: 'inspect', bundle: undefined, experiment: 'acme-comparison' }), /fields/);
  await writeFile(path, raw);
  const attachments = join(w.dir, 'attachments'), [name] = await readdir(attachments);
  await writeFile(join(attachments, name), 'tampered');
  await assert.rejects(w.call({ action: 'inspect', bundle: undefined, experiment: 'acme-comparison' }), /hash mismatch/);
});
test('different plan under same identity cannot overwrite history', async t => {
  const w = await world(t), p = await w.call({ action: 'freeze' });
  await w.call({ action: 'freeze', yes: true, digest: p.digest });
  const raw = await readFile(join(w.dir, 'state.json'));
  const b = acmeEvaluationPlan(); b.cases[0].publicBrief = 'Changed Acme task';
  await writeFile(w.opts.bundle, JSON.stringify(reseal(b)));
  const next = await w.call({ action: 'freeze' });
  await assert.rejects(w.call({ action: 'freeze', yes: true, digest: next.digest }), /different inputs/);
  assert.deepEqual(await readFile(join(w.dir, 'state.json')), raw);
});
test('concurrent real CLI freezes preserve one original receipt', async t => {
  const w = await world(t), p = await w.call({ action: 'freeze' });
  const source = `import { parentPort, workerData } from 'node:worker_threads'; import { run } from ${JSON.stringify(new URL('./helpers/run.mjs', import.meta.url).href)}; parentPort.postMessage(run(process.execPath, workerData.args, workerData.options));`;
  const results = await Promise.all([0, 1].map(() => new Promise((resolve, reject) => {
    const worker = new Worker(new URL('data:text/javascript,' + encodeURIComponent(source)), { workerData: { args: [BIN, 'retro', 'evaluations', 'freeze', '--manifest', w.opts.manifest, '--state', w.opts.state, '--bundle', w.opts.bundle, '--yes', '--digest', p.digest, '--json'], options: { cwd: w.root, env: { ...process.env, PLATES_CLAUDE_DIR: join(w.root, 'transcripts') } } } });
    worker.once('message', resolve); worker.once('error', reject);
  })));
  assert.ok(results.some(r => r.status === 0));
  for (const r of results) { assert.ok([0, 2].includes(r.status), r.stdout); if (r.status === 2) assert.match(r.stdout, /locked/); }
  assert.equal(w.cli('inspect').status, 0);
  assert.deepEqual((await readdir(w.dir)).sort(), ['attachments', 'state.json']);
});

test('uninitialized and in-repository state refuse without creating storage', async t => {
  const w = await world(t);
  const absent = join(w.root, 'absent');
  await assert.rejects(w.call({ action: 'plan', state: absent }), /initialize workspace/);
  assert.ok(!(await readdir(w.root)).includes('absent'));
  const git = join(w.root, 'acme-repo'); await mkdir(git); await mkdir(join(git, '.git'));
  await assert.rejects(w.call({ action: 'plan', state: join(git, 'private') }), /Git working trees/);
  assert.deepEqual(await readdir(git), ['.git']);
});
