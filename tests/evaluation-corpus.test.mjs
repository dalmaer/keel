import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { mkdtemp, realpath, rm, mkdir, readFile, writeFile, chmod, lstat, readdir, cp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './helpers/run.mjs';
import { corpusCatalog, corpusDefinition, inspectCorpus, prepareCorpusExport, exportCorpus } from '../lib/evaluation-corpus.mjs';
import { byteDigest, sealRecord, validateEvaluationBundle } from '../lib/evaluation-records.mjs';
import { acmeEvaluationPlan } from './helpers/evaluation-plan.mjs';
const repository = resolve(fileURLToPath(new URL('..', import.meta.url)));
async function temporary(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'acme-corpus-test-')));
  t.after(() => rm(root, { recursive: true, force: true })); return root;
}
const git = args => { const r = run('git', ['-c', 'core.fsmonitor=false', '-C', repository, ...args]); assert.equal(r.status, 0, r.stderr); return r.stdout; };
const cli = args => run(process.execPath, ['bin/plates.mjs', 'retro', 'evaluations', 'corpus', ...args], { cwd: repository, env: { ...process.env, PLATES_CLAUDE_DIR: '/Acme/unused-corpus-transcripts' } });
test('catalog exposes six development cases and schema2 independent acceptance without held-out claims', async () => {
  const catalog = await inspectCorpus(); assert.equal(catalog.cases.length, 6); assert.equal(catalog.development, 6); assert.equal(catalog.heldOut, 0);
  for (const item of catalog.cases) {
    const d = await corpusDefinition(item.id), bundle = acmeEvaluationPlan(), ref = x => ({ kind: x.kind, id: x.id, digest: x.digest });
    bundle.materials = d.materials; bundle.cases = [d.task];
    bundle.comparison = sealRecord({ ...bundle.comparison, repository: d.task.repository, cases: [ref(d.task)], pairs: bundle.comparison.pairs.map(p => ({ ...p, case: ref(d.task) })) });
    assert.doesNotThrow(() => validateEvaluationBundle(bundle));
    assert.equal(d.task.visibility, 'development'); assert.ok(d.task.exposure.length);
    for (const c of catalog.cases) for (const p of d.probes) {
      const text = Buffer.from(p.base64, 'base64').toString('utf8');
      assert.ok(!text.includes(c.provenance.correctedWitness) && !text.includes(c.provenance.correctedWitness.slice(0, 8)), 'cross-case witness identity absent from delivered probes');
    }
    assert.ok(!JSON.stringify({ brief: d.task.publicBrief, requirements: d.task.requirements }).includes(d.definition.fix));
  }
});
test('export binds exact curated historical bytes, stable outputs and explicit isolated delivery', async t => {
  const root = await temporary(t), options = { case: 'package-entry', repository, destination: join(root, 'export') };
  const first = await prepareCorpusExport(options), second = await prepareCorpusExport(options);
  assert.equal(first.digest, second.digest); assert.deepEqual(first.input, second.input);
  await assert.rejects(lstat(options.destination), { code: 'ENOENT' });
  await assert.rejects(exportCorpus({ ...options, yes: true, digest: 'a'.repeat(64) }), /stale/);
  const result = await exportCorpus({ ...options, yes: true, digest: first.digest }); assert.equal(result.written, true);
  for (const file of first.input.files) assert.equal(byteDigest(await readFile(join(options.destination, file.path))), file.sha256);
  const source = await readFile(join(options.destination, 'builder/lib/rename.mjs'), 'utf8');
  assert.equal(source, git(['show', 'edfc5647:lib/rename.mjs']));
  assert.ok(result.inventory.delivery.every(f => f.exportPath.startsWith('builder/')));
  assert.ok(!result.inventory.delivery.some(f => /evaluator|curator|\.git/.test(f.path)));
  assert.ok(result.inventory.delivery.filter(f => f.path.startsWith('probes/')).every(f => f.protected && !f.writable));
  assert.equal((await lstat(options.destination)).mode & 0o077, 0);
  await assert.rejects(exportCorpus({ ...options, yes: true, digest: first.digest }), /destination exists/);
});
test('unsafe, concurrent and partial exports refuse without overwriting bytes', async t => {
  const root = await temporary(t), options = { case: 'consumer-options', repository, destination: join(root, 'export') };
  await assert.rejects(prepareCorpusExport({ ...options, destination: 'relative' }), /absolute/);
  await assert.rejects(prepareCorpusExport({ ...options, destination: join(repository, 'never-created-corpus') }), /private|outside Git/);
  await symlink(root, join(root, 'alias'));
  await assert.rejects(prepareCorpusExport({ ...options, destination: join(root, 'alias/export') }), /canonical/);
  const p = await prepareCorpusExport(options);
  const results = await Promise.allSettled([exportCorpus({ ...options, yes: true, digest: p.digest }), exportCorpus({ ...options, yes: true, digest: p.digest })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const partial = join(root, 'partial'); await mkdir(partial, { mode: 0o700 }); await writeFile(join(partial, 'original'), 'Acme retained');
  await assert.rejects(prepareCorpusExport({ ...options, destination: partial }), /partial exports/);
  assert.equal(await readFile(join(partial, 'original'), 'utf8'), 'Acme retained');
});
test('curated source mismatch and changed probe bytes cannot inherit approval', async t => {
  const root = await temporary(t), lib = join(root, 'lib');
  await cp(join(repository, 'lib'), lib, { recursive: true });
  const module = await import(pathToFileURL(join(lib, 'evaluation-corpus.mjs'))), options = { case: 'package-entry', repository, destination: join(root, 'export') };
  const p = await module.prepareCorpusExport(options);
  const probe = join(lib, 'evaluation-corpus/probes/package-entry.mjs'); await writeFile(probe, (await readFile(probe, 'utf8')) + '\n// Acme changed\n');
  await assert.rejects(module.exportCorpus({ ...options, yes: true, digest: p.digest }), /stale/);
  const path = join(lib, 'evaluation-corpus/catalog.json'), catalog = JSON.parse(await readFile(path)); catalog.cases[0].sources[0].sha256 = '0'.repeat(64); await writeFile(path, JSON.stringify(catalog));
  await assert.rejects(module.prepareCorpusExport(options), /differs from curated/);
});
test('public CLI reports JSON, help and bounded refusals', () => {
  const inspected = cli(['inspect', '--json']); assert.equal(inspected.status, 0, inspected.stderr); assert.equal(JSON.parse(inspected.stdout).heldOut, 0);
  for (const args of [['inspect','--yes'], ['export','--case','unknown'], ['inspect','--json','--json'], ['reset']]) {
    const result = cli([...args, ...(args.includes('--json') ? [] : ['--json'])]); assert.equal(result.status, 2); assert.doesNotThrow(() => JSON.parse(result.stdout || result.stderr));
  }
  const help = run(process.execPath, ['bin/plates.mjs', '--agent-help', 'retro'], { cwd: repository }); assert.equal(help.status, 0); assert.match(help.stdout, /corpus inspect\|export/);
});
test('historical probes reject original behavior and accept only scoped corrected witnesses', async t => {
  for (const id of ['package-entry', 'canvas-retirement', 'coordinator-guidance', 'consumer-options', 'rename-ownership', 'workspace-command-doc']) await t.test(id, async t => {
    const root = await temporary(t), destination = join(root, 'export'), options = { case: id, repository, destination };
    const p = await prepareCorpusExport(options); await exportCorpus({ ...options, yes: true, digest: p.digest });
    const definition = await corpusDefinition(id), c = definition.definition, input = JSON.parse(definition.acceptance.content).checks[0].stdin, cwd = join(destination, 'builder');
    const broken = run(process.execPath, ['probes/' + c.probe], { cwd, input, timeout: 60000 });
    assert.notEqual(broken.status, 0, 'historical failure must be observed');
    assert.match(broken.stderr, /AssertionError|ERR_MODULE_NOT_FOUND/, broken.stderr);
    assert.doesNotMatch(broken.stderr, /Cannot find package|ENOENT.*spawn|SyntaxError/, 'infrastructure failure is not historical proof');
    for (const path of c.writable) { await chmod(join(cwd, path), 0o600); await writeFile(join(cwd, path), git(['show', c.fix + ':' + path])); }
    const corrected = run(process.execPath, ['probes/' + c.probe], { cwd, input, timeout: 60000 });
    assert.equal(corrected.status, 0, corrected.stderr); assert.equal(corrected.stdout, c.stdout);
    t.diagnostic(JSON.stringify({ case: id, startingCommit: c.start, correctedWitness: c.fix, originalExit: broken.status, correctedExit: corrected.status, deliveryBytes: p.inventory.delivery.reduce((n,f)=>n+f.bytes,0), claims: 'scripted exposed development machinery only' }));
  });
});
test('packed installed CLI includes and inspects the complete corpus without source checkout history', async t => {
  const root = await temporary(t), env = { ...process.env, HOME: root, PLATES_CLAUDE_DIR: join(root, 'transcripts'), npm_config_cache: join(root, 'cache') };
  const packed = run('npm', ['pack', '--offline', '--ignore-scripts', '--json', '--pack-destination', root], { cwd: repository, env, timeout: 60000 }); assert.equal(packed.status, 0, packed.stderr);
  const [{ filename, files }] = JSON.parse(packed.stdout); assert.ok(files.some(f => f.path === 'lib/evaluation-corpus/catalog.json'));
  assert.ok(files.some(f => f.path === 'lib/evaluation-corpus/private/coordinator-guidance.json'));
  const installed = run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--prefix', join(root, 'consumer'), join(root, filename)], { env, timeout: 60000 }); assert.equal(installed.status, 0, installed.stderr);
  const result = run(process.execPath, [join(root, 'consumer/node_modules/plates/bin/plates.mjs'), 'retro', 'evaluations', 'corpus', 'inspect', '--json'], { cwd: root, env });
  assert.equal(result.status, 0, result.stderr); const data = JSON.parse(result.stdout); assert.equal(data.cases.length, 6); assert.equal(data.catalogDigest, (await corpusCatalog()).catalogDigest);
});


test('broken Git markers and partial bare state never establish an outside-Git destination', async t => {
  for (const shape of ['pointer', 'config', 'bare', 'partial-bare']) await t.test(shape, async t => {
    const root = await temporary(t), destination = join(root, 'export');
    if (shape === 'pointer') await writeFile(join(root, '.git'), 'gitdir: /Acme/nonexistent\n');
    if (shape === 'config') { await mkdir(join(root, '.git')); await writeFile(join(root, '.git/config'), '[invalid'); }
    if (shape === 'bare') await writeFile(join(root, 'HEAD'), 'ref: refs/heads/main\n');
    if (shape === 'partial-bare') { await mkdir(join(root, 'objects')); await mkdir(join(root, 'refs')); }
    await assert.rejects(prepareCorpusExport({ case: 'package-entry', repository, destination }), /outside Git/);
    await assert.rejects(lstat(destination), { code: 'ENOENT' });
  });
});


test('replacement of an opened export directory refuses before writing into the replacement', async t => {
  const root = await temporary(t), destination = join(root, 'export'), retained = join(root, 'original');
  const options = { case: 'package-entry', repository, destination }, p = await prepareCorpusExport(options);
  const nativeOpen = fsp.open; let replaced = false;
  fsp.open = async (path, ...args) => {
    const handle = await nativeOpen(path, ...args);
    if (path === destination && !replaced) {
      replaced = true;
      await fsp.rename(destination, retained); await mkdir(destination, { mode: 0o700 });
      await writeFile(join(destination, 'owner'), 'Acme replacement owner');
    }
    return handle;
  };
  syncBuiltinESMExports();
  try { await assert.rejects(exportCorpus({ ...options, yes: true, digest: p.digest }), /directory replaced/); }
  finally { fsp.open = nativeOpen; syncBuiltinESMExports(); }
  assert.equal(replaced, true); assert.deepEqual(await readdir(destination), ['owner']);
  assert.equal(await readFile(join(destination, 'owner'), 'utf8'), 'Acme replacement owner');
  assert.deepEqual(await readdir(retained), []);
});

test('guidance oracle is installed evaluator material and never builder delivery across all cases', async t => {
  const root = await temporary(t), d = await corpusDefinition('coordinator-guidance');
  const input = JSON.parse(d.acceptance.content).checks[0].stdin, oracle = JSON.parse(input);
  assert.equal(Object.keys(oracle).length, 5);
  for (const c of (await corpusCatalog()).catalog.cases) {
    const p = await prepareCorpusExport({ case: c.id, repository, destination: join(root, c.id) });
    for (const f of p.outputs.filter(f => f.path.startsWith('builder/'))) {
      const text = f.bytes.toString('utf8');
      for (const sentence of Object.values(oracle).flat()) assert.ok(!text.includes(sentence), c.id + ': private answer leaked to ' + f.path);
    }
    assert.ok(!p.inventory.delivery.some(f => /private|coordinator-guidance\.json/.test(f.path)));
    if (c.id === d.definition.id) {
      const privateMaterials = JSON.parse(p.outputs.find(f => f.path === 'evaluator/materials.json').bytes);
      assert.equal(JSON.parse(privateMaterials.find(m => m.id === d.acceptance.id).content).checks[0].stdin, input);
    }
  }
});

test('guidance rejects missing, malformed, oversized and structurally invalid private maps before execution', async t => {
  const root = await temporary(t), options = { case: 'coordinator-guidance', repository, destination: join(root, 'export') };
  const p = await prepareCorpusExport(options); await exportCorpus({ ...options, yes: true, digest: p.digest });
  const d = await corpusDefinition(options.case), cwd = join(options.destination, 'builder');
  for (const path of d.definition.writable) { await chmod(join(cwd, path), 0o600); await writeFile(join(cwd, path), git(['show', d.definition.fix + ':' + path])); }
  const valid = JSON.parse(JSON.parse(d.acceptance.content).checks[0].stdin);
  for (const input of ['', '{', 'null', '[]', '1', '{}', ' '.repeat(16385), JSON.stringify({ ...valid, extra: [] }), JSON.stringify({ ...valid, 'no-precreation': ['one'] }), JSON.stringify({ ...valid, 'no-precreation': [null, 'two'] })]) {
    const result = run(process.execPath, ['probes/' + d.definition.probe], { cwd, input, timeout: 5000 });
    assert.notEqual(result.status, 0); assert.match(result.stderr, /AssertionError|SyntaxError/); assert.equal(result.stdout, '');
  }
});
